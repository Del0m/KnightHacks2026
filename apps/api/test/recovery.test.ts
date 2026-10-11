// BE-16 / BE-17: range-of-motion trend, physio report and share links, back-to-gym milestone.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "../src/db.js";
import { loadSpecs } from "../src/services/exerciseSpecs.js";
import { MILESTONE_RULES, rangeHeld } from "../src/services/milestone.js";
import { REPORT_DISCLAIMER, romSummary } from "../src/services/physioReport.js";
import { setup } from "./helpers.js";

const SPECS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/exercises");
const NOW = new Date("2026-10-07T12:00:00Z"); // a Wednesday; this week is 2026-10-05

type Rom = typeof schema.romTrend.$inferInsert;
const rom = (userId: string, week: string, left: number, right: number): Rom[] => [
  {
    userId,
    angle: "knee",
    side: "left",
    week,
    peakRangeDeg: left,
    baselineRangeDeg: 80,
    healthySideRangeDeg: right,
    changeDeg: left - 80,
  },
  {
    userId,
    angle: "knee",
    side: "right",
    week,
    peakRangeDeg: right,
    baselineRangeDeg: right,
    healthySideRangeDeg: null,
    changeDeg: 0,
  },
];

async function rehabUser(t: Awaited<ReturnType<typeof setup>>, id: string, displayName = "Sam Rivera") {
  expect((await (await t.as(id)).put("/me/profile", { display_name: displayName })).status).toBe(200);
  const [plan] = await t.db
    .insert(schema.rehabPlans)
    .values({ userId: id, startOn: "2026-09-14", fromPhysio: "Downtown Physio", status: "active" })
    .returning();
  await t.db.insert(schema.rehabLimits).values({
    rehabPlanId: plan!.id,
    exerciseId: "squat",
    angle: "knee",
    side: "both",
    maxRangeDeg: 100,
    sets: 3,
    reps: 10,
  });
  return plan!;
}

/** A finished session with one squat set; `flags` physio_limit flags on its first rep. */
async function workout(db: Db, userId: string, at: string, medal: "bronze" | "silver" | "gold", flags = 0) {
  const when = new Date(at);
  const [s] = await db
    .insert(schema.sessions)
    .values({ userId, startedAt: when, finishedAt: when, medal, inferenceMode: "coreml" })
    .returning();
  const [set] = await db
    .insert(schema.sets)
    .values({ sessionId: s!.id, position: 0, exerciseId: "squat", reps: 3, createdAt: when })
    .returning();
  const reps = await db
    .insert(schema.reps)
    .values(
      [0, 1, 2].map((position) => ({ setId: set!.id, position, tempoMs: 2000, rangeDeg: 90, clean: true })),
    )
    .returning();
  for (let i = 0; i < flags; i++) {
    await db
      .insert(schema.formFlags)
      .values({ repId: reps[0]!.id, ruleId: "physio_limit", severity: "safety" });
  }
}

describe("recovery rules", () => {
  it("summarises the trend in one line", () => {
    const points = [
      { week: "2026-09-14", peak: 80 },
      { week: "2026-10-05", peak: 98 },
    ];
    expect(romSummary("knee", points, 102)).toBe(
      "knee range up 18° in 3 weeks, now within 4° of the healthy side",
    );
    expect(romSummary("knee", points, 120)).toBe(
      "knee range up 18° in 3 weeks, 22° short of the healthy side",
    );
    expect(romSummary("knee", [{ week: "2026-10-05", peak: 98 }], null)).toBe("knee range 98° this week");
    expect(romSummary("knee", [], null)).toBe("No range-of-motion data for the knee yet.");
  });

  it("needs two recent, back-to-back weeks within 5° of the target or the healthy side", () => {
    const row = (week: string, peak: number, healthy: number | null = null) =>
      ({ week, peakRangeDeg: peak, healthySideRangeDeg: healthy }) as never;
    expect(rangeHeld([row("2026-09-28", 97), row("2026-10-05", 98)], 100, "2026-10-07").held).toBe(true);
    expect(rangeHeld([row("2026-09-28", 85), row("2026-10-05", 98)], 100, "2026-10-07").held).toBe(false); // a week short
    expect(rangeHeld([row("2026-09-21", 97), row("2026-10-05", 98)], 100, "2026-10-07").held).toBe(false); // gap
    expect(rangeHeld([row("2026-09-14", 97), row("2026-09-21", 98)], 100, "2026-10-07").held).toBe(false); // stale
    expect(rangeHeld([row("2026-09-28", 90, 93), row("2026-10-05", 91, 94)], 120, "2026-10-07").held).toBe(
      true,
    ); // healthy side
    expect(MILESTONE_RULES).toMatchObject({
      rangeWithinDeg: 5,
      steadyWeeks: 2,
      goodWorkouts: 3,
      flagFreeDays: 7,
    });
  });
});

