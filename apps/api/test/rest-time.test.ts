// INT-05: POST /sessions/:id/sets returns { set_id, score, rest_note } within the rest-time
// budget, with every fallback path. The real DatabricksScorer and HfLlm run with faked network.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabricksScorer } from "../src/integrations/databricks/score.js";
import { HfLlm } from "../src/integrations/huggingface/llm.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";
import { RestNoteWriter, suggestionProblems } from "../src/services/restNote.js";
import type { RestTimeDeps } from "../src/services/restTime.js";
import { createTestDb, rep, setup } from "./helpers.js";

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/exercises");

// ---- Fakes ----

type Mode = "ok" | "hang" | "503";
const net = { databricks: "ok" as Mode, labels: "clean" as string, llm: "ok" as Mode, suggestion: "" };

const fakeFetch = (async (url: string, init?: RequestInit) => {
  if (url.endsWith("/oidc/v1/token"))
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
  if (net.databricks === "503") return new Response("ENDPOINT_NOT_READY", { status: 503 });
  if (net.databricks === "hang") {
    await new Promise((_r, reject) =>
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)),
    );
  }
  const records = JSON.parse(init!.body as string).dataframe_records as unknown[];
  return new Response(
    JSON.stringify({ predictions: records.map(() => ({ quality: 0.42, label: net.labels })) }),
  );
}) as unknown as typeof fetch;

const fakeHf = {
  chatCompletion: async (_args: unknown, opts: { signal: AbortSignal }) => {
    if (net.llm === "hang") {
      await new Promise((_r, reject) =>
        opts.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }
    return { choices: [{ message: { content: JSON.stringify({ suggestion: net.suggestion }) } }] };
  },
};

const scorer = new DatabricksScorer(
  {
    host: "https://dbc.test",
    clientId: "a",
    clientSecret: "b",
    scopes: "model-serving",
    endpoint: "form-quality",
    timeoutMs: 1200,
  },
  fakeFetch,
  { warn: () => {} },
);
const llm = new HfLlm(
  {
    token: "hf",
    chain: [{ model: "openai/gpt-oss-120b", provider: "cerebras" }],
    attemptsPerPair: 1,
    defaultTimeoutMs: 1000,
  },
  fakeHf as never,
);
const rest: RestTimeDeps = { scorer, notes: new RestNoteWriter(llm) };

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  const { db, close } = await createTestDb();
  t = await setup({ db, close, rest });
  await loadSpecs(t.db, SPECS_DIR);
});
afterAll(() => t.close());

async function postSet(reps: object[]) {
  const api = await t.as("rest-user");
  const { id } = (await api.post("/sessions", { device: "iPhone" })).body;
  const started = Date.now();
  const res = await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", weight_kg: 50, reps });
  return { res, ms: Date.now() - started, api };
}

const eight = (flagged: Record<number, string[]>, tempo = 2000) =>
  Array.from({ length: 8 }, (_, i) => rep(flagged[i] ?? [], { tempo_ms: tempo }));

