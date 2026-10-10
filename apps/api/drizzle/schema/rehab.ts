// DB-12: rehab plans, physio limits and the range-of-motion trend (Architecture §1.1, §9.2).
//
// So far only rom_trend, the Neon copy of gold_rom_trend written by the insight sync (CONN-14,
// src/jobs/syncInsights.ts), with the columns and upsert key DB-12 specifies. DB-12 adds
// rehab_plans, rehab_limits and injuries.side to this file.
import { date, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

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
