// BE-15: rehab plans from a physio and the effective limits the phone applies (Architecture §1.1).
//
// Safety line (§1.1): the API stores what the user enters and never changes a physio's limits on
// its own. Validation only rejects input the form engine couldn't apply; it never rewrites it.
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { HttpError, notFound } from "../http.js";

const { rehabPlans, rehabLimits, exercises, injuries, sessions, sets } = schema;

export const REHAB_DISCLAIMER =
  "Spotter tracks your physio's plan. Any pain is worth raising with your physio or a doctor.";

// GET /me/limits is read by the phone (AI-16, INT-07). Bump this when its shape changes.
export const LIMITS_VERSION = 1;

type PlanRow = typeof rehabPlans.$inferSelect;
type LimitRow = typeof rehabLimits.$inferSelect;

// ---- Spec checks ----

interface SpecShape {
  angles?: Record<string, { type?: string }>;
  injury_overrides?: Record<string, unknown>;
}

// A limit is "flexion from straight" (DB-12), which only means something for a joint angle; it's
// also the only kind AI-16 maps onto the spec. Segment tilts and width ratios are rejected.
export function limitableAngles(spec: SpecShape | null | undefined): string[] {
  return Object.entries(spec?.angles ?? {})
    .filter(([, a]) => a?.type === "joint_angle")
    .map(([name]) => name);
}

// Checks every limit against the stored specs with one query, whatever the number of limits.
// `pathPrefix` locates the offending limit in the request body, e.g. "limits.2".
export async function assertLimitsFitSpecs(
  db: Db,
  limits: readonly { exerciseId: string; angle: string }[],
  pathPrefix = (_i: number) => "",
): Promise<void> {
  if (!limits.length) return;
  const specs = await db
    .select({ id: exercises.id, spec: exercises.formSpec })
    .from(exercises)
    .where(isNotNull(exercises.formSpec))
    .orderBy(asc(exercises.id));
  const byId = new Map(specs.map((s) => [s.id, s.spec as SpecShape]));
  limits.forEach(({ exerciseId, angle }, i) => {
    const at = (field: string) => [pathPrefix(i), field].filter(Boolean).join(".");
    const spec = byId.get(exerciseId);
    if (!spec) {
      throw invalid(at("exercise_id"), `"${exerciseId}" isn't a known exercise`, [...byId.keys()]);
    }
    const angles = limitableAngles(spec);
    if (!angles.includes(angle)) {
      throw invalid(at("angle"), `"${angle}" isn't a joint angle measured in ${exerciseId}`, angles);
    }
  });
}

export function invalid(path: string, message: string, allowed?: string[]): HttpError {
  return new HttpError(400, "validation_failed", message, {
    issues: [{ path, message }],
    ...(allowed ? { allowed } : {}),
  });
}

// ---- Reads ----

// "Today" is always the user's local calendar date (YYYY-MM-DD), from the ?tz= the app sends
// (UTC if it doesn't), so review_due and started flip at the user's midnight, not the server's.
export function reviewDue(plan: Pick<PlanRow, "reviewOn">, today: string): boolean {
  return plan.reviewOn !== null && plan.reviewOn <= today;
}

export function started(plan: Pick<PlanRow, "startOn">, today: string): boolean {
  return plan.startOn <= today;
}

async function limitsFor(db: Db, planIds: string[]) {
  if (!planIds.length) return [];
  return db
    .select({
      id: rehabLimits.id,
      rehabPlanId: rehabLimits.rehabPlanId,
      exerciseId: rehabLimits.exerciseId,
      exerciseName: exercises.name,
      angle: rehabLimits.angle,
      side: rehabLimits.side,
      maxRangeDeg: rehabLimits.maxRangeDeg,
      sets: rehabLimits.sets,
      reps: rehabLimits.reps,
      tempoMinMs: rehabLimits.tempoMinMs,
      createdAt: rehabLimits.createdAt,
      updatedAt: rehabLimits.updatedAt,
    })
    .from(rehabLimits)
    .innerJoin(exercises, eq(exercises.id, rehabLimits.exerciseId))
    .where(inArray(rehabLimits.rehabPlanId, planIds))
    .orderBy(asc(rehabLimits.rehabPlanId), asc(rehabLimits.position), asc(rehabLimits.createdAt));
}