describe("rest-time loop", () => {
  it("returns a Databricks score and an LLM note in one response, good news first", async () => {
    Object.assign(net, { databricks: "ok", labels: "clean", llm: "ok" });
    net.suggestion = "Knees drifted inward on 2 reps. Tracking over the toes tends to feel steadier.";
    const { res, ms } = await postSet(eight({ 2: ["knee_tracking"], 5: ["knee_tracking", "tempo"] }));
    expect(res.status).toBe(201);
    expect(res.body.set_id).toBe(res.body.id);
    expect(res.body.score).toMatchObject({ source: "databricks", clean_share: 0.75 });
    expect(res.body.rest_note).toEqual({
      text: `6 of 8 reps were clean. ${net.suggestion}`,
      source: "llm",
      rule_id: "knee_tracking", // priority 2 beats tempo's 4
    });
    expect(res.body.timings_ms.total).toBeLessThanOrEqual(1500);
    expect(ms).toBeLessThan(1500);
  });

  it("decides clean and the medal from the rule flags, not the model's labels (INT-06)", async () => {
    Object.assign(net, { databricks: "ok", labels: "knees_in", llm: "ok" }); // model calls every rep a fault
    const { res } = await postSet(eight({}));
    expect(res.body.score.source).toBe("databricks");
    expect(res.body.score.medal).toBe("gold");
    expect(
      res.body.score.reps.every((r: { clean: boolean; label: string }) => r.clean && r.label === "knees_in"),
    ).toBe(true);
  });

  it("no flags: the fixed 'N of N reps were clean' line, and no LLM call", async () => {
    Object.assign(net, { databricks: "ok", labels: "clean", llm: "ok" });
    net.suggestion = "should never be used";
    const { res } = await postSet(eight({}));
    expect(res.body.rest_note).toEqual({ text: "8 of 8 reps were clean.", source: "fixed", rule_id: null });
  });

  it("Databricks timeout: the phone score, inside the budget", async () => {
    Object.assign(net, { databricks: "hang", llm: "ok" });
    net.suggestion = "Knees drifted inward on 1 rep. Tracking over the toes tends to feel steadier.";
    const { res, ms } = await postSet(eight({ 3: ["knee_tracking"] }));
    expect(res.body.score).toMatchObject({
      source: "phone",
      medal: "silver",
      fallback_reason: "timed out after 1200 ms",
    });
    expect(res.body.rest_note.source).toBe("llm");
    expect(ms).toBeLessThan(2500);
  });

  it("Databricks 5xx: the phone score straight away", async () => {
    Object.assign(net, { databricks: "503", llm: "ok" });
    const { res, ms } = await postSet(eight({ 3: ["depth"] }));
    expect(res.body.score).toMatchObject({
      source: "phone",
      fallback_reason: "HTTP 503: ENDPOINT_NOT_READY",
    });
    expect(ms).toBeLessThan(1500);
  });

  it("LLM timeout: the fixed note with {n} filled in, after at most ~1 s", async () => {
    Object.assign(net, { databricks: "ok", llm: "hang" });
    const { res, ms } = await postSet(eight({ 1: ["knee_tracking"], 4: ["knee_tracking"] }));
    expect(res.body.rest_note.source).toBe("fixed");
    expect(res.body.rest_note.rule_id).toBe("knee_tracking");
    expect(res.body.rest_note.text).toMatch(/^6 of 8 reps were clean\. .*\b2 reps\b/);
    expect(res.body.timings_ms.note).toBeLessThan(1300);
    expect(ms).toBeLessThan(2500);
  });

  it("banned phrase: the LLM's sentence is replaced by the fixed note", async () => {
    Object.assign(net, { databricks: "ok", llm: "ok" });
    for (const bad of [
      "You should keep your knees over your toes.",
      "Keep your knees out next time.",
      "Great job!",
      "2 of 8 reps had knees drifting in.",
      "You're letting your knees cave in.",
      "You are leaning a little far forward.",
    ]) {
      expect(suggestionProblems(bad).length).toBeGreaterThan(0);
      net.suggestion = bad;
      const { res } = await postSet(eight({ 0: ["knee_tracking"] }));
      expect(res.body.rest_note.source).toBe("fixed");
    }
  });

  it("rejects a suggestion that drops or invents numbers (§7: numbers over adjectives)", () => {
    const original = "Your reps took about 0.8 s on the way down. Around 2 s gives you more control.";
    expect(suggestionProblems("A slower descent of about two seconds adds control.", original)).toContain(
      "drops the original's numbers (0.8, 2)",
    );
    expect(
      suggestionProblems(
        "The way down took about 0.8 s. Closer to 2 s tends to give more control.",
        original,
      ),
    ).toEqual([]);
    expect(
      suggestionProblems("The way down took about 0.8 s. Around 2 s or 3 s adds control.", original),
    ).toContain("adds numbers the original doesn't have (3)");
  });

  it("fills {t} for duration rules from the flagged reps' time", async () => {
    Object.assign(net, { databricks: "ok", llm: "hang" });
    const { res } = await postSet(eight({ 0: ["tempo"], 1: ["tempo"] }, 700));
    expect(res.body.rest_note).toMatchObject({ source: "fixed", rule_id: "tempo" });
    expect(res.body.rest_note.text).toContain("0.7 s");
  });

  it("saves the score and note so GET /sets/:id/rest-note returns the same", async () => {
    Object.assign(net, { databricks: "ok", labels: "clean", llm: "ok" });
    net.suggestion = "Knees drifted inward on 1 rep. Tracking over the toes tends to feel steadier.";
    const { res, api } = await postSet(eight({ 2: ["knee_tracking"] }));
    expect(res.body.rest_note.source).toBe("llm");
    const again = await api.get(`/sets/${res.body.set_id}/rest-note`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      set_id: res.body.set_id,
      score: res.body.score,
      rest_note: res.body.rest_note,
    });
    const other = await t.as("someone-else");
    expect((await other.get(`/sets/${res.body.set_id}/rest-note`)).status).toBe(404);
  });

  it("never waits past the 2.5 s cap, even if a scorer ignores its own timeout", async () => {
    const stuck = await setup({
      rest: { scorer: { scoreSet: () => new Promise(() => {}) }, notes: new RestNoteWriter(null) },
    });
    await loadSpecs(stuck.db, SPECS_DIR);
    const api = await stuck.as("stuck-user");
    const { id } = (await api.post("/sessions")).body;
    const started = Date.now();
    const res = await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: eight({}) });
    expect(Date.now() - started).toBeLessThan(2800);
    expect(res.body.score).toMatchObject({ source: "phone", fallback_reason: "rest-time budget exceeded" });
    await stuck.close();
  });

  it("without scoring or an LLM configured: phone score and fixed note", async () => {
    const plain = await setup();
    await loadSpecs(plain.db, SPECS_DIR);
    const api = await plain.as("plain-user");
    const { id } = (await api.post("/sessions")).body;
    const res = await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      reps: eight({ 0: ["depth"] }),
    });
    expect(res.body.score.source).toBe("phone");
    expect(res.body.rest_note).toMatchObject({ source: "fixed", rule_id: "depth" });
    await plain.close();
  });
});
