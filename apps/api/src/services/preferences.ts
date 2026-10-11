// AI-12: what the user likes and doesn't, from what they say and from what they do.
//
//   explicit   thumbs up/down per exercise (PUT /me/exercise-preferences/:exerciseId)
//   implicit   from the last six weeks (planHistory.ts): done often, completed rather than skipped
//              when it was in the plan, and done with clean form
//
// Each exercise gets a score in [-1, 1]. An explicit rating outweighs the habits (70/30), so a
// thumbs down always ends up negative. The scores are also folded into one taste vector in the
// exercise-chunk embedding space and stored in exercise_taste, so library exercises the user has
// never done can still be ranked by how close they are to what the user likes.
//
// Preferences only re-rank exercises that already passed the safety check (planner.ts).
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type { ExerciseHistory } from "./planHistory.js";

const { exercisePreferences, exerciseTaste, docChunks } = schema;

export type Rating = "like" | "dislike";

export interface Preference {
  exerciseId: string;
  rating: Rating | null;
  implicit: number | null; // null when there's no evidence either way
  score: number; // [-1, 1]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Habit score in [-1, 1], or null with no evidence. */
export function implicitScore(h: ExerciseHistory): number | null {
  const parts: [value: number, weight: number][] = [];
  // Done often: 4 recency-weighted sessions in six weeks counts as a clear habit.
  if (h.sessions > 0) parts.push([Math.min(1, h.weightedSessions / 4), 0.5]);
  // Completed vs skipped when it was planned.
  if (h.planned > 0) parts.push([(h.done / h.planned - 0.5) * 2, 0.3]);
  // Form success: clean reps are more fun than flagged ones.
  if (h.clean !== null) parts.push([(h.clean - 0.5) * 2, 0.2]);
  if (!parts.length) return null;
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  return clamp(parts.reduce((s, [v, w]) => s + v * w, 0) / weight, -1, 1);
}

export function combine(rating: Rating | null, implicit: number | null): number {
  if (!rating) return implicit ?? 0;
  const explicit = rating === "like" ? 1 : -1;
  return clamp(0.7 * explicit + 0.3 * (implicit ?? 0), -1, 1);
}

export async function loadRatings(db: Db, userId: string): Promise<Map<string, Rating>> {
  const rows = await db
    .select({ exerciseId: exercisePreferences.exerciseId, rating: exercisePreferences.rating })
    .from(exercisePreferences)
    .where(eq(exercisePreferences.userId, userId));
  return new Map(rows.map((r) => [r.exerciseId, r.rating]));
}

export function preferences(
  ratings: Map<string, Rating>,
  history: Map<string, ExerciseHistory>,
): Map<string, Preference> {
  const out = new Map<string, Preference>();
  for (const id of new Set([...ratings.keys(), ...history.keys()])) {
    const rating = ratings.get(id) ?? null;
    const h = history.get(id);
    const implicit = h ? implicitScore(h) : null;
    out.set(id, { exerciseId: id, rating, implicit, score: combine(rating, implicit) });
  }
  return out;
}

export function normalize(v: number[]): number[] | null {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 1e-9 ? v.map((x) => x / norm) : null;
}

/**
 * Rebuilds the user's taste vector from their preference scores and the exercises' chunk
 * embeddings, stores it, and returns it (null when nothing has an embedding yet).
 * `chunkIdOf` maps an exercise id to its doc_chunks id (tracked exercises use a library twin).
 */
export async function rebuildTaste(
  db: Db,
  userId: string,
  prefs: Map<string, Preference>,
  chunkIdOf: (exerciseId: string) => string,
): Promise<number[] | null> {
  const weighted = [...prefs.values()].filter((p) => Math.abs(p.score) >= 0.1);
  const byChunk = new Map(weighted.map((p) => [chunkIdOf(p.exerciseId), p.score]));
  const rows = byChunk.size
    ? await db
        .select({ id: docChunks.id, embedding: docChunks.embedding })
        .from(docChunks)
        .where(inArray(docChunks.id, [...byChunk.keys()]))
    : [];

  let taste: number[] | null = null;
  if (rows.length) {
    const sum = new Array<number>(rows[0]!.embedding.length).fill(0);
    for (const row of rows) {
      const w = byChunk.get(row.id)!;
      row.embedding.forEach((x, i) => (sum[i]! += w * x));
    }
    taste = normalize(sum);
  }

  if (!taste) {
    await db.delete(exerciseTaste).where(eq(exerciseTaste.userId, userId));
    return null;
  }
  await db
    .insert(exerciseTaste)
    .values({ userId, embedding: taste, exercises: rows.length })
    .onConflictDoUpdate({
      target: exerciseTaste.userId,
      set: { embedding: taste, exercises: rows.length, updatedAt: new Date() },
    });
  return taste;
}

export async function setRating(db: Db, userId: string, exerciseId: string, rating: Rating | "neutral") {
  if (rating === "neutral") {
    await db
      .delete(exercisePreferences)
      .where(and(eq(exercisePreferences.userId, userId), eq(exercisePreferences.exerciseId, exerciseId)));
    return { exerciseId, rating: "neutral" as const, updatedAt: null };
  }
  const [row] = await db
    .insert(exercisePreferences)
    .values({ userId, exerciseId, rating })
    .onConflictDoUpdate({
      target: [exercisePreferences.userId, exercisePreferences.exerciseId],
      set: { rating, updatedAt: new Date() },
    })
    .returning({
      exerciseId: exercisePreferences.exerciseId,
      rating: exercisePreferences.rating,
      updatedAt: exercisePreferences.updatedAt,
    });
  return row!;
}
