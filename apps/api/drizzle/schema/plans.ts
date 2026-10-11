// DB-05: exercise library with form specs, weekly plans and plan items (§9.2 Planning).
// AI-12 / BE-08 add how a plan was made (source, notes, history), per-item reasons, and the
// user's exercise preferences: explicit thumbs up/down plus a taste vector built from them and
// from what the user actually trains (services/preferences.ts).
import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS, experienceLevel, users } from "./users.js";

export const exercises = pgTable("exercises", {
  // specs/exercises/<id>.json for camera-tracked exercises; a free-exercise-db id (e.g.
  // "Dumbbell_Lunges") for library exercises the planner adds on demand, which have no form_spec.
  id: text().primaryKey(),
  name: text().notNull(),
  muscles: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  level: experienceLevel().notNull().default("beginner"),
  formSpec: jsonb(), // the JSON spec from AI-05, served by GET /exercises/:id/spec; null = not camera-tracked
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// "llm": drafted by gpt-oss and then checked in code; "rules": the deterministic planner, used
// without HF_TOKEN or when the LLM fails. Both go through the same safety check.
export const planSource = pgEnum("plan_source", ["llm", "rules"]);

export const plans = pgTable(
  "plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekOf: date().notNull(), // Monday of the plan's week, in the user's time zone
    aiSources: jsonb().notNull().default([]), // doc_chunk ids and titles the planner used
    source: planSource().notNull().default("rules"),
    notes: jsonb().$type<string[]>().notNull().default([]), // plan-wide notes: physio, volume cap
    history: jsonb().notNull().default({}), // the six-week summary the plan was built from
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // The newest plan for a week is the current one; older ones stay as history.
  (t) => [index("plans_user_week_idx").on(t.userId, t.weekOf.desc(), t.createdAt.desc())],
);

export const planItems = pgTable(
  "plan_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    exerciseId: text()
      .notNull()
      .references(() => exercises.id),
    day: integer().notNull(), // 0 = Monday
    position: integer().notNull(),
    sets: integer().notNull(),
    reps: integer().notNull(),
    swapNote: text(), // e.g. "Glute bridge instead of lunge for your knee"
    reason: text(), // one line on why this exercise and this volume
    safetyNote: text(), // the spec's injury note when the exercise is adapted for an injury
    sources: jsonb().notNull().default([]), // "why this exercise": doc_chunk ids for this item
  },
  (t) => [index("plan_items_plan_idx").on(t.planId)],
);

export const exerciseRating = pgEnum("exercise_rating", ["like", "dislike"]);

// Explicit thumbs up/down, one per exercise. "Neutral" is the absence of a row.
export const exercisePreferences = pgTable(
  "exercise_preferences",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text()
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    rating: exerciseRating().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

// The user's taste in exercises as one vector in the same space as the exercise chunks
// (bge-small): a weighted sum of the exercises they like, do often and complete, minus the ones
// they dislike or skip. Rebuilt on every plan request and used to rank library exercises.
export const exerciseTaste = pgTable("exercise_taste", {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  exercises: integer().notNull(), // how many exercises contributed
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
