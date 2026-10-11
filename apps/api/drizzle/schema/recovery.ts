// BE-16 / BE-17: physio report share links and back-to-gym milestones (Architecture §1.1).
// Both are private to their owner and go when the user is deleted.
import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { rehabPlans } from "./rehab.js";
import { users } from "./users.js";

// A link the user chose to share with their physio (§1.1: sharing is always a user action).
// Only a SHA-256 of the token is stored, so a database read can't produce a working link.
export const reportShares = pgTable(
  "report_shares",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    // The plan the user shared. The link keeps showing that plan, even after they finish it and
    // start another; deleting the plan deletes its links.
    rehabPlanId: uuid()
      .notNull()
      .references(() => rehabPlans.id, { onDelete: "cascade" }),
    fromDate: date().notNull(),
    toDate: date().notNull(),
    timeZone: text().notNull(), // the report's days are the user's local days
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("report_shares_user_idx").on(t.userId, t.createdAt.desc()),
    check("report_shares_range", sql`${t.toDate} >= ${t.fromDate}`),
  ],
);

export const milestoneStatus = pgEnum("milestone_status", ["pending", "accepted", "dismissed"]);

// A suggestion to move from the rehab plan to a gym plan. The user always decides; accepting
// marks the rehab plan done and never edits its limits.
export const milestones = pgTable(
  "milestones",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rehabPlanId: uuid()
      .notNull()
      .references(() => rehabPlans.id, { onDelete: "cascade" }),
    status: milestoneStatus().notNull().default("pending"),
    reasons: jsonb().$type<string[]>().notNull().default([]),
    hiddenUntil: timestamp({ withTimezone: true }), // set on dismiss
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("milestones_user_idx").on(t.userId, t.createdAt.desc())],
);
