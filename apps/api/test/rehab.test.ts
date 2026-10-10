// DB-12 + BE-15: rehab plans, limits, effective limits and today's session, against the real
// AI-05 specs and the real migrations.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";
import { REHAB_DISCLAIMER, todaysSession } from "../src/services/rehab.js";
import { setup } from "./helpers.js";

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/exercises");

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
  await loadSpecs(t.db, SPECS_DIR);
});
afterAll(() => t.close());

const kneePlan = {
  from_physio: "Riverside Physio",
  start_on: "2026-10-01",
  review_on: "2026-10-29",
  notes: "Keep it pain-free",
  limits: [
    {
      exercise_id: "squat",
      angle: "knee",
      side: "left",
      max_range_deg: 70,
      sets: 3,
      reps: 10,
      tempo_min_ms: 2000,
    },
    { exercise_id: "lunge", angle: "knee", side: "left", max_range_deg: 60, sets: 2, reps: 8 },
  ],
};

describe("DB-12 schema", () => {
  it("adds injuries.side, defaulting to n/a", async () => {
    const api = await t.as("db12-side");
    const plain = await api.post("/me/injuries", { body_part: "neck" });
    expect(plain.body.side).toBe("n/a");
    const sided = await api.post("/me/injuries", { body_part: "knee", side: "left" });
    expect(sided.body.side).toBe("left");
    expect((await api.post("/me/injuries", { body_part: "knee", side: "middle" })).status).toBe(400);
  });

  it("upserts rom_trend on (user_id, angle, side, week), the key CONN-14's sync relies on", async () => {
    await (await t.as("db12-rom")).get("/me/profile");
    const row = { userId: "db12-rom", angle: "knee", side: "left", week: "2026-10-05", peakRangeDeg: 90 };
    await t.db.insert(schema.romTrend).values(row);
    await t.db
      .insert(schema.romTrend)
      .values({ ...row, peakRangeDeg: 104, changeDeg: 14 })
      .onConflictDoUpdate({
        target: [schema.romTrend.userId, schema.romTrend.angle, schema.romTrend.side, schema.romTrend.week],
        set: { peakRangeDeg: sql`excluded.peak_range_deg`, changeDeg: sql`excluded.change_deg` },
      });
    const rows = await t.db.select().from(schema.romTrend).where(eq(schema.romTrend.userId, "db12-rom"));
    expect(rows).toEqual([expect.objectContaining({ peakRangeDeg: 104, changeDeg: 14 })]);
    // CONN-14 owns the table; a week without a peak isn't a trend point.
    await expect(
      t.db
        .insert(schema.romTrend)
        .values({ ...row, week: "2026-10-12", peakRangeDeg: null as unknown as number }),
    ).rejects.toThrow();
  });

  it("cascades every rehab table on user delete", async () => {
    const api = await t.as("db12-cascade");
    await api.post("/me/rehab-plans", kneePlan);
    await t.db
      .insert(schema.romTrend)
      .values({ userId: "db12-cascade", angle: "knee", side: "left", week: "2026-10-05", peakRangeDeg: 80 });
    await t.db.delete(schema.users).where(eq(schema.users.id, "db12-cascade"));
    const left = async (table: typeof schema.rehabPlans | typeof schema.romTrend) =>
      (await t.db.select().from(table).where(eq(table.userId, "db12-cascade"))).length;
    expect(await left(schema.rehabPlans)).toBe(0);
    expect(await left(schema.romTrend)).toBe(0);
    const orphans = await t.db.execute(
      sql`select count(*)::int as n from rehab_limits l left join rehab_plans p on p.id = l.rehab_plan_id where p.id is null`,
    );
    expect((orphans as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(0);
  });
});

describe("DB-12 in the Databricks export (CONN-14 hooks)", () => {
  it("sends the injured side and the active plan's start date, never notes", async () => {
    const api = await t.as("export-rehab");
    await api.post("/me/injuries", { body_part: "knee", side: "left", notes: "private: torn ACL" });
    await api.post("/me/injuries", { body_part: "lower_back" }); // no side -> bare tag
    await api.post("/me/rehab-plans", kneePlan);
    const { id } = (await api.post("/sessions")).body;
    await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      reps: [{ tempo_ms: 2000, range_deg: 70, flags: [] }],
    });
    expect((await api.post(`/sessions/${id}/finish`)).status).toBe(200);

    const exported = t.queue.sessions.find((s) => s.id === id)!;
    expect([...exported.injury_groups].sort()).toEqual(["knee:left", "lower_back"]);
    expect(exported.rehab_start_on).toBe("2026-10-01");
    expect(JSON.stringify(exported)).not.toContain("torn ACL");
  });
});

