// BE-04 + BE-05 through the real app: create, add sets, finish, medal, PRs, export queue.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { JointsBuffer } from "../src/services/exportQueue.js";
import { frames, rep, setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

async function startSession(user: string, body: object = {}) {
  const api = await t.as(user);
  const res = await api.post("/sessions", { device: "iPhone 17 Pro", ...body });
  expect(res.status).toBe(201);
  return { api, id: res.body.id as string };
}

describe("session lifecycle", () => {
  it("creates the user on first request and starts a session", async () => {
    const { id } = await startSession("lifter-1");
    expect(id).toMatch(/[0-9a-f-]{36}/);
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, "lifter-1"));
    expect(user?.handle).toMatch(/^lifter_[0-9a-f]{10}$/);
  });

  it("stores per-rep aggregates and flags, keeps joints out of Neon, and finishes with a medal", async () => {
    const { api, id } = await startSession("lifter-2");

    const set1 = await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      weight_kg: 60,
      fps: 30,
      frames: frames(10),
      reps: [rep(), rep(), rep(["knee_tracking"]), rep()],
    });
    expect(set1.status).toBe(201);
    expect(set1.body).toMatchObject({ position: 0, reps: 4, clean_reps: 3, clean_share: 0.75 });

    const set2 = await api.post(`/sessions/${id}/sets`, {
      exercise_id: "push_up",
      reps: [rep(), rep(), rep(), rep(), rep(), rep()],
    });
    expect(set2.body.position).toBe(1);

    const flags = await t.db.select().from(schema.formFlags);
    expect(flags.map((f) => f.ruleId)).toEqual(["knee_tracking"]);

    const finish = await api.post(`/sessions/${id}/finish`);
    expect(finish.status).toBe(200);
    // 9 of 10 clean vs the 70% first-workout baseline -> silver.
    expect(finish.body).toMatchObject({
      medal: "silver",
      total_reps: 10,
      clean_reps: 9,
      baseline_share: 0.7,
    });
    expect(finish.body.form_score).toBeCloseTo(0.9);
    expect(finish.body.personal_records.map((p: { metric: string }) => p.metric).sort()).toEqual([
      "est_1rm_kg",
      "max_reps",
      "max_weight_kg",
    ]);

    const [medal] = await t.db.select().from(schema.medals).where(eq(schema.medals.sessionId, id));
    expect(medal?.tier).toBe("silver");

    // Queued for Databricks with the buffered joints; the queue gets the raw id and the
    // uploader pseudonymizes it (covered in export.test.ts).
    const exported = t.queue.sessions.find((s) => s.id === id)!;
    expect(exported.sets).toHaveLength(2);
    expect(exported.sets[0]!.frames).toHaveLength(10);
    expect(exported.sets[0]!.fps).toBe(30);
    expect(exported.sets[0]!.reps[2]!.flags).toEqual([{ rule_id: "knee_tracking", severity: "warn" }]);
    expect(exported.sets[1]!.frames).toEqual([]);
    expect(exported.medal).toBe("silver");
  });

  it("compares later workouts with the lifter's own 4-week average", async () => {
    const user = "lifter-3";
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 18)).toISOString();

    // Week 1: 8/10 clean -> silver vs 70%.
    let s = await startSession(user, { started_at: day(1) });
    await s.api.post(`/sessions/${s.id}/sets`, {
      exercise_id: "squat",
      weight_kg: 50,
      reps: [...Array(8)].map(() => rep()).concat([rep(["depth"]), rep(["depth"])]),
    });
    expect((await s.api.post(`/sessions/${s.id}/finish`, { finished_at: day(1) })).body.medal).toBe("silver");

    // 7/10 clean is now below the lifter's 80% average -> bronze, even though it beats 70%.
    s = await startSession(user, { started_at: day(3) });
    await s.api.post(`/sessions/${s.id}/sets`, {
      exercise_id: "squat",
      weight_kg: 45,
      reps: [...Array(7)].map(() => rep()).concat([rep(["depth"]), rep(["depth"]), rep(["depth"])]),
    });
    const second = await s.api.post(`/sessions/${s.id}/finish`, { finished_at: day(3) });
    expect(second.body).toMatchObject({ medal: "bronze", baseline_share: 0.8 });
    expect(second.body.personal_records).toEqual([]); // 45 kg doesn't beat 50 kg

    // Every rep clean -> gold.
    s = await startSession(user, { started_at: day(5) });
    await s.api.post(`/sessions/${s.id}/sets`, {
      exercise_id: "squat",
      weight_kg: 55,
      reps: [rep(), rep(), rep()],
    });
    const third = await s.api.post(`/sessions/${s.id}/finish`, { finished_at: day(5) });
    expect(third.body.medal).toBe("gold");
    expect(
      third.body.personal_records.find((p: { metric: string }) => p.metric === "max_weight_kg"),
    ).toMatchObject({
      value: 55,
      previous_value: 50,
    });
  });

  it("auto-posts medals and PRs only when the user opted in", async () => {
    const quiet = await startSession("lifter-quiet");
    await quiet.api.post(`/sessions/${quiet.id}/sets`, {
      exercise_id: "squat",
      weight_kg: 40,
      reps: [rep()],
    });
    expect((await quiet.api.post(`/sessions/${quiet.id}/finish`)).body.posts).toEqual([]);

    const loud = await startSession("lifter-loud");
    await loud.api.put("/me/profile", { auto_post_medals: true, auto_post_prs: true });
    await loud.api.post(`/sessions/${loud.id}/sets`, { exercise_id: "squat", weight_kg: 40, reps: [rep()] });
    const res = await loud.api.post(`/sessions/${loud.id}/finish`);
    expect(res.body.posts.map((p: { kind: string }) => p.kind).sort()).toEqual(["medal", "pr"]);
    const posts = await t.db.select().from(schema.posts).where(eq(schema.posts.authorId, "lifter-loud"));
    expect(posts.map((p) => p.body)).toContain("Finished a gold-level workout");
    expect(posts.map((p) => p.body)).toContain("New squat PR: 40 kg");
  });

  it("rejects bad input, other people's sessions and double finishes", async () => {
    const { api, id } = await startSession("lifter-4");
    const bad = await api.post(`/sessions/${id}/sets`, { exercise_id: "Squat!", reps: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("validation_failed");

    const badFrame = await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      reps: [rep()],
      frames: [{ t_ms: 0, kp: [1, 2, 3] }],
    });
    expect(badFrame.status).toBe(400);

    const stranger = await t.as("lifter-5");
    expect(
      (await stranger.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] })).status,
    ).toBe(404);
    expect((await stranger.post(`/sessions/${id}/finish`)).status).toBe(404);

    await api.post(`/sessions/${id}/sets`, { set_index: 0, exercise_id: "squat", reps: [rep()] });
    const dupe = await api.post(`/sessions/${id}/sets`, {
      set_index: 0,
      exercise_id: "squat",
      reps: [rep()],
    });
    expect(dupe.status).toBe(409);
    expect(dupe.body.message).toBe("Set 0 was already recorded for this session");

    expect((await api.post(`/sessions/${id}/finish`)).status).toBe(200);
    expect((await api.post(`/sessions/${id}/finish`)).status).toBe(409);
    expect((await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] })).status).toBe(
      409,
    );
  });

  it("requires a token", async () => {
    const { default: request } = await import("supertest");
    expect((await request(t.app).post("/sessions").send({})).status).toBe(401);
  });
});

