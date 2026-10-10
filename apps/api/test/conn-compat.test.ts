// Code merged from main (AI-05, CONN-06, CONN-08, CONN-09) running against this API's schema,
// so a mismatch between their SQL and our migrations fails here instead of in production.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ingest, type Chunk } from "../../../rag/ingest.js";
import { schema } from "../src/db.js";
import { pseudonymize } from "../src/integrations/databricks/upload.js";
import { runInsightSync, type SyncConfig } from "../src/jobs/syncInsights.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";
import { llamaGuardModerator } from "../src/services/moderation.js";
import { createTestDb, setup } from "./helpers.js";

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/exercises");

let client: PGlite;
let t: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  const created = await createTestDb();
  client = created.client;
  t = await setup({
    db: created.db,
    close: created.close,
    // CONN-09 adapter with a fake Llama Guard: blocks anything mentioning steroids, like category S2.
    moderator: llamaGuardModerator({
      moderate: async (text) =>
        /steroid/i.test(text)
          ? {
              allowed: false,
              checked: true,
              categories: ["S2"],
              message: "We can't share posts about illegal activity.",
            }
          : { allowed: true, checked: true, categories: [] },
    }),
  });
});
afterAll(() => t.close());

describe("AI-05 exercise specs", () => {
  it("loads the real specs and skips schema.json", async () => {
    const ids = await loadSpecs(t.db, SPECS_DIR);
    expect(ids).toEqual(["bicep_curl", "lunge", "push_up", "shoulder_press", "squat"]);

    const list = await request(t.app).get("/exercises");
    expect(list.body.map((e: { id: string; has_spec: boolean }) => [e.id, e.has_spec])).toContainEqual([
      "squat",
      true,
    ]);
    const spec = await request(t.app).get("/exercises/squat/spec");
    expect(spec.body).toMatchObject({ id: "squat", spec_version: 1 });
    expect(spec.body.rules.length).toBeGreaterThan(0);
  });
});

