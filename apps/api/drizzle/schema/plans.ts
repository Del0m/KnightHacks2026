// DB-05: exercise library with form specs, weekly plans and plan items (§9.2 Planning).
import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { experienceLevel, users } from "./users.js";

export const exercises = pgTable("exercises", {
  id: text().primaryKey(), // matches specs/exercises/<id>.json
  name: text().notNull(),
  muscles: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  level: experienceLevel().notNull().default("beginner"),
  formSpec: jsonb(), // the JSON spec from AI-05, served by GET /exercises/:id/spec
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable(
  "plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekOf: date().notNull(),
    aiSources: jsonb().notNull().default([]), // doc_chunk ids and titles the planner used
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
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
    sources: jsonb().notNull().default([]), // "why this exercise": doc_chunk ids for this item
  },
  (t) => [index("plan_items_plan_idx").on(t.planId)],
);
