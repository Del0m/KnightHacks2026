// DB-03: users, profiles and injuries (Architecture §9.2). DB-09 adds profiles.embedding.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const experienceLevel = pgEnum("experience_level", ["beginner", "intermediate", "advanced"]);
export const bodyPart = pgEnum("body_part", [
  "knee",
  "shoulder",
  "lower_back",
  "hip",
  "ankle",
  "wrist",
  "elbow",
  "neck",
  "other",
]);
export const injurySeverity = pgEnum("injury_severity", ["mild", "moderate", "severe"]);

export const EMBEDDING_DIMENSIONS = 384; // BAAI/bge-small-en-v1.5

export const users = pgTable("users", {
  // Neon Auth user id (the JWT `sub`), not generated here.
  id: text().primaryKey(),
  handle: text().notNull().unique(),
  // HMAC of id sent to Databricks (CONN-02). Stored so the insight sync (CONN-06) and the
  // delete job (§13) can map Databricks rows back to a user without recomputing it.
  pseudonym: text().unique(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    userId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text(),
    experienceLevel: experienceLevel().notNull().default("beginner"),
    // Coarse location only (§12): the gym, never live location.
    gymPlaceId: text(),
    gymName: text(),
    gymLat: doublePrecision(),
    gymLng: doublePrecision(),
    // Weekly slots like "mon_am" or "wed_pm", used for schedule overlap in buddy matching.
    schedule: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Short goal tags like "strength", "mobility", "consistency".
    goals: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // FE-03 answers retain their original cadence and self-reported bests.
    personalBests: jsonb()
      .$type<{ exercise: string; weight: number; unit: "lb" | "kg"; reps: number }[]>()
      .notNull()
      .default([]),
    trainingSchedule: jsonb().$type<
      { kind: "weekly"; days: number[] } | { kind: "interval"; every_days: number; start_date: string }
    >(),
    onboardingCompleted: boolean().notNull().default(false),
    onboardingInjuryId: uuid(),
    bio: text(),
    autoPostMedals: boolean().notNull().default(false),
    autoPostPrs: boolean().notNull().default(false),
    // §13: injuries are only used for buddy matching when the user opts in.
    shareInjuriesForMatching: boolean().notNull().default(false),
    // DB-09: profile embedding for buddy matching (written by CONN-08).
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("profiles_gym_idx").on(t.gymPlaceId),
    index("profiles_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const injuries = pgTable(
  "injuries",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bodyPart: bodyPart().notNull(),
    severity: injurySeverity().notNull().default("mild"),
    since: date(),
    notes: text(),
    isPrivate: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("injuries_user_idx").on(t.userId)],
);