function present(plan: PlanRow, limits: Awaited<ReturnType<typeof limitsFor>>, today: string) {
  const { userId: _u, ...rest } = plan;
  return {
    ...rest,
    started: started(plan, today),
    reviewDue: reviewDue(plan, today),
    limits: limits.filter((l) => l.rehabPlanId === plan.id).map(({ rehabPlanId: _p, ...l }) => l),
  };
}

export async function listPlans(db: Db, userId: string, today: string) {
  const plans = await db
    .select()
    .from(rehabPlans)
    .where(eq(rehabPlans.userId, userId))
    .orderBy(desc(rehabPlans.startOn), desc(rehabPlans.createdAt));
  const limits = await limitsFor(
    db,
    plans.map((p) => p.id),
  );
  return plans.map((p) => present(p, limits, today));
}

export async function ownPlan(db: Db, userId: string, planId: string): Promise<PlanRow> {
  const [plan] = await db
    .select()
    .from(rehabPlans)
    .where(and(eq(rehabPlans.id, planId), eq(rehabPlans.userId, userId)));
  if (!plan) throw notFound("Rehab plan");
  return plan;
}

export async function getPlan(db: Db, userId: string, planId: string, today: string) {
  const plan = await ownPlan(db, userId, planId);
  return present(plan, await limitsFor(db, [plan.id]), today);
}

export async function activePlan(db: Db, userId: string): Promise<PlanRow | null> {
  const [plan] = await db
    .select()
    .from(rehabPlans)
    .where(and(eq(rehabPlans.userId, userId), eq(rehabPlans.status, "active")));
  return plan ?? null;
}

export async function ownLimit(db: Db, planId: string, limitId: string): Promise<LimitRow> {
  const [limit] = await db
    .select()
    .from(rehabLimits)
    .where(and(eq(rehabLimits.id, limitId), eq(rehabLimits.rehabPlanId, planId)));
  if (!limit) throw notFound("Limit");
  return limit;
}

export async function assertOwnInjury(db: Db, userId: string, injuryId: string): Promise<void> {
  const [row] = await db
    .select({ id: injuries.id })
    .from(injuries)
    .where(and(eq(injuries.id, injuryId), eq(injuries.userId, userId)));
  if (!row) throw notFound("Injury");
}

// ---- GET /me/limits ----

// The one read the phone needs to build each effective spec: base spec, then the injury
// overrides for these body parts, then the active plan's limits (INT-07 order).
// A plan's limits only apply from its start_on (in the user's time zone): before that the
// phone gets the plan with started: false and no limits, so it never caps range early.
export async function effectiveLimits(db: Db, userId: string, today: string, timeZone: string) {
  const [userInjuries, plan] = await Promise.all([
    db
      .selectDistinct({ bodyPart: injuries.bodyPart, side: injuries.side })
      .from(injuries)
      .where(eq(injuries.userId, userId))
      .orderBy(injuries.bodyPart, injuries.side),
    activePlan(db, userId),
  ]);
  const applies = plan !== null && started(plan, today);
  const limits = applies ? await limitsFor(db, [plan.id]) : [];

  const byExercise: Record<
    string,
    {
      angle: string;
      side: string;
      maxRangeDeg: number;
      sets: number;
      reps: number;
      tempoMinMs: number | null;
    }[]
  > = {};
  for (const l of limits) {
    (byExercise[l.exerciseId] ??= []).push({
      angle: l.angle,
      side: l.side,
      maxRangeDeg: l.maxRangeDeg,
      sets: l.sets,
      reps: l.reps,
      tempoMinMs: l.tempoMinMs,
    });
  }

  return {
    version: LIMITS_VERSION,
    disclaimer: REHAB_DISCLAIMER,
    date: today,
    timeZone,
    injuries: userInjuries,
    // Every injured body part, unfiltered: the phone applies spec.injury_overrides[part] where
    // the spec has one and skips the rest. Not filtered against the specs stored in Neon, so it
    // stays right on a branch where db:load-specs hasn't run (the phone bundles the specs).
    bodyParts: [...new Set(userInjuries.map((i) => i.bodyPart))],
    rehabPlan: plan
      ? {
          id: plan.id,
          status: plan.status,
          fromPhysio: plan.fromPhysio,
          startOn: plan.startOn,
          reviewOn: plan.reviewOn,
          started: applies,
          reviewDue: reviewDue(plan, today),
        }
      : null,
    // Keyed by exercise id, so the phone can look up a spec's limits directly. Kept as entered.
    // Empty until the plan has started.
    limits: byExercise,
  };
}

