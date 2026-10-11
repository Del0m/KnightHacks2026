// BE-08: the RAG planner (AI-12, services/planner.ts) for the app, plus thumbs up/down on exercises.
//
//   POST /plans/generate?tz=                    this week's plan, made now; replaces the current one
//   GET  /plans/current?tz=                     this week's newest plan, 404 before there is one
//   GET  /me/exercise-preferences               the user's ratings
//   PUT  /me/exercise-preferences/:exerciseId   { rating: "like" | "dislike" | "neutral" }
//
// ?tz= is the user's IANA time zone (default UTC): it decides which Monday starts "this week" and
// which days have already passed.
import { desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { notFound, parse, send, userId } from "../http.js";
import { chunkIdOf, currentPlan, generatePlan, type PlannerDeps } from "../services/planner.js";
import { setRating } from "../services/preferences.js";
import { localToday } from "./rehab.js";

const { exercises, exercisePreferences, docChunks } = schema;

// Spec ids (squat) and free-exercise-db ids (Dumbbell_Lunges, 3_4_Sit-Up).
const exerciseId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "not an exercise id");

/**
 * Makes sure an exercise exists in the exercises table: a tracked one already does, a library one
 * is copied from its doc_chunks entry on first use (no form spec). 404 if it's neither.
 */
async function ensureExercise(db: Db, id: string): Promise<void> {
  const [known] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, id));
  if (known) return;
  const [chunk] = await db
    .select({ metadata: docChunks.metadata })
    .from(docChunks)
    .where(eq(docChunks.id, chunkIdOf(id)));
  const m = chunk?.metadata as Record<string, unknown> | undefined;
  if (m?.kind !== "exercise" || m.exercise_id !== id) throw notFound("Exercise");
  await db
    .insert(exercises)
    .values({
      id,
      name: String(m.name ?? id),
      muscles: (m.primary_muscles as string[] | undefined) ?? [],
      level: m.level === "expert" ? "advanced" : m.level === "intermediate" ? "intermediate" : "beginner",
    })
    .onConflictDoNothing();
}

export function plansRouter(db: Db, deps: PlannerDeps): Router {
  const router = Router();

  router.post("/plans/generate", async (req, res) => {
    const { timeZone, date } = localToday(req, deps.now?.());
    send(res, await generatePlan(db, deps, { userId: userId(req), timeZone, today: date }), 201);
  });

  router.get("/plans/current", async (req, res) => {
    const { date } = localToday(req, deps.now?.());
    const plan = await currentPlan(db, userId(req), date);
    if (!plan) throw notFound("Plan for this week");
    send(res, plan);
  });

  router.get("/me/exercise-preferences", async (req, res) => {
    const rows = await db
      .select({
        exerciseId: exercisePreferences.exerciseId,
        name: exercises.name,
        tracked: sql<boolean>`${exercises.formSpec} is not null`,
        rating: exercisePreferences.rating,
        updatedAt: exercisePreferences.updatedAt,
      })
      .from(exercisePreferences)
      .innerJoin(exercises, eq(exercises.id, exercisePreferences.exerciseId))
      .where(eq(exercisePreferences.userId, userId(req)))
      .orderBy(desc(exercisePreferences.updatedAt));
    send(res, rows);
  });

  router.put("/me/exercise-preferences/:exerciseId", async (req, res) => {
    const id = parse(exerciseId, req.params.exerciseId);
    const { rating } = parse(z.object({ rating: z.enum(["like", "dislike", "neutral"]) }).strict(), req.body);
    if (rating !== "neutral") await ensureExercise(db, id);
    send(res, await setRating(db, userId(req), id, rating));
  });

  return router;
}