describe("range of motion and the physio report", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup({ recovery: { now: () => NOW }, planner: { llm: null, embed: null, now: () => NOW } });
    await loadSpecs(t.db, SPECS);
  });
  afterAll(() => t.close());

  it("returns the weekly trend for both sides with a one-line summary", async () => {
    await rehabUser(t, "r-trend");
    await t.db
      .insert(schema.romTrend)
      .values([
        ...rom("r-trend", "2026-09-14", 80, 102),
        ...rom("r-trend", "2026-09-21", 86, 102),
        ...rom("r-trend", "2026-09-28", 93, 103),
        ...rom("r-trend", "2026-10-05", 98, 102),
      ]);
    const res = await (await t.as("r-trend")).get("/me/rom-trend?angle=knee");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      angle: "knee",
      injured_side: "left",
      summary: "knee range up 18° in 3 weeks, now within 4° of the healthy side",
      latest: { week: "2026-10-05", injured: 98, healthy: 102, gap: 4 },
      disclaimer: REPORT_DISCLAIMER,
    });
    expect(res.body.weeks).toEqual([
      { week: "2026-09-14", left: 80, right: 102 },
      { week: "2026-09-21", left: 86, right: 102 },
      { week: "2026-09-28", left: 93, right: 103 },
      { week: "2026-10-05", left: 98, right: 102 },
    ]);
    expect((await (await t.as("r-trend")).get("/me/rom-trend?angle=Knee!")).status).toBe(400);
    expect((await (await t.as("r-trend")).get("/me/rom-trend")).status).toBe(400);
  });

  it("reports sessions, the trend, left/right and reps past the limits", async () => {
    await rehabUser(t, "r-report");
    await t.db
      .insert(schema.romTrend)
      .values([...rom("r-report", "2026-09-28", 93, 103), ...rom("r-report", "2026-10-05", 98, 102)]);
    await workout(t.db, "r-report", "2026-10-05T17:00:00Z", "gold");
    await workout(t.db, "r-report", "2026-10-06T17:00:00Z", "silver", 2);
    const res = await (await t.as("r-report")).get("/me/physio-report?from=2026-10-01&to=2026-10-07");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      disclaimer: REPORT_DISCLAIMER,
      measured_how: expect.stringMatching(/pose tracking/),
      first_name: "Sam",
      range: { from: "2026-10-01", to: "2026-10-07", time_zone: "UTC" },
      sessions: { completed: 2, prescribed: 7 },
      reps_past_limits: 2,
      left_right: [{ angle: "knee", week: "2026-10-05", left: 98, right: 102, difference: 4 }],
    });
    expect(res.body.exercises).toEqual([
      {
        exercise_id: "squat",
        name: "Squat",
        prescribed: [{ angle: "knee", side: "both", max_range_deg: 100, sets: 3, reps: 10 }],
        sets_done: 2,
        reps_past_limits: 2,
      },
    ]);
    // No physio name, handle or email in the report itself.
    expect(JSON.stringify(res.body)).not.toMatch(/Downtown|r-report|@/);

    const def = await (await t.as("r-report")).get("/me/physio-report");
    expect(def.body.range).toMatchObject({ from: "2026-09-14", to: "2026-10-07" });
    expect(
      (await (await t.as("r-report")).get("/me/physio-report?from=2026-10-07&to=2026-10-01")).status,
    ).toBe(400);
    expect((await (await t.as("r-nobody")).get("/me/physio-report")).status).toBe(404);
  });

  it("shares a printable page only through a link the user made, which expires and can be revoked", async () => {
    await rehabUser(t, "r-share", "Alex <script>");
    const me = await t.as("r-share");
    const share = await me.post("/me/physio-report/share", {});
    expect(share.status).toBe(201);
    expect(share.body.path).toMatch(/^\/reports\/[A-Za-z0-9_-]{32}$/);
    expect(share.body.expires_at).toBe("2026-10-21T12:00:00.000Z"); // 14 days by default

    const page = await request(t.app).get(share.body.path); // no token: physios have no account
    expect(page.status).toBe(200);
    expect(page.type).toBe("text/html");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.text).toContain("Alex's progress report");
    expect(page.text).toContain(REPORT_DISCLAIMER);
    expect(page.text).toContain("How this was measured");
    expect(page.text).not.toContain("<script>"); // escaped
    expect(page.text).not.toMatch(/r-share|Downtown/);

    const [stored] = await t.db
      .select()
      .from(schema.reportShares)
      .where(eq(schema.reportShares.userId, "r-share"));
    expect(stored!.tokenHash).not.toContain(share.body.path.split("/")[2]); // only a hash is stored

    expect((await me.get("/me/physio-report/shares")).body).toEqual([
      expect.objectContaining({
        id: share.body.id,
        active: true,
        from_date: "2026-09-14",
        to_date: "2026-10-07",
      }),
    ]);
    expect((await (await t.as("r-other")).delete(`/me/physio-report/shares/${share.body.id}`)).status).toBe(
      404,
    );
    expect((await me.delete(`/me/physio-report/shares/${share.body.id}`)).status).toBe(204);
    expect((await me.delete(`/me/physio-report/shares/${share.body.id}`)).status).toBe(204); // already revoked
    expect((await request(t.app).get(share.body.path)).status).toBe(404);
    expect((await request(t.app).get("/reports/not-a-token")).status).toBe(404);

    // Expiry: a 1-day link opened two days later.
    const short = await me.post("/me/physio-report/share", { expires_in_days: 1 });
    expect((await request(t.app).get(short.body.path)).status).toBe(200);
    const later = await setup({
      db: t.db,
      close: async () => {},
      recovery: { now: () => new Date("2026-10-09T12:00:00Z") },
    });
    expect((await request(later.app).get(short.body.path)).status).toBe(404);
    expect((await me.post("/me/physio-report/share", { expires_in_days: 90 })).status).toBe(400);
  });

  it("keeps a link on the plan that was shared after the user moves to a new one", async () => {
    const first = await rehabUser(t, "r-bound");
    const me = await t.as("r-bound");
    const share = await me.post("/me/physio-report/share", {});
    await t.db.update(schema.rehabPlans).set({ status: "done" }).where(eq(schema.rehabPlans.id, first.id));
    const [second] = await t.db
      .insert(schema.rehabPlans)
      .values({ userId: "r-bound", startOn: "2026-10-06", status: "active" })
      .returning();
    await t.db.insert(schema.rehabLimits).values({
      rehabPlanId: second!.id,
      exerciseId: "lunge",
      angle: "knee",
      side: "both",
      maxRangeDeg: 90,
      sets: 2,
      reps: 8,
    });

    const page = await request(t.app).get(share.body.path);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Rehab plan started 2026-09-14");
    expect(page.text).toContain("Squat");
    expect(page.text).not.toContain("Lunge"); // the new prescription wasn't shared
    // The user's own report follows the current plan.
    expect((await me.get("/me/physio-report")).body.exercises.map((e: { name: string }) => e.name)).toEqual([
      "Lunge",
    ]);
    // Deleting the shared plan ends its links.
    await t.db.delete(schema.rehabPlans).where(eq(schema.rehabPlans.id, first.id));
    expect((await request(t.app).get(share.body.path)).status).toBe(404);
  });
});

