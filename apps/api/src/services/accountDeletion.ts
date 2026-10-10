// CONN-13: delete an account (Architecture §13).
//
// One transaction:
//   1. read the user's pseudonym (stored at sign-up; recomputed if an older row has none)
//   2. queue a deletion request for Databricks with that pseudonym only
//   3. delete the users row; every table that holds the user's data references users with
//      ON DELETE CASCADE, so profiles, injuries, sessions, sets, reps, flags, posts, comments,
//      kudos, follows, blocks, buddy matches, plans, goals, medals, PRs, progress_daily and
//      risk_insights go with it (test/account-deletion.test.ts checks every foreign key)
//
// The Databricks side runs in databricks/notebooks/delete_user.py; see
// docs/runbooks/account-deletion.md.
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { pseudonymize } from "../integrations/databricks/upload.js";

export interface DeletionResult {
  deleted: boolean; // false when there was no account (already deleted)
  queuedForDatabricks: boolean; // false when the user never had a pseudonym, so nothing was uploaded
}

export async function deleteAccount(
  db: Db,
  userId: string,
  pseudonymSecret?: string,
): Promise<DeletionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ pseudonym: schema.users.pseudonym })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) return { deleted: false, queuedForDatabricks: false };

    // Uploads only happen with the secret set (databricksConfigured), so no pseudonym means no
    // Databricks data for this user.
    const pseudonym = user.pseudonym ?? (pseudonymSecret ? pseudonymize(userId, pseudonymSecret) : null);
    if (pseudonym) await tx.insert(schema.deletionRequests).values({ pseudonym });

    await tx.delete(schema.users).where(eq(schema.users.id, userId));
    return { deleted: true, queuedForDatabricks: Boolean(pseudonym) };
  });
}
