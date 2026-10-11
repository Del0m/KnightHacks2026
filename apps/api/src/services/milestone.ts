// BE-17: suggest moving from the rehab plan to a regular gym plan (Architecture §1.1, §8).
//
// The suggestion appears when range and form have been steady at the physio's targets. The user
// always decides: accepting marks the rehab plan done (so POST /plans/generate works again) and
// never changes or removes a limit. Every suggestion says to check with the physio first.
//
// The thresholds are rules of thumb, not medical criteria. They live in MILESTONE_RULES so they're
// easy to tune, and every response says what they are.
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { conflict, HttpError, notFound } from "../http.js";
import { addDays, daysBetween, mondayOf } from "./planHistory.js";
import { PHYSIO_LIMIT_RULE } from "./physioReport.js";
import { activePlan, started } from "./rehab.js";

const { milestones, rehabPlans, rehabLimits, romTrend, sessions, sets, reps, formFlags, posts } = schema;

export const MILESTONE_RULES = {
  rangeWithinDeg: 5, // of the physio's maximum range, or of the healthy side
  steadyWeeks: 2, // consecutive weeks of rom_trend at that range
  goodWorkouts: 3, // silver or gold workouts that include the rehab plan's exercises...
  goodWorkoutDays: 14, // ...in this many days
  flagFreeDays: 7, // no physio_limit flags in this many days
  dismissDays: 14, // a dismissed suggestion stays hidden this long
} as const;

export const MILESTONE_NOTE =
  "These checks are rules of thumb, not medical criteria. Your physio decides when you're ready.";
export const MILESTONE_MESSAGE =
  "Your range and form have held steady at your physio's targets. Check with your physio first; if they agree, " +
  "you can move on to a regular gym plan. Your rehab limits stay as they are until you change them.";
export const BACK_TO_GYM_POST = "Back to the gym!";

export interface MilestoneCheck {
  id: "range" | "good_workouts" | "no_limit_flags";
  met: boolean;
  detail: string;
}

type Rom = typeof romTrend.$inferSelect;

/** Whether one angle and side has held near its target for the last steadyWeeks weeks. */
export function rangeHeld(rows: Rom[], target: number, today: string, rules = MILESTONE_RULES) {
  const recent = [...rows].sort((a, b) => b.week.localeCompare(a.week)).slice(0, rules.steadyWeeks);
  if (recent.length < rules.steadyWeeks) return { held: false, peak: recent[0]?.peakRangeDeg ?? null };
  // The newest week must be this week or last week, and the weeks must be back to back.
  const fresh = daysBetween(recent[0]!.week, mondayOf(today)) <= 7;
  const consecutive = recent.every((r, i) => i === 0 || daysBetween(r.week, recent[i - 1]!.week) === 7);
  const near = recent.every(
    (r) =>
      Math.abs(r.peakRangeDeg - target) <= rules.rangeWithinDeg ||
      (r.healthySideRangeDeg !== null &&
        Math.abs(r.peakRangeDeg - r.healthySideRangeDeg) <= rules.rangeWithinDeg),
  );
  return { held: fresh && consecutive && near, peak: recent[0]!.peakRangeDeg };
}

