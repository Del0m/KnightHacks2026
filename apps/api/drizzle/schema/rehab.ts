// DB-12: the plan a physio gave the user, its per-exercise limits, and the synced range-of-motion
// trend (Architecture §1.1, §9.2 Planning). Rehab data is private (§13): it's only ever read back
// through the owner's own /me routes, and every table goes when the user is deleted.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { exercises } from "./plans.js";
import { injuries, users } from "./users.js";

export const rehabPlanStatus = pgEnum("rehab_plan_status", ["active", "paused", "done"]);
export const limbSide = pgEnum("limb_side", ["left", "right", "both"]);

export const rehabPlans = pgTable(
  "rehab_plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Optional: a plan can exist without an injury entry, and outlives one that's deleted.
    injuryId: uuid().references(() => injuries.id, { onDelete: "set null" }),
    fromPhysio: text(), // free text the user enters, e.g. the clinic or physio name
    startOn: date().notNull(),
    reviewOn: date(),
    status: rehabPlanStatus().notNull().default("active"),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rehab_plans_user_idx").on(t.userId, t.startOn.desc()),
    // At most one active plan, so GET /me/limits never has to choose between two physios' limits.
    uniqueIndex("rehab_plans_one_active_uq")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
    check("rehab_plans_review_after_start", sql`${t.reviewOn} is null or ${t.reviewOn} >= ${t.startOn}`),
  ],
);

export const rehabLimits = pgTable(
  "rehab_limits",
  {
    id: uuid().primaryKey().defaultRandom(),
    rehabPlanId: uuid()
      .notNull()
      .references(() => rehabPlans.id, { onDelete: "cascade" }),
    exerciseId: text()
      .notNull()
      .references(() => exercises.id),
    // A spec angle name (`knee`, `elbow`), not a COCO joint: it's what the form engine measures.
    angle: text().notNull(),
    side: limbSide().notNull().default("both"),
    // Order the user entered them in, which is the order of today's session.
    position: integer().notNull().default(0),
    // Flexion from straight (180° minus the joint angle), the way physios state range.
    maxRangeDeg: real().notNull(),
    sets: integer().notNull(),
    reps: integer().notNull(),
    tempoMinMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rehab_limits_plan_idx").on(t.rehabPlanId, t.position),
    unique("rehab_limits_plan_exercise_angle_side_uq").on(t.rehabPlanId, t.exerciseId, t.angle, t.side),
    check("rehab_limits_range", sql`${t.maxRangeDeg} >= 0 and ${t.maxRangeDeg} <= 180`),
    check("rehab_limits_volume", sql`${t.sets} > 0 and ${t.reps} > 0`),
    check("rehab_limits_tempo", sql`${t.tempoMinMs} is null or ${t.tempoMinMs} > 0`),
  ],
);

// Neon copy of gold_rom_trend, written by the insight sync (CONN-14, src/jobs/syncInsights.ts,
// migration 0004) and read by BE-16. Defined by CONN-14 with the columns and upsert key DB-12
// specifies; the pipeline's expectations keep ranges within 0-180.
export const romTrend = pgTable(
  "rom_trend",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    angle: text().notNull(), // spec angle name: knee, elbow, hip
    side: text().notNull(), // left | right
    week: date().notNull(), // Monday of the week
    peakRangeDeg: real().notNull(), // 90th percentile of rep range that week
    baselineRangeDeg: real(), // first two weeks after the rehab plan's start (or of data)
    healthySideRangeDeg: real(), // the other side's peak, on the injured side's rows
    changeDeg: real(), // peak - baseline
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.angle, t.side, t.week] })],
);