// PR #105 review notes.
describe("set positions", () => {
  it("continues after the highest position when set_index leaves gaps", async () => {
    const { api, id } = await startSession("pos-gaps");
    await api.post(`/sessions/${id}/sets`, { set_index: 0, exercise_id: "squat", reps: [rep()] });
    await api.post(`/sessions/${id}/sets`, { set_index: 2, exercise_id: "squat", reps: [rep()] });
    const next = await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] });
    expect(next.status).toBe(201);
    expect(next.body.position).toBe(3); // count(*) would have picked 2 and collided
  });

  // PGlite has one connection, so this can't race here the way it did on Neon (8 concurrent sets,
  // 6 rejected) before the session row lock; it pins the behaviour so a refactor can't drop it.
  it("gives concurrent sets distinct positions", async () => {
    const { api, id } = await startSession("pos-concurrent");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(results.map((r) => r.body.position).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("finish when the export step fails", () => {
  // Fails the first read of the joints buffer, which happens while the export upload is built.
  class FlakyJoints extends JointsBuffer {
    failNext = true;
    override peek(sessionId: string) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("simulated failure while building the export");
      }
      return super.peek(sessionId);
    }
  }

  it("rolls back so a retry gets the medal, and uploads the joints once", async () => {
    const joints = new FlakyJoints();
    const f = await setup({ joints });
    try {
      const api = await f.as("flaky-export");
      const { id } = (await api.post("/sessions")).body;
      await api.post(`/sessions/${id}/sets`, {
        exercise_id: "squat",
        fps: 30,
        frames: frames(4),
        reps: [rep()],
      });

      expect((await api.post(`/sessions/${id}/finish`)).status).toBe(500);
      const [afterFailure] = await f.db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
      expect(afterFailure?.finishedAt).toBeNull(); // rolled back, not finished without a result
      expect(await f.db.select().from(schema.medals).where(eq(schema.medals.sessionId, id))).toHaveLength(0);

      const retry = await api.post(`/sessions/${id}/finish`);
      expect(retry.status).toBe(200);
      expect(retry.body.medal).toBe("gold");
      expect(f.queue.sessions).toHaveLength(1);
      expect(f.queue.sessions[0]!.sets[0]!.frames).toHaveLength(4); // joints survived the failed attempt
      expect(joints.peek(id).size).toBe(0); // and were drained after the commit
    } finally {
      await f.close();
    }
  });

  it("still returns the result if queueing the upload throws", async () => {
    const f = await setup({
      exportQueue: {
        enqueue() {
          throw new Error("queue down");
        },
      },
    });
    try {
      const api = await f.as("queue-down");
      const { id } = (await api.post("/sessions")).body;
      await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep()] });
      const res = await api.post(`/sessions/${id}/finish`);
      expect(res.status).toBe(200);
      expect(res.body.medal).toBe("gold");
      const [session] = await f.db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
      expect(session?.exportStatus).toBe("pending");
    } finally {
      await f.close();
    }
  });
});

it("recovers a finished summary without awarding again and keeps it private", async () => {
  const { api, id } = await startSession("summary-recovery");
  expect((await api.get(`/sessions/${id}/summary`)).status).toBe(409);
  await api.post(`/sessions/${id}/sets`, { exercise_id: "squat", reps: [rep(), rep()] });
  const finished = await api.post(`/sessions/${id}/finish`);
  const recovered = await api.get(`/sessions/${id}/summary`);
  expect(recovered.status).toBe(200);
  expect(recovered.body).toEqual(finished.body);
  expect((await (await t.as("summary-stranger")).get(`/sessions/${id}/summary`)).status).toBe(404);
});