export async function evaluateMilestone(db: Db, userId: string, today: string, now = new Date()) {
  const plan = await activePlan(db, userId);
  if (!plan || !started(plan, today)) return { plan: null, checks: [] as MilestoneCheck[], eligible: false };

  const limits = await db
    .select({
      exerciseId: rehabLimits.exerciseId,
      angle: rehabLimits.angle,
      side: rehabLimits.side,
      maxRangeDeg: rehabLimits.maxRangeDeg,
    })
    .from(rehabLimits)
    .where(eq(rehabLimits.rehabPlanId, plan.id));
  const exerciseIds = [...new Set(limits.map((l) => l.exerciseId))];

  // 1. Range: every prescribed angle and side, against its own maximum range.
  const rom = limits.length
    ? await db
        .select()
        .from(romTrend)
        .where(
          and(
            eq(romTrend.userId, userId),
            inArray(romTrend.angle, [...new Set(limits.map((l) => l.angle))]),
            gte(romTrend.week, addDays(mondayOf(today), -7 * (MILESTONE_RULES.steadyWeeks + 1))),
          ),
        )
    : [];
  const ranges = limits.flatMap((l) =>
    (l.side === "both" ? ["left", "right"] : [l.side]).map((side) => ({
      angle: l.angle,
      side,
      ...rangeHeld(
        rom.filter((r) => r.angle === l.angle && r.side === side),
        l.maxRangeDeg,
        today,
      ),
    })),
  );
  const rangeMet = ranges.length > 0 && ranges.every((r) => r.held);
  const shown = ranges.find((r) => r.peak !== null);
  const rangeDetail = !ranges.length
    ? "The rehab plan has no range limits to compare against"
    : rangeMet
      ? `${shown!.angle} range has held at ${Math.round(shown!.peak!)}° for ${MILESTONE_RULES.steadyWeeks} weeks`
      : shown
        ? `${shown.angle} range is ${Math.round(shown.peak!)}°; it needs ${MILESTONE_RULES.steadyWeeks} weeks in a row within ${MILESTONE_RULES.rangeWithinDeg}° of the target`
        : "No range-of-motion data yet";

  // 2. Silver or gold workouts that included a rehab exercise.
  const since = new Date(now.getTime() - MILESTONE_RULES.goodWorkoutDays * 86_400_000);
  const [good] = exerciseIds.length
    ? await db
        .select({ n: sql<number>`count(distinct ${sessions.id})::int` })
        .from(sessions)
        .innerJoin(sets, eq(sets.sessionId, sessions.id))
        .where(
          and(
            eq(sessions.userId, userId),
            isNotNull(sessions.finishedAt),
            gte(sessions.finishedAt, since),
            inArray(sessions.medal, ["silver", "gold"]),
            inArray(sets.exerciseId, exerciseIds),
          ),
        )
    : [{ n: 0 }];
  const goodCount = good?.n ?? 0;
  const goodMet = goodCount >= MILESTONE_RULES.goodWorkouts;

  // 3. No reps past the physio's limits lately (AI-16's physio_limit flags).
  const flagSince = new Date(now.getTime() - MILESTONE_RULES.flagFreeDays * 86_400_000);
  const [flagged] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(formFlags)
    .innerJoin(reps, eq(reps.id, formFlags.repId))
    .innerJoin(sets, eq(sets.id, reps.setId))
    .innerJoin(sessions, eq(sessions.id, sets.sessionId))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(formFlags.ruleId, PHYSIO_LIMIT_RULE),
        gte(sets.createdAt, flagSince),
      ),
    );
  const flagCount = flagged?.n ?? 0;

  const checks: MilestoneCheck[] = [
    { id: "range", met: rangeMet, detail: rangeDetail },
    {
      id: "good_workouts",
      met: goodMet,
      detail: `${goodCount} silver or gold ${goodCount === 1 ? "workout" : "workouts"} on your rehab exercises in the last ${MILESTONE_RULES.goodWorkoutDays / 7} weeks (${MILESTONE_RULES.goodWorkouts} needed)`,
    },
    {
      id: "no_limit_flags",
      met: flagCount === 0,
      detail:
        flagCount === 0
          ? "No reps past your physio's limits in the last week"
          : `${flagCount} ${flagCount === 1 ? "rep" : "reps"} went past your physio's limits in the last week`,
    },
  ];
  return { plan, checks, eligible: checks.every((c) => c.met) };
}

function present(row: typeof milestones.$inferSelect) {
  return {
    id: row.id,
    rehabPlanId: row.rehabPlanId,
    status: row.status,
    message: MILESTONE_MESSAGE,
    reasons: row.reasons,
    createdAt: row.createdAt,
  };
}