describe("BE-15 plans", () => {
  it("creates a plan with limits, carrying the disclaimer and exercise names", async () => {
    const api = await t.as("plan-owner");
    const injury = (await api.post("/me/injuries", { body_part: "knee", side: "left" })).body;
    const res = await api.post("/me/rehab-plans", { ...kneePlan, injury_id: injury.id });
    expect(res.status).toBe(201);
    expect(res.body.disclaimer).toBe(REHAB_DISCLAIMER);
    expect(res.body.plan).toMatchObject({
      injury_id: injury.id,
      from_physio: "Riverside Physio",
      start_on: "2026-10-01",
      status: "active",
    });
    expect(res.body.plan).not.toHaveProperty("user_id");
    expect(
      res.body.plan.limits.map((l: { exercise_name: string; max_range_deg: number }) => [
        l.exercise_name,
        l.max_range_deg,
      ]),
    ).toEqual([
      ["Squat", 70],
      ["Lunge", 60],
    ]);

    const list = await api.get("/me/rehab-plans");
    expect(list.body.disclaimer).toBe(REHAB_DISCLAIMER);
    expect(list.body.plans).toHaveLength(1);
    const one = await api.get(`/me/rehab-plans/${res.body.plan.id}`);
    expect(one.body.plan.limits).toHaveLength(2);
  });

  it("validates exercise, angle, range, volume and dates", async () => {
    const api = await t.as("plan-validation");
    const post = (limit: object, extra: object = {}) =>
      api.post("/me/rehab-plans", { start_on: "2026-10-01", ...extra, limits: [limit] });
    const ok = { exercise_id: "squat", angle: "knee", max_range_deg: 70, sets: 3, reps: 10 };

    const unknownExercise = await post({ ...ok, exercise_id: "deadlift" });
    expect(unknownExercise.status).toBe(400);
    expect(unknownExercise.body.details.allowed).toEqual([
      "bicep_curl",
      "lunge",
      "push_up",
      "shoulder_press",
      "squat",
    ]);

    const notInSpec = await post({ ...ok, angle: "elbow" });
    expect(notInSpec.status).toBe(400);
    expect(notInSpec.body.details.allowed).toEqual(["knee"]);
    // trunk is in the squat spec but is a segment tilt, not a joint range.
    expect((await post({ ...ok, angle: "trunk" })).status).toBe(400);

    expect((await post({ ...ok, max_range_deg: 181 })).status).toBe(400);
    expect((await post({ ...ok, max_range_deg: -1 })).status).toBe(400);
    expect((await post({ ...ok, sets: 0 })).status).toBe(400);
    expect((await post({ ...ok, reps: 2.5 })).status).toBe(400);
    expect((await post(ok, { review_on: "2026-09-01" })).status).toBe(400);
    expect((await post(ok, { start_on: "2026-02-31" })).status).toBe(400);
    expect((await post({ ...ok, sneaky: true })).status).toBe(400);

    // Nothing was saved by the rejected requests.
    expect((await api.get("/me/rehab-plans")).body.plans).toHaveLength(0);
    expect((await post(ok)).status).toBe(201);
  });

  it("allows one active plan; paused or done plans don't count", async () => {
    const api = await t.as("plan-active");
    const first = (await api.post("/me/rehab-plans", { start_on: "2026-09-01" })).body.plan;
    const second = await api.post("/me/rehab-plans", { start_on: "2026-10-01" });
    expect(second.status).toBe(409);
    expect(second.body.message).toContain("already have an active rehab plan");

    expect((await api.post("/me/rehab-plans", { start_on: "2026-10-01", status: "paused" })).status).toBe(
      201,
    );
    const paused = await api.put(`/me/rehab-plans/${first.id}`, { status: "done" });
    expect(paused.body.plan.status).toBe("done");
    expect((await api.post("/me/rehab-plans", { start_on: "2026-10-02" })).status).toBe(201);
  });

  it("updates and deletes only the user's own plans", async () => {
    const owner = await t.as("plan-a");
    const other = await t.as("plan-b");
    const plan = (await owner.post("/me/rehab-plans", kneePlan)).body.plan;
    const strangersInjury = (await other.post("/me/injuries", { body_part: "knee" })).body;

    expect((await other.get(`/me/rehab-plans/${plan.id}`)).status).toBe(404);
    expect((await other.put(`/me/rehab-plans/${plan.id}`, { notes: "mine now" })).status).toBe(404);
    expect((await other.delete(`/me/rehab-plans/${plan.id}`)).status).toBe(404);
    expect((await owner.put(`/me/rehab-plans/${plan.id}`, { injury_id: strangersInjury.id })).status).toBe(
      404,
    );
    expect((await owner.put(`/me/rehab-plans/${plan.id}`, { review_on: "2026-09-01" })).status).toBe(400);
    expect((await owner.put(`/me/rehab-plans/${plan.id}`, {})).status).toBe(400);

    const updated = await owner.put(`/me/rehab-plans/${plan.id}`, { review_on: "2026-11-05", notes: null });
    expect(updated.body).toMatchObject({
      disclaimer: REHAB_DISCLAIMER,
      plan: { review_on: "2026-11-05", notes: null },
    });
    expect(updated.body.plan.limits).toHaveLength(2); // limits untouched by a plan edit

    expect((await owner.delete(`/me/rehab-plans/${plan.id}`)).status).toBe(204);
    expect((await owner.get(`/me/rehab-plans/${plan.id}`)).status).toBe(404);
  });

  it("is never public", async () => {
    expect((await request(t.app).get("/me/rehab-plans")).status).toBe(401);
    expect((await request(t.app).get("/me/limits")).status).toBe(401);
  });
});

