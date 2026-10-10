// CONN-08: keeps profiles.embedding in step with each profile's goals and bio, so buddy matching
// (services/matching.ts) ranks by goal similarity instead of falling back to tag overlap.
//
// PUT /me/profile calls refresh after it responds, so a slow or failed embedding never holds up
// the edit; matching just uses tag overlap for that profile until the next refresh. Profiles
// with no goals or bio get a null embedding. scripts/embed-profiles.ts backfills the rest.
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import { profileText, type Embed } from "../integrations/huggingface/embeddings.js";

const { profiles } = schema;

export interface ProfileEmbeddings {
  refresh(userId: string): Promise<void>;
}

export function profileEmbeddings(db: Db, embed: Embed): ProfileEmbeddings {
  return {
    async refresh(userId) {
      const [row] = await db
        .select({ goals: profiles.goals, bio: profiles.bio })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      if (!row) return;
      const text = profileText(row);
      const embedding = text ? (await embed([text]))[0]! : null;
      await db.update(profiles).set({ embedding }).where(eq(profiles.userId, userId));
    },
  };
}

/** Embeds every profile that has goals or a bio but no embedding yet. Returns how many. */
export async function backfillProfileEmbeddings(db: Db, embed: Embed, batchSize = 32): Promise<number> {
  const rows = await db
    .select({ userId: profiles.userId, goals: profiles.goals, bio: profiles.bio })
    .from(profiles)
    .where(isNull(profiles.embedding));
  const todo = rows.flatMap((r) => {
    const text = profileText(r);
    return text ? [{ userId: r.userId, text }] : [];
  });
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const vectors = await embed(batch.map((r) => r.text));
    for (const [j, r] of batch.entries()) {
      await db.update(profiles).set({ embedding: vectors[j]! }).where(eq(profiles.userId, r.userId));
    }
  }
  return todo.length;
}