/** GET /me/milestones: the pending suggestion (created when the checks pass), with the checks. */
export async function currentMilestone(db: Db, userId: string, today: string, now = new Date()) {
  const { plan, checks, eligible } = await evaluateMilestone(db, userId, today, now);
  const base = { rules: MILESTONE_RULES, note: MILESTONE_NOTE, checks };
  if (!plan) return { ...base, milestone: null, hiddenUntil: null };

  const [latest] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.userId, userId), eq(milestones.rehabPlanId, plan.id)))
    .orderBy(desc(milestones.createdAt))
    .limit(1);
  if (latest?.status === "dismissed" && latest.hiddenUntil && latest.hiddenUntil > now) {
    return { ...base, milestone: null, hiddenUntil: latest.hiddenUntil };
  }
  const reasons = checks.map((c) => c.detail);
  if (!eligible) {
    // No longer true: an old suggestion shouldn't linger.
    if (latest?.status === "pending") await db.delete(milestones).where(eq(milestones.id, latest.id));
    return { ...base, milestone: null, hiddenUntil: null };
  }
  if (latest?.status === "pending") {
    const [row] = await db
      .update(milestones)
      .set({ reasons })
      .where(eq(milestones.id, latest.id))
      .returning();
    return { ...base, milestone: present(row!), hiddenUntil: null };
  }
  const [row] = await db.insert(milestones).values({ userId, rehabPlanId: plan.id, reasons }).returning();
  return { ...base, milestone: present(row!), hiddenUntil: null };
}

async function pendingMilestone(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), eq(milestones.userId, userId)));
  if (!row) throw notFound("Milestone");
  if (row.status !== "pending") throw conflict(`This suggestion was already ${row.status}`);
  return row;
}

/**
 * Accept: the rehab plan is marked done (its limits keep applying, see limitsPlan in rehab.ts); a
 * feed post only if asked for. The checks run again first, because a suggestion fetched earlier may
 * no longer hold (say a physio_limit flag since): then it's withdrawn and the answer is a 409.
 */
export async function acceptMilestone(
  db: Db,
  userId: string,
  id: string,
  sharePost: boolean,
  today: string,
  now = new Date(),
) {
  const row = await pendingMilestone(db, userId, id);
  const { plan: current, checks, eligible } = await evaluateMilestone(db, userId, today, now);
  if (!eligible || current?.id !== row.rehabPlanId) {
    await db.delete(milestones).where(eq(milestones.id, id));
    throw new HttpError(
      409,
      "milestone_no_longer_met",
      "This suggestion no longer applies: not every check holds right now.",
      { checks },
    );
  }
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .update(rehabPlans)
      .set({ status: "done", updatedAt: new Date() })
      .where(
        and(
          eq(rehabPlans.id, row.rehabPlanId),
          eq(rehabPlans.userId, userId),
          eq(rehabPlans.status, "active"),
        ),
      )
      .returning({ id: rehabPlans.id, status: rehabPlans.status });
    if (!plan) throw conflict("The rehab plan is no longer active");
    const [accepted] = await tx
      .update(milestones)
      .set({ status: "accepted", decidedAt: new Date() })
      .where(eq(milestones.id, id))
      .returning();
    const [post] = sharePost
      ? await tx
          .insert(posts)
          .values({ authorId: userId, kind: "goal", body: BACK_TO_GYM_POST })
          .returning({ id: posts.id, kind: posts.kind, body: posts.body, createdAt: posts.createdAt })
      : [];
    return {
      milestone: present(accepted!),
      rehabPlan: plan,
      post: post ?? null,
      next: "POST /plans/generate makes this week's gym plan.",
    };
  });
}

export async function dismissMilestone(db: Db, userId: string, id: string, now = new Date()) {
  await pendingMilestone(db, userId, id);
  const hiddenUntil = new Date(now.getTime() + MILESTONE_RULES.dismissDays * 86_400_000);
  const [row] = await db
    .update(milestones)
    .set({ status: "dismissed", decidedAt: now, hiddenUntil })
    .where(eq(milestones.id, id))
    .returning();
  return { milestone: present(row!), hiddenUntil };
}
