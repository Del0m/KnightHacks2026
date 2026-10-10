// DB-07: personal records, goals, medals and Databricks-synced risk insights (§9.2 Progress).
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { medalTier, sessions } from "./workouts.js";

export const goalStatus = pgEnum("goal_status", ["active", "achieved", "abandoned"]);
export const prMetric = pgEnum("pr_metric", ["max_weight_kg", "max_reps", "est_1rm_kg"]);

export const personalRecords = pgTable(
  "personal_records",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text().notNull(),
    metric: prMetric().notNull(),
    value: real().notNull(),
    previousValue: real(),
    sessionId: uuid().references(() => sessions.id, { onDelete: "set null" }),
    achievedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("personal_records_lookup_idx").on(t.userId, t.exerciseId, t.metric, t.value.desc())],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    description: text().notNull(),
    // Optional machine-readable target, e.g. metric "gold_workouts" with targetValue 3.
    metric: text(),
    targetValue: integer(),
    targetDate: date(),
    status: goalStatus().notNull().default("active"),
    isPublic: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goals_user_idx").on(t.userId)],
);

export const medals = pgTable(
  "medals",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid()
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tier: medalTier().notNull(),
    formScore: real().notNull(),
    baselineShare: real().notNull(),
    awardedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("medals_user_awarded_idx").on(t.userId, t.awardedAt.desc())],
);

// Written by the gold-table sync (CONN-06) from gold_injury_risk_scores. Not a diagnosis.
export const riskInsights = pgTable(
  "risk_insights",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bodyPart: text().notNull(), // knee, lower_back, shoulder, general (gold.py BODY_PART)
    score: real().notNull(),
    explanation: text(),
    topFeatures: jsonb().notNull().default([]),
    asOf: date().notNull(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("risk_insights_upsert_key").on(t.userId, t.bodyPart, t.asOf)],
);

// Written by the gold-table sync (CONN-06, src/jobs/syncInsights.ts) from gold_user_progress_daily.
// Shape is the one that job expects. /me/progress computes from sessions directly, so it works
// before Databricks is connected; this table carries the pipeline's view (e.g. its PR flags).
export const progressDaily = pgTable(
  "progress_daily",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date().notNull(),
    exerciseId: text().notNull(),
    sets: integer(),
    reps: integer(),
    cleanReps: integer(),
    cleanShare: real(),
    volumeKg: real(),
    avgRangeDeg: real(),
    avgQuality: real(),
    est1rmKg: real("est_1rm_kg"),
    isPr: boolean(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date, t.exerciseId] })],
);
