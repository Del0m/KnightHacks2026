// BE-03: the signed-in user's profile and injuries.
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { conflict, isoDate, isUniqueViolation, notFound, parse, send, userId } from "../http.js";
import { deleteAccount } from "../services/accountDeletion.js";

const { users, profiles, injuries } = schema;
const onboardingGoals = new Set([
  "muscle",
  "weight",
  "strength",
  "endurance",
  "mobility",
  "consistency",
  "chest",
  "back",
  "shoulders",
  "arms",
  "core",
  "legs",
]);

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= "2020-01-01" &&
      value <= "2100-12-31"
    );
  }, "use a valid calendar date in 2020–2100");
const trainingSchedule = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("weekly"),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length),
    })
    .strict(),
  z
    .object({
      kind: z.literal("interval"),
      every_days: z.number().int().min(1).max(14),
      start_date: calendarDate,
    })
    .strict(),
]);
const personalBest = z
  .object({
    exercise: z.enum(["squat", "bench", "deadlift"]),
    weight: z.number().positive().max(2000),
    unit: z.enum(["lb", "kg"]),
    reps: z.number().int().min(1).max(100),
  })
  .strict();
const scheduleSlot = z.string().regex(/^(mon|tue|wed|thu|fri|sat|sun)_(am|pm|eve)$/, "use slots like mon_am");

export const profileUpdate = z
  .object({
    handle: z
      .string()
      .regex(/^[a-z0-9_]{3,24}$/, "3-24 lowercase letters, digits or underscores")
      .optional(),
    display_name: z.string().trim().max(60).nullable().optional(),
    experience_level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    gym_place_id: z.string().max(200).nullable().optional(),
    gym_name: z.string().max(120).nullable().optional(),
    gym_lat: z.number().min(-90).max(90).nullable().optional(),
    gym_lng: z.number().min(-180).max(180).nullable().optional(),
    schedule: z.array(scheduleSlot).max(21).optional(),
    goals: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    personal_bests: z
      .array(personalBest)
      .max(3)
      .refine((bests) => new Set(bests.map((best) => best.exercise)).size === bests.length)
      .optional(),
    training_schedule: trainingSchedule.optional(),
    onboarding_completed: z.boolean().optional(),
    injury_note: z.string().trim().max(500).optional(),
    bio: z.string().max(280).nullable().optional(),
    auto_post_medals: z.boolean().optional(),
    auto_post_prs: z.boolean().optional(),
    share_injuries_for_matching: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.onboarding_completed &&
      (!input.training_schedule ||
        !input.experience_level ||
        !input.personal_bests ||
        !input.goals ||
        input.goals.length !== 3 ||
        new Set(input.goals).size !== 3 ||
        input.goals.some((goal) => !onboardingGoals.has(goal)))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completion requires goals, experience, personal bests and training schedule",
        path: ["onboarding_completed"],
      });
    }
  });

export const injuryInput = z
  .object({
    body_part: z.enum(["knee", "shoulder", "lower_back", "hip", "ankle", "wrist", "elbow", "neck", "other"]),
    severity: z.enum(["mild", "moderate", "severe"]).default("mild"),
    since: isoDate.nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    is_private: z.boolean().default(true),
  })
  .strict();

export async function getProfile(db: Db, id: string) {
  const [row] = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: profiles.displayName,
      experienceLevel: profiles.experienceLevel,
      gymPlaceId: profiles.gymPlaceId,
      gymName: profiles.gymName,
      gymLat: profiles.gymLat,
      gymLng: profiles.gymLng,
      schedule: profiles.schedule,
      goals: profiles.goals,
      personalBests: profiles.personalBests,
      trainingSchedule: profiles.trainingSchedule,
      onboardingCompleted: profiles.onboardingCompleted,
      injuryNote: injuries.notes,
      bio: profiles.bio,
      autoPostMedals: profiles.autoPostMedals,
      autoPostPrs: profiles.autoPostPrs,
      shareInjuriesForMatching: profiles.shareInjuriesForMatching,
      createdAt: users.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(injuries, and(eq(injuries.id, profiles.onboardingInjuryId), eq(injuries.userId, users.id)))
    .where(eq(users.id, id));
  if (!row) throw notFound("Profile");
  return row;
}

