// Creates the users + profiles rows the first time a Neon Auth user calls the API.
import { createHash } from "node:crypto";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { pseudonymize } from "../integrations/databricks/upload.js";

export function defaultHandle(userId: string): string {
  return `lifter_${createHash("sha256").update(userId).digest("hex").slice(0, 10)}`;
}

export function userProvisioner(db: Db, pseudonymSecret?: string) {
  // Known ids skip the database on later requests. Bounded so a long-running process can't grow it forever.
  const known = new Set<string>();
  const MAX_KNOWN = 50_000;

  const ensureUser = async ({ id }: { id: string }): Promise<void> => {
    if (known.has(id)) return;
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.users)
        .values({
          id,
          handle: defaultHandle(id),
          pseudonym: pseudonymSecret ? pseudonymize(id, pseudonymSecret) : null,
        })
        .onConflictDoNothing({ target: schema.users.id });
      await tx
        .insert(schema.profiles)
        .values({ userId: id })
        .onConflictDoNothing({ target: schema.profiles.userId });
    });
    if (known.size >= MAX_KNOWN) known.clear();
    known.add(id);
  };
  // After DELETE /me (CONN-13): the next request with a still-valid token starts a fresh,
  // empty account instead of writing against a users row that no longer exists.
  const forget = (id: string): void => void known.delete(id);
  return Object.assign(ensureUser, { forget });
}
