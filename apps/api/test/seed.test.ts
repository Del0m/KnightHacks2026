// DB-10: the demo seed runs on a fresh branch, resets on re-run, and the API serves it.
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo, type SeedSummary } from "../scripts/seed-demo.js";
import { schema } from "../src/db.js";
import { setup } from "./helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
let summary: SeedSummary;
const now = new Date("2026-10-10T12:00:00Z");

beforeAll(async () => {
  t = await setup();
  summary = await seedDemo(t.db, { now, presenterUserId: "presenter-neon-id" });
}, 120_000);
afterAll(() => t.close());

const count = async (table: PgTable) =>
  (await t.db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

describe("seed-demo", () => {
  it("creates ~30 lifters at 2 gyms with 6 weeks of history", async () => {
    expect(summary.users).toBe(30);
    expect(await count(schema.users)).toBe(30);
    const gyms = await t.db.selectDistinct({ gym: schema.profiles.gymPlaceId }).from(schema.profiles);
    expect(gyms).toHaveLength(2);

    expect(summary.sessions).toBeGreaterThan(300);
    expect(await count(schema.medals)).toBe(summary.sessions);
    expect(summary.medals.gold).toBeGreaterThan(0);
    expect(summary.medals.silver).toBeGreaterThan(0);
    expect(summary.medals.bronze).toBeGreaterThan(0);
    for (const n of [
      summary.personalRecords,
      summary.posts,
      summary.comments,
      summary.kudos,
      summary.buddyMatches,
    ]) {
      expect(n).toBeGreaterThan(0);
    }

    const [range] = await t.db
      .select({
        first: sql<string>`min(${schema.sessions.finishedAt})`,
        last: sql<string>`max(${schema.sessions.finishedAt})`,
      })
      .from(schema.sessions);
    const spanDays = (Date.parse(range!.last) - Date.parse(range!.first)) / 86_400_000;
    expect(spanDays).toBeGreaterThan(35);
    expect(Date.parse(range!.last)).toBeLessThanOrEqual(now.getTime());
  });

  it("serves the presenter's account through the real API", async () => {
    const api = await t.as("presenter-neon-id");
    expect((await api.get("/me/profile")).body.gym_name).toBeTruthy();
    const feed = await api.get("/feed");
    expect(feed.body.posts.length).toBeGreaterThan(0);
    const progress = await api.get("/me/progress?days=60");
    expect(progress.body.form_trend.length).toBeGreaterThan(5);
    expect((await api.get("/buddies/suggestions")).status).toBe(200);
  });

  it("gives the presenter the §17 recovery story: a knee plan and range coming back", async () => {
    expect(summary.rehabPlans).toBeGreaterThan(0);
    const api = await t.as("presenter-neon-id");

    const limits = (await api.get("/me/limits")).body;
    expect(limits.body_parts).toEqual(["knee"]);
    expect(limits.injuries).toEqual([{ body_part: "knee", side: "left" }]);
    expect(Object.keys(limits.limits)).toEqual(["squat", "lunge"]);
    expect(limits.rehab_plan.status).toBe("active");

    const today = await api.get("/me/rehab-plans/active/today");
    expect(today.status).toBe(200);
    expect(today.body.exercises.map((e: { exercise_id: string }) => e.exercise_id)).toEqual([
      "squat",
      "lunge",
    ]);

    const trend = await t.db
      .select()
      .from(schema.romTrend)
      .where(eq(schema.romTrend.userId, "presenter-neon-id"))
      .orderBy(schema.romTrend.week);
    expect(trend).toHaveLength(6);
    const last = trend.at(-1)!;
    expect(last.peakRangeDeg! - trend.at(-4)!.peakRangeDeg!).toBe(18); // up 18° in three weeks
    expect(last.healthySideRangeDeg! - last.peakRangeDeg!).toBeLessThanOrEqual(5); // within 5°
  });

  it("resets instead of duplicating when run again", async () => {
    const again = await seedDemo(t.db, { now, presenterUserId: "presenter-neon-id" });
    expect(again).toEqual(summary); // deterministic
    expect(await count(schema.users)).toBe(30);
    expect(await count(schema.sessions)).toBe(summary.sessions);
    expect(await count(schema.exercises)).toBe(5);
  }, 120_000);
});
