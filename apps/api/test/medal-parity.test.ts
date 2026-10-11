// INT-06: the shared medal fixtures (specs/set-record/fixtures/medals/*.json) give the expected set
// and workout medals through the real API: rule flags decide clean, the model only advises. The
// same fixtures run through the pipeline in databricks/pipelines/spotter_sessions/tests/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabricksScorer } from "../src/integrations/databricks/score.js";
import { RestNoteWriter } from "../src/services/restNote.js";
import { createTestDb, setup, setRecord } from "./helpers.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../specs/set-record/fixtures/medals",
);

interface FixtureRep {
  tempo_ms: number;
  range_deg: number;
  flags: { rule_id: string; severity: string }[];
  model: { quality: number; label: string };
}
interface Fixture {
  name: string;
  user: string;
  sessions: {
    days_ago: number;
    sets: { exercise_id: string; reps: FixtureRep[] }[];
    expected: { set_medals: string[]; workout_medal: string; form_score: number; baseline: number };
  }[];
}

const fixtures: Fixture[] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(FIXTURES, f), "utf8")));

// The model's per-rep output for the set being posted: Databricks "answers" with it.
let modelReps: FixtureRep["model"][] = [];
const fakeFetch = (async (url: string) => {
  if (url.endsWith("/oidc/v1/token"))
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
  return new Response(JSON.stringify({ predictions: modelReps }));
}) as unknown as typeof fetch;
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

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  const { db, close } = await createTestDb();
  t = await setup({ db, close, rest: { scorer, notes: new RestNoteWriter(null) } });
});
afterAll(() => t.close());
afterEach(() => vi.useRealTimers());

const NOW = new Date("2026-10-10T12:00:00Z");

describe.each(fixtures.map((f) => [f.name, f] as const))("medal parity: %s", (_name, fixture) => {
  it("gives the fixture's set and workout medals, decided by rule flags", async () => {
    for (const session of fixture.sessions) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW.getTime() - session.days_ago * 86_400_000));
      const api = await t.as(fixture.user); // signed at the session's time

      const { id } = (await api.post("/sessions", { inference_mode: "coreml" })).body;
      const setMedals: string[] = [];
      for (const [set_index, set] of session.sets.entries()) {
        modelReps = set.reps.map((r) => r.model);
        const res = await api.post(
          `/sessions/${id}/sets`,
          setRecord({
            set_index,
            exercise_id: set.exercise_id,
            reps: set.reps.map(({ tempo_ms, range_deg, flags }) => ({ tempo_ms, range_deg, flags })),
          }),
        );
        expect(res.status).toBe(201);
        expect(res.body.score.source).toBe("databricks"); // the model answered, and still didn't decide
        setMedals.push(res.body.score.medal);
      }
      expect(setMedals).toEqual(session.expected.set_medals);

      const finished = await api.post(`/sessions/${id}/finish`);
      expect(finished.status).toBe(200);
      expect(finished.body).toMatchObject({ medal: session.expected.workout_medal });
      expect(finished.body.form_score).toBeCloseTo(session.expected.form_score, 4);
      expect(finished.body.baseline_share).toBeCloseTo(session.expected.baseline, 4);
      vi.useRealTimers();
    }
  });
});
