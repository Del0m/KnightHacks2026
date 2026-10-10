// CONN-13: account deletion requests for Databricks (Architecture §13).
//
// DELETE /me writes the user's pseudonym here before the users row (and everything that cascades
// from it) is deleted, because the pseudonym can't be recomputed once the user id is gone. The
// daily Databricks job (databricks/notebooks/delete_user.py) deletes that pseudonym's data and
// marks the request done. Holds no other personal data: no user id, no email, no handle.
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const deletionStatus = pgEnum("deletion_status", ["pending", "done"]);

export const deletionRequests = pgTable(
  "deletion_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    pseudonym: text().notNull(),
    // Databricks rows uploaded after this belong to a new account with the same login, so the
    // job leaves them alone.
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    status: deletionStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    // Error type only (e.g. "AnalysisException"), never row data.
    lastError: text(),
    doneAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("deletion_requests_status_idx").on(t.status, t.requestedAt)],
);