export interface MeRouterOptions {
  pseudonymSecret?: string;
  onAccountDeleted?: (userId: string) => void;
}

export function meRouter(db: Db, options: MeRouterOptions = {}): Router {
  const router = Router();

  // CONN-13: delete the account and everything in it; Databricks follows via deletion_requests.
  // Idempotent: deleting an already-deleted account is also 204.
  router.delete("/me", async (req, res) => {
    const id = userId(req);
    await deleteAccount(db, id, options.pseudonymSecret);
    options.onAccountDeleted?.(id);
    res.status(204).end();
  });

  router.get("/me/profile", async (req, res) => {
    send(res, await getProfile(db, userId(req)));
  });

  router.put("/me/profile", async (req, res) => {
    const id = userId(req);
    const { handle, ...rest } = parse(profileUpdate, req.body);
    const changes = {
      displayName: rest.display_name,
      experienceLevel: rest.experience_level,
      gymPlaceId: rest.gym_place_id,
      gymName: rest.gym_name,
      gymLat: rest.gym_lat,
      gymLng: rest.gym_lng,
      schedule: rest.schedule,
      goals: rest.goals,
      personalBests: rest.personal_bests,
      trainingSchedule: rest.training_schedule,
      onboardingCompleted: rest.onboarding_completed,
      bio: rest.bio,
      autoPostMedals: rest.auto_post_medals,
      autoPostPrs: rest.auto_post_prs,
      shareInjuriesForMatching: rest.share_injuries_for_matching,
    };
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));

    try {
      await db.transaction(async (tx) => {
        // Serialize settings edits for this account, including the managed injury note.
        const [current] = await tx.select().from(profiles).where(eq(profiles.userId, id)).for("update");
        if (!current) throw notFound("Profile");
        // Partial edits must preserve a profile the onboarding client can reload.
        if (rest.onboarding_completed ?? current.onboardingCompleted) {
          parse(profileUpdate, {
            goals: rest.goals ?? current.goals,
            experience_level: rest.experience_level ?? current.experienceLevel,
            personal_bests: rest.personal_bests ?? current.personalBests,
            training_schedule: rest.training_schedule ?? current.trainingSchedule,
            onboarding_completed: true,
          });
        }
        let onboardingInjuryId = current.onboardingInjuryId;
        if (rest.injury_note !== undefined) {
          if (onboardingInjuryId)
            await tx
              .delete(injuries)
              .where(and(eq(injuries.id, onboardingInjuryId), eq(injuries.userId, id)));
          onboardingInjuryId = null;
          if (rest.injury_note) {
            const [injury] = await tx
              .insert(injuries)
              .values({ userId: id, bodyPart: "other", notes: rest.injury_note, isPrivate: true })
              .returning({ id: injuries.id });
            onboardingInjuryId = injury.id;
          }
        }
        if (handle) await tx.update(users).set({ handle }).where(eq(users.id, id));
        await tx
          .update(profiles)
          .set({ ...defined, onboardingInjuryId, updatedAt: new Date() })
          .where(eq(profiles.userId, id));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("That handle is taken");
      throw err;
    }
    send(res, await getProfile(db, id));
  });

  router.get("/me/injuries", async (req, res) => {
    const rows = await db
      .select()
      .from(injuries)
      .where(eq(injuries.userId, userId(req)))
      .orderBy(desc(injuries.createdAt));
    send(res, rows);
  });

  router.post("/me/injuries", async (req, res) => {
    const input = parse(injuryInput, req.body);
    const [row] = await db
      .insert(injuries)
      .values({
        userId: userId(req),
        bodyPart: input.body_part,
        severity: input.severity,
        since: input.since ?? null,
        notes: input.notes ?? null,
        isPrivate: input.is_private,
      })
      .returning();
    send(res, row, 201);
  });

  router.delete("/me/injuries/:id", async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const deleted = await db
      .delete(injuries)
      .where(and(eq(injuries.id, id), eq(injuries.userId, userId(req))))
      .returning({ id: injuries.id });
    if (!deleted.length) throw notFound("Injury");
    res.status(204).end();
  });

  return router;
}