describe("BE-15 limits", () => {
  it("adds, edits and removes limits with the same checks", async () => {
    const api = await t.as("limits-owner");
    const plan = (await api.post("/me/rehab-plans", { start_on: "2026-10-01" })).body.plan;
    const base = `/me/rehab-plans/${plan.id}/limits`;

    const added = await api.post(base, {
      exercise_id: "bicep_curl",
      angle: "elbow",
      side: "right",
      max_range_deg: 100,
      sets: 3,
      reps: 12,
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      disclaimer: REHAB_DISCLAIMER,
      limit: { angle: "elbow", side: "right" },
    });
    const limitId = added.body.limit.id;

    const dupe = await api.post(base, {
      exercise_id: "bicep_curl",
      angle: "elbow",
      side: "right",
      max_range_deg: 90,
      sets: 3,
      reps: 12,
    });
    expect(dupe.status).toBe(409);
    // Same exercise and angle on the other side is a different limit.
    expect(
      (
        await api.post(base, {
          exercise_id: "bicep_curl",
          angle: "elbow",
          side: "left",
          max_range_deg: 120,
          sets: 3,
          reps: 12,
        })
      ).status,
    ).toBe(201);

    // Limits keep the order they were entered in.
    const ordered = (await api.get(`/me/rehab-plans/${plan.id}`)).body.plan.limits;
    expect(ordered.map((l: { side: string }) => l.side)).toEqual(["right", "left"]);

    expect((await api.put(`${base}/${limitId}`, { angle: "knee" })).status).toBe(400); // no knee in bicep_curl
    expect((await api.put(`${base}/${limitId}`, { max_range_deg: 500 })).status).toBe(400);
    expect((await api.put(`${base}/${limitId}`, { side: "left" })).status).toBe(409);
    const edited = await api.put(`${base}/${limitId}`, { max_range_deg: 110, tempo_min_ms: 1800 });
    expect(edited.body.limit).toMatchObject({ max_range_deg: 110, tempo_min_ms: 1800, sets: 3 });

    const stranger = await t.as("limits-stranger");
    expect(
      (
        await stranger.post(base, {
          exercise_id: "squat",
          angle: "knee",
          max_range_deg: 50,
          sets: 1,
          reps: 1,
        })
      ).status,
    ).toBe(404);
    expect((await stranger.delete(`${base}/${limitId}`)).status).toBe(404);

    expect((await api.delete(`${base}/${limitId}`)).status).toBe(204);
    expect((await api.delete(`${base}/${limitId}`)).status).toBe(404);
  });

  it("keeps limits as entered when specs reload or the injury is deleted", async () => {
    const api = await t.as("limits-safety");
    const injury = (await api.post("/me/injuries", { body_part: "knee", side: "left" })).body;
    const plan = (await api.post("/me/rehab-plans", { ...kneePlan, injury_id: injury.id })).body.plan;
    const before = (await api.get(`/me/rehab-plans/${plan.id}`)).body.plan.limits;

    await loadSpecs(t.db, SPECS_DIR);
    await api.delete(`/me/injuries/${injury.id}`);

    const after = (await api.get(`/me/rehab-plans/${plan.id}`)).body.plan;
    expect(after.injury_id).toBeNull(); // the plan outlives the injury entry
    expect(after.limits).toEqual(before);
  });
});

