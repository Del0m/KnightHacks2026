// BE-15: rehab plans the user enters from their physio, their limits, the effective limits the
// phone applies, and today's guided session. Everything here is the signed-in user's own data;
// there is no public read path (§13). Every response that carries plan data includes
// REHAB_DISCLAIMER (§1.1).
import { and, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { badRequest, conflict, HttpError, isoDate, isUniqueViolation, parse, send, userId } from "../http.js";
import {
  assertLimitFitsSpec,
  assertOwnInjury,
  effectiveLimits,
  getPlan,
  isTimeZone,
  listPlans,
  ownLimit,
  ownPlan,
  REHAB_DISCLAIMER,
  todaysSession,
} from "../services/rehab.js";

const { rehabPlans, rehabLimits } = schema;

export const limitInput = z
  .object({
    exercise_id: z.string().regex(/^[a-z0-9_]{2,60}$/, "an exercise id such as squat"),
    angle: z.string().regex(/^[a-z0-9_]{1,40}$/, "a spec angle name such as knee"),
    side: z.enum(["left", "right", "both"]).default("both"),
    max_range_deg: z.number().min(0).max(180),
    sets: z.number().int().positive().max(20),
    reps: z.number().int().positive().max(100),
    tempo_min_ms: z.number().int().positive().max(20_000).nullable().optional(),
  })
  .strict();

export const limitUpdate = limitInput
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "nothing to update");

const planFields = {
  injury_id: z.string().uuid().nullable().optional(),
  from_physio: z.string().trim().max(120).nullable().optional(),
  start_on: isoDate,
  review_on: isoDate.nullable().optional(),
  status: z.enum(["active", "paused", "done"]).default("active"),
  notes: z.string().max(1000).nullable().optional(),
};

const reviewAfterStart = (v: { start_on?: string; review_on?: string | null }) =>
  !v.start_on || !v.review_on || v.review_on >= v.start_on;

export const planInput = z
  .object({ ...planFields, limits: z.array(limitInput).max(30).optional() })
  .strict()
  .refine(reviewAfterStart, { message: "review_on can't be before start_on", path: ["review_on"] });

