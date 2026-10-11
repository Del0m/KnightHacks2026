// npm run demo:prep -- [--demo]
//
// Run ~10 minutes before judging. Wakes everything that cold-starts and refreshes the synced data,
// then prints a checklist. Each step is independent: one failing doesn't stop the others.
//
//   1. Databricks SQL warehouse   stopped warehouses take ~15 s on the first query
//   2. Set-scoring endpoint       scales to zero; ~20 s cold start, past the API's 1.2 s budget
//   3. Cloud pose endpoint        scales to zero; a few minutes cold, the app shows "reconnecting"
//   4. Insight sync               gold tables -> Neon (progress, risk, range of motion)
//   5. Profile embeddings         buddy matching, for profiles that don't have one
//
// --demo targets DEMO_DATABASE_URL (the branch the demo app reads); otherwise DATABASE_URL.
// Reads apps/api/.env. Nothing here changes Databricks; steps 4-5 write to the chosen Neon branch.
import { createNeonDb } from "../src/db.js";
import { DatabricksScorer, scoreConfigFromEnv } from "../src/integrations/databricks/score.js";
import { hfEmbedder } from "../src/integrations/huggingface/embeddings.js";
import { PoseEndpointClient, poseEndpointConfigFromEnv } from "../src/integrations/huggingface/poseEndpoint.js";
import { readGold, runInsightSync, syncConfigFromEnv } from "../src/jobs/syncInsights.js";
import { backfillProfileEmbeddings } from "../src/services/profileEmbeddings.js";
import { loadClips, toSetPayload } from "../test/replay/pipeline.js";

const env = process.env;
const useDemo = process.argv.includes("--demo");
const dbUrl = useDemo ? env.DEMO_DATABASE_URL : env.DATABASE_URL;
const results: { step: string; ok: boolean | null; detail: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step(name: string, run: () => Promise<string | null>): Promise<void> {
  const started = Date.now();
  process.stdout.write(`… ${name}\n`);
  try {
    const detail = await run();
    if (detail === null) results.push({ step: name, ok: null, detail: "skipped (not configured)" });
    else results.push({ step: name, ok: true, detail: `${detail} (${Math.round((Date.now() - started) / 1000)} s)` });
  } catch (err) {
    results.push({ step: name, ok: false, detail: err instanceof Error ? err.message.split("\n")[0]!.slice(0, 160) : String(err) });
  }
}

/** Retries `attempt` until it returns a value or `budgetMs` runs out. */
async function until<T>(budgetMs: number, everyMs: number, attempt: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = await attempt();
    if (value !== null) return value;
    if (Date.now() + everyMs > deadline) throw new Error(`still not ready after ${Math.round(budgetMs / 1000)} s`);
    await sleep(everyMs);
  }
}

await step("Databricks SQL warehouse", async () => {
  if (!env.DATABRICKS_WAREHOUSE_ID || !env.DATABRICKS_HOST) return null;
  const gold = await readGold({ ...syncConfigFromEnv(env as never), lookbackDays: 1 }, { info() {}, error() {} });
  const failed = gold.failed?.map((f) => f.table) ?? [];
  if (failed.length) throw new Error(`warehouse up, but can't read: ${failed.join(", ")}`);
  return "awake, all gold tables readable";
});

await step("Set-scoring endpoint", async () => {
  if (!env.DATABRICKS_SERVING_ENDPOINT || !env.DATABRICKS_HOST) return null;
  // A generous budget per call so the cold start can finish; then it must answer within the API's.
  const cold = new DatabricksScorer({ ...scoreConfigFromEnv(env as never), timeoutMs: 60_000 }, fetch);
  const warm = new DatabricksScorer(scoreConfigFromEnv(env as never), fetch);
  const set = toSetPayload(loadClips().find((c) => c.name === "squat_clean")!);
  const input = { exercise_id: set.exercise_id, weight_kg: null, reps: set.reps as never, frames: set.frames };
  await until(180_000, 5_000, async () => ((await cold.scoreSet(input)).source === "databricks" ? true : null));
  const check = await warm.scoreSet(input);
  if (check.source !== "databricks") throw new Error(`warm, but slower than the API's budget: ${check.fallback_reason}`);
  return `warm, scored in ${check.latency_ms} ms`;
});

await step("Cloud pose endpoint", async () => {
  const cfg = poseEndpointConfigFromEnv(env as never);
  if (!cfg) return null;
  const client = new PoseEndpointClient({ ...cfg, timeoutMs: 30_000 });
  const blank = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  const reply = await until(600_000, 10_000, async () => {
    const r = await client.detect(blank, Date.now());
    if (r.status === "error") throw new Error(r.message);
    return r.status === "ok" ? r : null; // "warming": keep waiting
  });
  return `warm, model answered in ${reply.endpointMs} ms`;
});

await step(`Insight sync into ${useDemo ? "DEMO" : "DATABASE"}_URL`, async () => {
  if (!dbUrl || !env.DATABRICKS_WAREHOUSE_ID) return null;
  const { query, close } = createNeonDb(dbUrl);
  try {
    const r = await runInsightSync({ db: { query }, config: syncConfigFromEnv(env as never), log: { info() {}, error() {} } });
    if (r.failed.length) throw new Error(`synced, but couldn't read: ${r.failed.map((f) => f.table).join(", ")}`);
    if (r.progress + r.risk + r.rom === 0) throw new Error("ran, but matched no users: is this branch seeded, with the same STEADYFORUM_PSEUDONYM_SECRET?");
    return `${r.progress} progress, ${r.risk} risk, ${r.rom} range-of-motion rows`;
  } finally {
    await close();
  }
});

await step("Profile embeddings", async () => {
  if (!dbUrl || !env.HF_TOKEN) return null;
  const { db, close } = createNeonDb(dbUrl);
  try {
    return `${await backfillProfileEmbeddings(db, hfEmbedder(env.HF_TOKEN))} profiles embedded (others already had one)`;
  } finally {
    await close();
  }
});

console.log("\nDemo prep:");
for (const r of results) console.log(`  ${r.ok === true ? "✓" : r.ok === false ? "✗" : "–"} ${r.step.padEnd(34)} ${r.detail}`);
const failed = results.filter((r) => r.ok === false).length;
console.log(failed ? `\n${failed} step(s) need attention.` : "\nReady. Endpoints sleep again after ~15 min idle, so run this close to judging.");
process.exit(failed ? 1 : 0);