describe("CONN-08 RAG ingest", () => {
  const unit = (i: number) => Array.from({ length: 384 }, (_, j) => (j === i % 384 ? 1 : 0));
  const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => unit(i)));
  const chunks: Chunk[] = [
    {
      id: "exercise:Goblet_Squat#0",
      source: "free-exercise-db",
      content: "Goblet squat",
      metadata: { loads: ["knee"] },
    },
    {
      id: "injury_note:knee#0",
      source: "injury-notes",
      content: "Knee: limit depth",
      metadata: { body_part: "knee" },
    },
  ];

  it("writes, skips unchanged chunks and deletes stale ones in doc_chunks", async () => {
    const first = await ingest(client, embed, chunks);
    expect(first).toMatchObject({ total: 2, embedded: 2, unchanged: 0, deleted: 0 });

    const again = await ingest(client, embed, chunks);
    expect(again).toMatchObject({ embedded: 0, unchanged: 2 });

    const edited = [{ ...chunks[0]!, content: "Goblet squat to a box" }];
    expect(await ingest(client, embed, edited)).toMatchObject({ embedded: 1, deleted: 1 });

    const rows = await t.db.select().from(schema.docChunks);
    expect(rows.map((r) => r.id)).toEqual(["exercise:Goblet_Squat#0"]);
    expect(rows[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("CONN-06 insight sync", () => {
  const config: SyncConfig = {
    host: "https://dbc.example",
    clientId: "id",
    clientSecret: "secret",
    scopes: "sql",
    warehouseId: "wh",
    pseudonymSecret: "test-pseudonym-secret-123456",
    lookbackDays: 35,
  };

  it("upserts gold rows into progress_daily and risk_insights, which /me/insights serves", async () => {
    const api = await t.as("sync-user");
    await api.get("/me/profile"); // creates the user
    const pseudo = pseudonymize("sync-user", config.pseudonymSecret);
    const gold = {
      progress: [
        {
          user_id: pseudo,
          date: "2026-10-08",
          exercise_id: "squat",
          sets: 3,
          reps: 24,
          clean_reps: 20,
          clean_share: 0.83,
          volume_kg: 960,
          avg_range_deg: 94,
          avg_quality: 0.81,
          est_1rm_kg: 52,
          is_pr: true,
        },
      ],
      risk: [
        {
          user_id: pseudo,
          body_part: "knee",
          date: "2026-10-08",
          score: 0.55,
          top_features: ["flag_rate_rising"],
        },
        { user_id: "someone-unknown", body_part: "knee", date: "2026-10-08", score: 0.9, top_features: [] },
      ],
    };

    const run = () => runInsightSync({ db: client, config, read: async () => gold });
    expect(await run()).toMatchObject({ progress: 1, risk: 1, skipped_unknown_users: 1 });
    await run(); // idempotent

    const progress = await t.db.select().from(schema.progressDaily);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ userId: "sync-user", exerciseId: "squat", reps: 24, isPr: true });

    const risk = await t.db
      .select()
      .from(schema.riskInsights)
      .where(eq(schema.riskInsights.userId, "sync-user"));
    expect(risk).toHaveLength(1);
    expect(risk[0]!.topFeatures).toEqual(["flag_rate_rising"]);

    const insights = await api.get("/me/insights");
    expect(insights.body.insights[0]).toMatchObject({
      body_part: "knee",
      level: "high",
      as_of: "2026-10-08",
    });
    expect(insights.body.insights[0].explanation).toContain("not a diagnosis");
  });
});

describe("CONN-14 range of motion sync", () => {
  it("upserts gold_rom_trend into rom_trend, idempotently, and skips unknown users", async () => {
    const config: SyncConfig = {
      host: "https://dbc.example",
      clientId: "id",
      clientSecret: "secret",
      scopes: "sql",
      warehouseId: "wh",
      pseudonymSecret: "test-pseudonym-secret-123456",
      lookbackDays: 35,
    };
    const api = await t.as("rom-user");
    await api.get("/me/profile");
    const pseudo = pseudonymize("rom-user", config.pseudonymSecret);
    const week = (w: string, peak: number, change: number | null, healthy: number | null) => ({
      user_id: pseudo,
      angle: "knee",
      side: "left",
      week: w,
      peak_range_deg: peak,
      baseline_range_deg: 71.9,
      healthy_side_range_deg: healthy,
      change_deg: change,
    });
    const gold = {
      progress: [],
      risk: [],
      rom: [
        week("2026-08-24", 71.9, 0, 94.7),
        week("2026-09-21", 90.2, 18.3, 93.3),
        { ...week("2026-09-21", 93.3, null, null), side: "right" },
        { ...week("2026-09-21", 80, 8, 92), user_id: "someone-unknown" },
      ],
    };
    const run = () => runInsightSync({ db: client, config, read: async () => gold });
    expect(await run()).toMatchObject({ rom: 3, skipped_unknown_users: 1 });
    await run(); // idempotent

    const rows = await t.db.select().from(schema.romTrend).where(eq(schema.romTrend.userId, "rom-user"));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.week === "2026-09-21" && r.side === "left")).toMatchObject({
      angle: "knee",
      peakRangeDeg: expect.closeTo(90.2, 3),
      changeDeg: expect.closeTo(18.3, 3),
      healthySideRangeDeg: expect.closeTo(93.3, 3),
    });

    gold.rom[1] = week("2026-09-21", 91, 19.1, 93.3); // the pipeline recomputed the week
    await run();
    const updated = await t.db.select().from(schema.romTrend).where(eq(schema.romTrend.userId, "rom-user"));
    expect(updated).toHaveLength(3);
    expect(updated.find((r) => r.week === "2026-09-21" && r.side === "left")!.changeDeg).toBeCloseTo(19.1, 3);
  });
});

describe("CONN-09 moderation", () => {
  it("blocks with Llama Guard's friendly message and lets normal posts through", async () => {
    const api = await t.as("mod-user");
    const blocked = await api.post("/posts", { kind: "goal", body: "Where can I buy steroids?" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toBe("We can't share posts about illegal activity.");
    expect((await api.post("/posts", { kind: "goal", body: "3 gold workouts this month" })).status).toBe(201);
  });

  it("passes Llama Guard's advisory, unchecked and support flags through the adapter", async () => {
    const adapter = (result: Awaited<ReturnType<Parameters<typeof llamaGuardModerator>[0]["moderate"]>>) =>
      llamaGuardModerator({ moderate: async () => result }).check("text", "advice");

    expect(
      await adapter({ allowed: true, checked: true, categories: ["S6"], advisory: "specialized_advice" }),
    ).toEqual({ allowed: true, checked: true, advisory: "specialized_advice" });
    expect(await adapter({ allowed: true, checked: false, categories: [] })).toEqual({
      allowed: true,
      checked: false,
    });
    expect(
      await adapter({ allowed: false, checked: true, categories: ["S11"], support: true, message: "988" }),
    ).toEqual({ allowed: false, message: "988", support: true });
  });
});