describe("BE-15 GET /me/limits", () => {
  it("returns injury body parts, the overrides they map to, and the active plan's limits", async () => {
    const api = await t.as("limits-reader");
    await api.post("/me/injuries", { body_part: "knee", side: "left" });
    await api.post("/me/injuries", { body_part: "wrist", side: "right" }); // no spec override for wrists
    const plan = (await api.post("/me/rehab-plans", kneePlan)).body.plan;

    const res = await api.get("/me/limits");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 1,
      disclaimer: REHAB_DISCLAIMER,
      injuries: [
        { body_part: "knee", side: "left" },
        { body_part: "wrist", side: "right" },
      ],
      body_parts: ["knee", "wrist"], // the phone skips wrist: no spec has a wrist override
      rehab_plan: { id: plan.id, status: "active", start_on: "2026-10-01" },
    });
    expect(res.body.limits).toEqual({
      squat: [{ angle: "knee", side: "left", max_range_deg: 70, sets: 3, reps: 10, tempo_min_ms: 2000 }],
      lunge: [{ angle: "knee", side: "left", max_range_deg: 60, sets: 2, reps: 8, tempo_min_ms: null }],
    });

    // A paused plan's limits no longer apply.
    await api.put(`/me/rehab-plans/${plan.id}`, { status: "paused" });
    const paused = (await api.get("/me/limits")).body;
    expect(paused.rehab_plan).toBeNull();
    expect(paused.limits).toEqual({});
    expect(paused.body_parts).toEqual(["knee", "wrist"]); // injury overrides still apply
  });

  it("is empty for a new user", async () => {
    const res = await (await t.as("limits-new")).get("/me/limits");
    expect(res.body).toMatchObject({
      version: 1,
      injuries: [],
      body_parts: [],
      rehab_plan: null,
      limits: {},
    });
  });
});

describe("BE-15 today's rehab session", () => {
  it("lists prescribed exercises with sets done today", async () => {
    const api = await t.as("today-user");
    await api.post("/me/rehab-plans", {
      ...kneePlan,
      limits: [
        ...kneePlan.limits,
        // Per-side entries that disagree: the smaller dose and slower tempo are shown.
        {
          exercise_id: "squat",
          angle: "knee",
          side: "right",
          max_range_deg: 90,
          sets: 4,
          reps: 12,
          tempo_min_ms: 2500,
        },
      ],
    });
    const { id } = (await api.post("/sessions")).body;
    await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      reps: [{ tempo_ms: 2000, range_deg: 70, flags: [] }],
    });

    const res = await api.get("/me/rehab-plans/active/today");
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe(REHAB_DISCLAIMER);
    expect(res.body.plan).toMatchObject({ from_physio: "Riverside Physio", started: true });
    expect(res.body.exercises.map((e: { exercise_id: string }) => e.exercise_id)).toEqual(["squat", "lunge"]);
    expect(res.body.exercises[0]).toMatchObject({
      name: "Squat",
      sets: 3,
      reps: 10,
      tempo_min_ms: 2500,
      sets_done_today: 1,
    });
    expect(res.body.exercises[0].limits).toHaveLength(2);
    expect(res.body.exercises[1]).toMatchObject({ sets: 2, reps: 8, sets_done_today: 0 });
  });

  it("counts 'today' in the user's time zone", async () => {
    const api = await t.as("today-tz");
    await api.post("/me/rehab-plans", kneePlan);
    // 02:00 UTC on the 11th is still the evening of the 10th in New York.
    const { id } = (await api.post("/sessions", { started_at: "2026-10-11T02:00:00Z" })).body;
    await api.post(`/sessions/${id}/sets`, {
      exercise_id: "squat",
      reps: [{ tempo_ms: 2000, range_deg: 70, flags: [] }],
    });

    const now = new Date("2026-10-11T03:00:00Z");
    const ny = await todaysSession(t.db, "today-tz", "America/New_York", now);
    expect(ny.date).toBe("2026-10-10");
    expect(ny.exercises.find((e) => e.exerciseId === "squat")?.setsDoneToday).toBe(1);
    const utc = await todaysSession(t.db, "today-tz", "UTC", new Date("2026-10-12T03:00:00Z"));
    expect(utc.exercises.find((e) => e.exerciseId === "squat")?.setsDoneToday).toBe(0);

    expect((await api.get("/me/rehab-plans/active/today?tz=Mars/Olympus")).status).toBe(400);
  });

  it("returns 404 without an active plan", async () => {
    expect((await (await t.as("today-none")).get("/me/rehab-plans/active/today")).status).toBe(404);
  });
});