// ---- GET /me/rehab-plans/active/today ----

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDate(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function todaysSession(db: Db, userId: string, timeZone: string, now = new Date()) {
  const plan = await activePlan(db, userId);
  if (!plan) throw notFound("Active rehab plan");
  const date = localDate(now, timeZone);
  const limits = await limitsFor(db, [plan.id]);

  const exerciseIds = [...new Set(limits.map((l) => l.exerciseId))];
  // Any set of a prescribed exercise counts, wherever it was done: a squat set in a gym session is
  // still squats done today, and sets aren't tagged as rehab. A set belongs to the local day it
  // reached the API (the phone sends each set as it ends), so a session that runs past midnight
  // splits across the two days. An offline-queued set counts on the day it syncs.
  const done = exerciseIds.length
    ? await db
        .select({ exerciseId: sets.exerciseId, n: sql<number>`count(*)::int` })
        .from(sets)
        .innerJoin(sessions, eq(sessions.id, sets.sessionId))
        .where(
          and(
            eq(sessions.userId, userId),
            inArray(sets.exerciseId, exerciseIds),
            sql`(${sets.createdAt} at time zone ${timeZone})::date = ${date}::date`,
          ),
        )
        .groupBy(sets.exerciseId)
    : [];
  const doneBy = new Map(done.map((d) => [d.exerciseId, d.n]));

  const exercisesToday = exerciseIds.map((exerciseId) => {
    const forExercise = limits.filter((l) => l.exerciseId === exerciseId);
    const tempos = forExercise.map((l) => l.tempoMinMs).filter((t): t is number => t !== null);
    return {
      exerciseId,
      name: forExercise[0]!.exerciseName,
      // One prescription per exercise. If per-side entries disagree, show the smaller dose and
      // the slower tempo rather than picking one; each entry is still listed under limits.
      sets: Math.min(...forExercise.map((l) => l.sets)),
      reps: Math.min(...forExercise.map((l) => l.reps)),
      tempoMinMs: tempos.length ? Math.max(...tempos) : null,
      setsDoneToday: doneBy.get(exerciseId) ?? 0,
      limits: forExercise.map((l) => ({
        id: l.id,
        angle: l.angle,
        side: l.side,
        maxRangeDeg: l.maxRangeDeg,
        sets: l.sets,
        reps: l.reps,
        tempoMinMs: l.tempoMinMs,
      })),
    };
  });

  return {
    disclaimer: REHAB_DISCLAIMER,
    date,
    timeZone,
    plan: {
      id: plan.id,
      fromPhysio: plan.fromPhysio,
      startOn: plan.startOn,
      reviewOn: plan.reviewOn,
      reviewDue: reviewDue(plan, date),
      started: started(plan, date),
      notes: plan.notes,
    },
    exercises: exercisesToday,
  };
}
