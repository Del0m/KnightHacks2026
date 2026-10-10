// DB-04: sessions, sets, reps and form flags. Aggregates only: per-frame joints go straight to
// the Databricks Volume (CONN-02) and are never stored in Neon (§9.1).
import {
  jsonb,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const medalTier = pgEnum("medal_tier", ["bronze", "silver", "gold"]);
// Matches FinishedSession.inference_mode in src/integrations/databricks/upload.ts.
export const inferenceMode = pgEnum("inference_mode", ["on_device", "cloud"]);
// Matches ExportStatus in src/integrations/databricks/upload.ts.
export const exportStatus = pgEnum("export_status", ["pending", "uploading", "exported", "failed"]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    device: text(),
    inferenceMode: inferenceMode().notNull().default("on_device"),
    medal: medalTier(),
    formScore: real(), // clean reps / total reps, set on finish
    exportStatus: exportStatus().notNull().default("pending"),
    exportError: text(),
    exportAttempts: integer().notNull().default(0),
    exportStartedAt: timestamp({ withTimezone: true }),
    exportedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("sessions_user_started_idx").on(t.userId, t.startedAt.desc())],
);

export const sets = pgTable(
  "sets",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    position: integer().notNull(), // set_index within the session
    // Not a foreign key: the phone can record an exercise before its spec is loaded (BE-06).
    exerciseId: text().notNull(),
    reps: integer().notNull(),
    weightKg: real(),
    medal: medalTier(),
    cleanShare: real(),
    scoreSource: text(), // "databricks" | "phone" (CONN-05)
    // INT-05: the rest-time result, saved so GET /sets/:id/rest-note returns the same thing later.
    score: jsonb(), // SetScore from scoreSet() (integrations/databricks/score.ts)
    restNote: jsonb(), // { text, source: "llm" | "fixed", rule_id } (services/restNote.ts)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sets_session_position_uq").on(t.sessionId, t.position),
    index("sets_exercise_idx").on(t.exerciseId),
  ],
);

export const reps = pgTable(
  "reps",
  {
    id: uuid().primaryKey().defaultRandom(),
    setId: uuid()
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    startMs: integer(),
    endMs: integer(),
    tempoMs: integer().notNull(),
    rangeDeg: real().notNull(),
    quality: real(),
    clean: boolean().notNull(),
  },
  (t) => [unique("reps_set_position_uq").on(t.setId, t.position)],
);

export const formFlags = pgTable(
  "form_flags",
  {
    id: uuid().primaryKey().defaultRandom(),
    repId: uuid()
      .notNull()
      .references(() => reps.id, { onDelete: "cascade" }),
    ruleId: text().notNull(),
    severity: text().notNull().default("info"),
  },
  (t) => [index("form_flags_rep_idx").on(t.repId)],
);