export const planUpdate = z
  .object({
    ...planFields,
    start_on: isoDate.optional(),
    status: planFields.status.removeDefault().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "nothing to update")
  .refine(reviewAfterStart, { message: "review_on can't be before start_on", path: ["review_on"] });

const ONE_ACTIVE = "You already have an active rehab plan. Pause or finish it before starting another.";

const limitRow = (l: z.infer<typeof limitInput>) => ({
  exerciseId: l.exercise_id,
  angle: l.angle,
  side: l.side,
  maxRangeDeg: l.max_range_deg,
  sets: l.sets,
  reps: l.reps,
  tempoMinMs: l.tempo_min_ms ?? null,
});

const duplicateLimit = (l: { exercise_id?: string; exerciseId?: string; angle: string; side: string }) =>
  conflict(`This plan already has a ${l.angle} limit for ${l.exercise_id ?? l.exerciseId} (${l.side})`);

export function rehabRouter(db: Db): Router {
  const router = Router();

  // Registered before /me/rehab-plans/:id so "active" isn't read as a plan id.
  router.get("/me/rehab-plans/active/today", async (req, res) => {
    const { tz } = parse(z.object({ tz: z.string().max(64).default("UTC") }), req.query);
    if (!isTimeZone(tz))
      throw badRequest(`Unknown time zone "${tz}"; use an IANA name such as America/New_York`);
    send(res, await todaysSession(db, userId(req), tz));
  });

  router.get("/me/limits", async (req, res) => {
    send(res, await effectiveLimits(db, userId(req)));
  });

  router.get("/me/rehab-plans", async (req, res) => {
    send(res, { disclaimer: REHAB_DISCLAIMER, plans: await listPlans(db, userId(req)) });
  });

  router.post("/me/rehab-plans", async (req, res) => {
    const me = userId(req);
    const input = parse(planInput, req.body);
    if (input.injury_id) await assertOwnInjury(db, me, input.injury_id);
    for (const l of input.limits ?? []) await assertLimitFitsSpec(db, l.exercise_id, l.angle);

    let planId: string;
    try {
      planId = await db.transaction(async (tx) => {
        const [plan] = await tx
          .insert(rehabPlans)
          .values({
            userId: me,
            injuryId: input.injury_id ?? null,
            fromPhysio: input.from_physio ?? null,
            startOn: input.start_on,
            reviewOn: input.review_on ?? null,
            status: input.status,
            notes: input.notes ?? null,
          })
          .returning({ id: rehabPlans.id });
        if (input.limits?.length) {
          await tx
            .insert(rehabLimits)
            .values(input.limits.map((l, position) => ({ ...limitRow(l), position, rehabPlanId: plan!.id })));
        }
        return plan!.id;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Either a second active plan, or the same exercise/angle/side twice in limits.
      const limits = input.limits ?? [];
      const dupe = limits.find((l, i) =>
        limits.some(
          (o, j) => j < i && o.exercise_id === l.exercise_id && o.angle === l.angle && o.side === l.side,
        ),
      );
      throw dupe ? duplicateLimit(dupe) : conflict(ONE_ACTIVE);
    }
    send(res, { disclaimer: REHAB_DISCLAIMER, plan: await getPlan(db, me, planId) }, 201);
  });

  router.get("/me/rehab-plans/:id", async (req, res) => {
    const planId = parse(z.string().uuid(), req.params.id);
    send(res, { disclaimer: REHAB_DISCLAIMER, plan: await getPlan(db, userId(req), planId) });
  });

  router.put("/me/rehab-plans/:id", async (req, res) => {
    const me = userId(req);
    const planId = parse(z.string().uuid(), req.params.id);
    const input = parse(planUpdate, req.body);
    const current = await ownPlan(db, me, planId);
    if (input.injury_id) await assertOwnInjury(db, me, input.injury_id);

    const startOn = input.start_on ?? current.startOn;
    const reviewOn = input.review_on === undefined ? current.reviewOn : input.review_on;
    if (reviewOn && reviewOn < startOn) {
      throw new HttpError(400, "validation_failed", "review_on can't be before start_on", {
        issues: [{ path: "review_on", message: "review_on can't be before start_on" }],
      });
    }
    try {
      await db
        .update(rehabPlans)
        .set({
          ...(input.injury_id !== undefined ? { injuryId: input.injury_id } : {}),
          ...(input.from_physio !== undefined ? { fromPhysio: input.from_physio } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          startOn,
          reviewOn,
          updatedAt: new Date(),
        })
        .where(and(eq(rehabPlans.id, planId), eq(rehabPlans.userId, me)));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ONE_ACTIVE);
      throw err;
    }
    send(res, { disclaimer: REHAB_DISCLAIMER, plan: await getPlan(db, me, planId) });
  });

  router.delete("/me/rehab-plans/:id", async (req, res) => {
    const planId = parse(z.string().uuid(), req.params.id);
    await ownPlan(db, userId(req), planId);
    await db.delete(rehabPlans).where(eq(rehabPlans.id, planId)); // limits cascade
    res.status(204).end();
  });

  router.post("/me/rehab-plans/:id/limits", async (req, res) => {
    const planId = parse(z.string().uuid(), req.params.id);
    const input = parse(limitInput, req.body);
    await ownPlan(db, userId(req), planId);
    await assertLimitFitsSpec(db, input.exercise_id, input.angle);
    try {
      const [limit] = await db
        .insert(rehabLimits)
        .values({
          ...limitRow(input),
          rehabPlanId: planId,
          // Added limits go after the existing ones.
          position: sql`(select coalesce(max(${rehabLimits.position}) + 1, 0) from ${rehabLimits} where ${rehabLimits.rehabPlanId} = ${planId})`,
        })
        .returning();
      send(res, { disclaimer: REHAB_DISCLAIMER, limit }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateLimit(input);
      throw err;
    }
  });

  router.put("/me/rehab-plans/:id/limits/:limitId", async (req, res) => {
    const planId = parse(z.string().uuid(), req.params.id);
    const limitId = parse(z.string().uuid(), req.params.limitId);
    const input = parse(limitUpdate, req.body);
    await ownPlan(db, userId(req), planId);
    const current = await ownLimit(db, planId, limitId);

    const merged = {
      exerciseId: input.exercise_id ?? current.exerciseId,
      angle: input.angle ?? current.angle,
      side: input.side ?? current.side,
    };
    if (input.exercise_id !== undefined || input.angle !== undefined) {
      await assertLimitFitsSpec(db, merged.exerciseId, merged.angle);
    }
    try {
      const [limit] = await db
        .update(rehabLimits)
        .set({
          ...merged,
          ...(input.max_range_deg !== undefined ? { maxRangeDeg: input.max_range_deg } : {}),
          ...(input.sets !== undefined ? { sets: input.sets } : {}),
          ...(input.reps !== undefined ? { reps: input.reps } : {}),
          ...(input.tempo_min_ms !== undefined ? { tempoMinMs: input.tempo_min_ms } : {}),
          updatedAt: new Date(),
        })
        .where(eq(rehabLimits.id, limitId))
        .returning();
      send(res, { disclaimer: REHAB_DISCLAIMER, limit });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateLimit(merged);
      throw err;
    }
  });

  router.delete("/me/rehab-plans/:id/limits/:limitId", async (req, res) => {
    const planId = parse(z.string().uuid(), req.params.id);
    const limitId = parse(z.string().uuid(), req.params.limitId);
    await ownPlan(db, userId(req), planId);
    await ownLimit(db, planId, limitId);
    await db.delete(rehabLimits).where(eq(rehabLimits.id, limitId));
    res.status(204).end();
  });

  return router;
}