describe("back-to-gym milestone", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await setup({ recovery: { now: () => NOW }, planner: { llm: null, embed: null, now: () => NOW } });
    await loadSpecs(t.db, SPECS);
  });
  afterAll(() => t.close());

  async function steady(id: string, lastWeekPeak = 97) {
    await t.db
      .insert(schema.romTrend)
      .values([...rom(id, "2026-09-28", lastWeekPeak, 103), ...rom(id, "2026-10-05", 98, 102)]);
  }
  async function goodWeeks(id: string) {
    for (const day of ["2026-09-28", "2026-10-01", "2026-10-05"])
      await workout(t.db, id, `${day}T17:00:00Z`, "silver");
  }

  it("suggests it when range, medals and limits all hold; accepting ends the rehab plan", async () => {
    const plan = await rehabUser(t, "m-ready");
    await steady("m-ready");
    await goodWeeks("m-ready");
    const me = await t.as("m-ready");
    expect((await me.post("/plans/generate")).status).toBe(409); // still on the rehab plan

    const res = await me.get("/me/milestones");
    expect(res.status).toBe(200);
    expect(res.body.milestone).toMatchObject({
      status: "pending",
      message: expect.stringContaining("Check with your physio first"),
      reasons: [
        "knee range has held at 98° for 2 weeks",
        "3 silver or gold workouts on your rehab exercises in the last 2 weeks (3 needed)",
        "No reps past your physio's limits in the last week",
      ],
    });
    expect(res.body.note).toMatch(/not medical criteria/);
    expect(res.body.checks.every((c: { met: boolean }) => c.met)).toBe(true);
    // Asking again returns the same suggestion.
    expect((await me.get("/me/milestones")).body.milestone.id).toBe(res.body.milestone.id);
    const before = await me.get("/me/limits");
    expect(before.body.limits.squat).toHaveLength(1);

    const accepted = await me.post(`/me/milestones/${res.body.milestone.id}/accept`, { share_post: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      rehab_plan: { id: plan.id, status: "done" },
      post: { body: "Back to the gym!" },
    });
    const limits = await t.db
      .select()
      .from(schema.rehabLimits)
      .where(eq(schema.rehabLimits.rehabPlanId, plan.id));
    expect(limits).toHaveLength(1); // never changes or removes limits
    // ...and the phone keeps applying them: moving on to gym plans doesn't lift the physio's limits.
    const after = await me.get("/me/limits");
    expect(after.body.limits).toEqual(before.body.limits);
    expect(after.body.rehab_plan).toMatchObject({ id: plan.id, status: "done", started: true });
    expect((await me.post(`/me/milestones/${res.body.milestone.id}/accept`)).status).toBe(409); // already accepted
    expect((await me.post("/plans/generate")).status).toBe(201); // gym plans are open again

    // A new rehab plan from the physio replaces them.
    const [next] = await t.db
      .insert(schema.rehabPlans)
      .values({ userId: "m-ready", startOn: "2026-10-01", status: "active" })
      .returning();
    await t.db.insert(schema.rehabLimits).values({
      rehabPlanId: next!.id,
      exerciseId: "lunge",
      angle: "knee",
      side: "both",
      maxRangeDeg: 90,
      sets: 2,
      reps: 8,
    });
    const replaced = await me.get("/me/limits");
    expect(Object.keys(replaced.body.limits)).toEqual(["lunge"]);
    expect(replaced.body.rehab_plan.id).toBe(next!.id);
  });

  it("re-checks on accept, and withdraws a suggestion that no longer holds", async () => {
    const plan = await rehabUser(t, "m-stale");
    await steady("m-stale");
    await goodWeeks("m-stale");
    const me = await t.as("m-stale");
    const { body } = await me.get("/me/milestones");
    expect(body.milestone.status).toBe("pending");
    // A rep past the limits after the suggestion was fetched, and accept without fetching again.
    await workout(t.db, "m-stale", "2026-10-07T09:00:00Z", "gold", 1);
    const res = await me.post(`/me/milestones/${body.milestone.id}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("milestone_no_longer_met");
    expect(res.body.details.checks.find((c: { id: string }) => c.id === "no_limit_flags").met).toBe(false);
    const [still] = await t.db.select().from(schema.rehabPlans).where(eq(schema.rehabPlans.id, plan.id));
    expect(still!.status).toBe("active");
    expect((await me.get("/me/milestones")).body.milestone).toBeNull();
    expect((await me.post(`/me/milestones/${body.milestone.id}/accept`)).status).toBe(404); // withdrawn
  });

  it("waits when the range has held for only one week", async () => {
    await rehabUser(t, "m-short");
    await steady("m-short", 85);
    await goodWeeks("m-short");
    const res = await (await t.as("m-short")).get("/me/milestones");
    expect(res.body.milestone).toBeNull();
    expect(res.body.checks.find((c: { id: string }) => c.id === "range")).toMatchObject({ met: false });
  });

  it("waits after a recent physio_limit flag, and dismissing hides it for two weeks", async () => {
    await rehabUser(t, "m-flag");
    await steady("m-flag");
    await goodWeeks("m-flag");
    await workout(t.db, "m-flag", "2026-10-06T17:00:00Z", "bronze", 1);
    const flagged = await (await t.as("m-flag")).get("/me/milestones");
    expect(flagged.body.milestone).toBeNull();
    expect(flagged.body.checks.find((c: { id: string }) => c.id === "no_limit_flags")).toEqual({
      id: "no_limit_flags",
      met: false,
      detail: "1 rep went past your physio's limits in the last week",
    });

    await rehabUser(t, "m-dismiss");
    await steady("m-dismiss");
    await goodWeeks("m-dismiss");
    const me = await t.as("m-dismiss");
    const { body } = await me.get("/me/milestones");
    const dismissed = await me.post(`/me/milestones/${body.milestone.id}/dismiss`);
    expect(dismissed.body.hidden_until).toBe("2026-10-21T12:00:00.000Z");
    expect((await me.get("/me/milestones")).body).toMatchObject({
      milestone: null,
      hidden_until: "2026-10-21T12:00:00.000Z",
    });
    expect((await (await t.as("m-short")).post(`/me/milestones/${body.milestone.id}/dismiss`)).status).toBe(
      404,
    );
  });
});
