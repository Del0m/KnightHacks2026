// DB-02..DB-09: the migrations apply on a fresh database and the constraints the issues ask for hold.
import { cosineDistance, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "../src/db.js";
import { createTestDb } from "./helpers.js";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const unit = (i: number) => Array.from({ length: 384 }, (_, j) => (j === i ? 1 : 0));

describe("migrations", () => {
  it("create every table on a fresh branch", async () => {
    const res = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const tables = (res as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "users",
        "profiles",
        "injuries",
        "sessions",
        "sets",
        "reps",
        "form_flags",
        "exercises",
        "plans",
        "plan_items",
        "posts",
        "comments",
        "kudos",
        "follows",
        "blocks",
        "buddy_matches",
        "personal_records",
        "goals",
        "medals",
        "risk_insights",
        "doc_chunks",
        "progress_daily",
        "rehab_plans",
        "rehab_limits",
        "rom_trend",
      ]),
    );
  });

  it("enables pgvector and answers a nearest-neighbour query (DB-08)", async () => {
    await db.insert(schema.docChunks).values([
      {
        id: "ex:goblet#0",
        source: "free-exercise-db",
        content: "Goblet squat",
        embedding: unit(0),
        contentHash: "a",
      },
      {
        id: "ex:bridge#0",
        source: "free-exercise-db",
        content: "Glute bridge",
        embedding: unit(1),
        contentHash: "b",
      },
      {
        id: "note:knee#0",
        source: "injury-notes",
        content: "Knee: limit depth",
        embedding: unit(2),
        contentHash: "c",
      },
    ]);
    const query = unit(1).map((v, i) => (i === 0 ? 0.2 : v));
    const rows = await db
      .select({
        content: schema.docChunks.content,
        distance: cosineDistance(schema.docChunks.embedding, query),
      })
      .from(schema.docChunks)
      .orderBy(cosineDistance(schema.docChunks.embedding, query))
      .limit(2);
    expect(rows.map((r) => r.content)).toEqual(["Glute bridge", "Goblet squat"]);
  });

  it("cascades a user delete through workouts and social rows (DB-04, §13)", async () => {
    await db.insert(schema.users).values({ id: "u-del", handle: "to_delete" });
    const [s] = await db.insert(schema.sessions).values({ userId: "u-del" }).returning();
    const [set] = await db
      .insert(schema.sets)
      .values({ sessionId: s!.id, position: 0, exerciseId: "squat", reps: 1 })
      .returning();
    const [r] = await db
      .insert(schema.reps)
      .values({ setId: set!.id, position: 0, tempoMs: 1, rangeDeg: 90, clean: false })
      .returning();
    await db.insert(schema.formFlags).values({ repId: r!.id, ruleId: "depth" });
    await db.insert(schema.posts).values({ authorId: "u-del", kind: "session", body: "hi" });

    await db.delete(schema.users).where(eq(schema.users.id, "u-del"));
    for (const table of [schema.sessions, schema.sets, schema.reps, schema.formFlags, schema.posts]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });

  it("upserts risk insights on (user_id, body_part, as_of) (DB-07)", async () => {
    await db.insert(schema.users).values({ id: "u-risk", handle: "risk" });
    const row = { userId: "u-risk", bodyPart: "knee", asOf: "2026-10-01", score: 0.2 };
    await db.insert(schema.riskInsights).values(row);
    await db
      .insert(schema.riskInsights)
      .values({ ...row, score: 0.6 })
      .onConflictDoUpdate({
        target: [schema.riskInsights.userId, schema.riskInsights.bodyPart, schema.riskInsights.asOf],
        set: { score: sql`excluded.score` },
      });
    const rows = await db.select().from(schema.riskInsights).where(eq(schema.riskInsights.userId, "u-risk"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeCloseTo(0.6);
  });

  it("allows one buddy match per pair in either direction (DB-09)", async () => {
    await db.insert(schema.users).values([
      { id: "u-a", handle: "a_user" },
      { id: "u-b", handle: "b_user" },
    ]);
    await db.insert(schema.buddyMatches).values({ aId: "u-a", bId: "u-b", score: 0.5 });
    await expect(
      db.insert(schema.buddyMatches).values({ aId: "u-b", bId: "u-a", score: 0.5 }),
    ).rejects.toThrow();
  });

  it("rejects following yourself and duplicate kudos (DB-06)", async () => {
    await db.insert(schema.users).values({ id: "u-f", handle: "f_user" });
    await expect(
      db.insert(schema.follows).values({ followerId: "u-f", followeeId: "u-f" }),
    ).rejects.toThrow();
    const [p] = await db
      .insert(schema.posts)
      .values({ authorId: "u-f", kind: "goal", body: "3 golds" })
      .returning();
    await db.insert(schema.kudos).values({ postId: p!.id, userId: "u-f" });
    await expect(db.insert(schema.kudos).values({ postId: p!.id, userId: "u-f" })).rejects.toThrow();
  });
});
