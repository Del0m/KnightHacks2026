// CONN-13: DELETE /me removes everything in Neon and queues the pseudonym for Databricks.
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { pseudonymize } from "../src/integrations/databricks/upload.js";
import { createTestDb, rep, setup } from "./helpers.js";

const SECRET = "test-pseudonym-secret-123456";
const ME = "delete-me";
const OTHER = "stays";

let client: PGlite;
let t: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  const created = await createTestDb();
  client = created.client;
  t = await setup({ db: created.db, close: created.close, pseudonymSecret: SECRET });
});
afterAll(() => t.close());

// Every foreign key that points at users, read from the database itself.
async function userForeignKeys() {
  const { rows } = await client.query<{ table_name: string; column_name: string; delete_rule: string }>(`
    SELECT kcu.table_name, kcu.column_name, rc.delete_rule
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.constraint_name
    WHERE ccu.table_name = 'users'`);
  return rows;
}

async function rowsFor(userId: string) {
  const counts: Record<string, number> = {};
  for (const fk of await userForeignKeys()) {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${fk.table_name}" WHERE "${fk.column_name}" = $1`,
      [userId],
    );
    counts[`${fk.table_name}.${fk.column_name}`] = rows[0]!.n;
  }
  return counts;
}

const count = async (table: string) =>
  (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0]!.n;

describe("account deletion", () => {
  it("cascades every foreign key to users, including tables added later", async () => {
    const fks = await userForeignKeys();
    expect(fks.length).toBeGreaterThan(15);
    expect(fks.filter((fk) => fk.delete_rule !== "CASCADE")).toEqual([]);
  });

  it("deletes all of the user's data, keeps everyone else's, and queues only the pseudonym", async () => {
    const me = await t.as(ME);
    const other = await t.as(OTHER);
    await other.get("/me/profile"); // users are created on their first request
    await me.put("/me/profile", { bio: "deleting soon", goals: ["squat 100"] });
    await me.post("/me/injuries", { body_part: "knee", notes: "private note" });
    const { id: sessionId } = (await me.post("/sessions", { device: "iPhone" })).body;
    await me.post(`/sessions/${sessionId}/sets`, {
      exercise_id: "squat",
      weight_kg: 60,
      reps: [rep(), rep(["depth"])],
    });
    await me.post(`/sessions/${sessionId}/finish`);
    // Posts are only visible (and commentable) between followers.
    await me.post(`/follows/${OTHER}`);
    await other.post(`/follows/${ME}`);
    const myPost = (await me.post("/posts", { kind: "goal", body: "my post" })).body;
    const theirPost = (await other.post("/posts", { kind: "goal", body: "their post" })).body;
    await me.post(`/posts/${theirPost.id}/comments`, { body: "my comment" });
    await other.post(`/posts/${myPost.id}/comments`, { body: "their comment on my post" });
    await me.post(`/posts/${theirPost.id}/kudos`);
    await t.db.insert(schema.buddyMatches).values({ aId: OTHER, bId: ME, score: 0.8 });
    await t.db.insert(schema.goals).values({ userId: ME, description: "3 gold workouts" });
    await t.db
      .insert(schema.progressDaily)
      .values({ userId: ME, date: "2026-10-08", exerciseId: "squat", reps: 2 });
    await t.db
      .insert(schema.riskInsights)
      .values({ userId: ME, bodyPart: "knee", score: 0.6, asOf: "2026-10-08" });

    const before = await rowsFor(ME);
    const populated = Object.entries(before)
      .filter(([, n]) => n > 0)
      .map(([k]) => k);
    expect(populated).toEqual(
      expect.arrayContaining([
        "profiles.user_id",
        "injuries.user_id",
        "sessions.user_id",
        "posts.author_id",
        "comments.author_id",
        "kudos.user_id",
        "follows.follower_id",
        "follows.followee_id",
        "buddy_matches.b_id",
        "goals.user_id",
        "progress_daily.user_id",
        "risk_insights.user_id",
      ]),
    );
    expect(await count("reps")).toBeGreaterThan(0);

    expect((await me.delete("/me")).status).toBe(204);

    expect(Object.values(await rowsFor(ME)).every((n) => n === 0)).toBe(true);
    expect(await t.db.select().from(schema.users).where(eq(schema.users.id, ME))).toEqual([]);
    for (const child of ["sets", "reps", "form_flags", "medals"]) expect(await count(child)).toBe(0);

    // The other user keeps their account and post, minus my comment and kudos.
    const theirs = await other.get(`/posts/${theirPost.id}/comments`);
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.body)).not.toContain("my comment");
    expect((await rowsFor(OTHER))["posts.author_id"]).toBe(1);

    // Databricks request: the pseudonym and bookkeeping only.
    const requests = await t.db.select().from(schema.deletionRequests);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      pseudonym: pseudonymize(ME, SECRET),
      status: "pending",
      attempts: 0,
    });
    expect(JSON.stringify(requests)).not.toContain(ME);
  });

  it("starts a fresh empty account for a still-valid token, and deleting again is harmless", async () => {
    // Any request re-creates an empty account (users are provisioned on first request), so the
    // old data doesn't come back.
    const me = await t.as(ME);
    const fresh = await me.get("/me/profile");
    expect(fresh.status).toBe(200);
    expect(fresh.body.bio).toBeNull();
    expect((await me.get("/me/injuries")).body).toEqual([]);

    // Deleting that empty account queues the same pseudonym again; the Databricks job treats it
    // as a duplicate with nothing left to delete.
    expect((await me.delete("/me")).status).toBe(204);
    const requests = await t.db.select().from(schema.deletionRequests);
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((r) => r.pseudonym))).toEqual(new Set([pseudonymize(ME, SECRET)]));
  });

  it("queues nothing for a user who never had Databricks data", async () => {
    const noSecret = await setup({ pseudonymSecret: undefined });
    const api = await noSecret.as("never-exported");
    await api.get("/me/profile");
    expect((await api.delete("/me")).status).toBe(204);
    expect(await noSecret.db.select().from(schema.deletionRequests)).toEqual([]);
    await noSecret.close();
  });
});
