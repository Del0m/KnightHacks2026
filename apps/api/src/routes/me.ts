// BE-03: the signed-in user's profile and injuries.
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { conflict, isUniqueViolation, notFound, parse, send, userId } from "../http.js";
import { deleteAccount } from "../services/accountDeletion.js";

const { users, profiles, injuries } = schema;

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
    bio: z.string().max(280).nullable().optional(),
    auto_post_medals: z.boolean().optional(),
    auto_post_prs: z.boolean().optional(),
    share_injuries_for_matching: z.boolean().optional(),
  })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

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
      bio: profiles.bio,
      autoPostMedals: profiles.autoPostMedals,
      autoPostPrs: profiles.autoPostPrs,
      shareInjuriesForMatching: profiles.shareInjuriesForMatching,
      createdAt: users.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
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
      bio: rest.bio,
      autoPostMedals: rest.auto_post_medals,
      autoPostPrs: rest.auto_post_prs,
      shareInjuriesForMatching: rest.share_injuries_for_matching,
    };
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));

    try {
      await db.transaction(async (tx) => {
        if (handle) await tx.update(users).set({ handle }).where(eq(users.id, id));
        await tx
          .update(profiles)
          .set({ ...defined, updatedAt: new Date() })
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
