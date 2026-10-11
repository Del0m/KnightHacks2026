// INT-04: re-checks posts and comments that were saved while moderation was unreachable
// (moderation_checked = false). Every few minutes, the oldest few go through the same Moderator:
//
//   allowed, checked   marked checked; nothing else changes
//   still unreachable  left for the next run (and the run stops early, so it doesn't hammer it)
//   blocked            removed, and logged to moderation_blocks with its categories, like a block
//                      at posting time. Self-harm is removed but never logged (CONN-09 policy).
//
// Removing rather than hiding keeps this to the moderation tables: the feed and comment queries
// don't need to know about it. Started from src/index.ts when moderation is configured.
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type { Moderator } from "../services/moderation.js";

const { posts, comments, moderationBlocks } = schema;

export const RECHECK_INTERVAL_MS = 5 * 60 * 1000;
const BATCH = 25;

export interface LogLike {
  info(msg: string): void;
  error(msg: string): void;
}

export interface RecheckDeps {
  db: Db;
  moderator: Moderator;
  log?: LogLike;
}

export interface RecheckResult {
  checked: number;
  removed: number;
  unreachable: boolean; // moderation still down: the rest wait for the next run
}

interface Item {
  kind: "post" | "comment";
  id: string;
  postId: string | null; // the post a comment is on
  authorId: string | null;
  body: string;
}

async function pending(db: Db): Promise<Item[]> {
  const p = await db
    .select({ id: posts.id, authorId: posts.authorId, body: posts.body, createdAt: posts.createdAt })
    .from(posts)
    .where(eq(posts.moderationChecked, false))
    .orderBy(asc(posts.createdAt))
    .limit(BATCH);
  const c = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(eq(comments.moderationChecked, false))
    .orderBy(asc(comments.createdAt))
    .limit(BATCH);
  return [
    ...p.map((r) => ({ kind: "post" as const, id: r.id, postId: null, authorId: r.authorId, body: r.body, at: r.createdAt })),
    ...c.map((r) => ({ kind: "comment" as const, id: r.id, postId: r.postId, authorId: r.authorId, body: r.body, at: r.createdAt })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, BATCH)
    .map(({ at: _at, ...item }) => item);
}

export async function runModerationRecheck({ db, moderator }: RecheckDeps): Promise<RecheckResult> {
  const result: RecheckResult = { checked: 0, removed: 0, unreachable: false };
  for (const item of await pending(db)) {
    const verdict = await moderator.check(item.body, item.kind);
    if (verdict.allowed && verdict.checked === false) {
      result.unreachable = true;
      break;
    }
    if (verdict.allowed) {
      const table = item.kind === "post" ? posts : comments;
      await db.update(table).set({ moderationChecked: true }).where(eq(table.id, item.id));
      result.checked++;
      continue;
    }
    await db.transaction(async (tx) => {
      if (!verdict.support && item.authorId) {
        await tx.insert(moderationBlocks).values({
          authorId: item.authorId,
          kind: item.kind,
          postId: item.kind === "comment" ? item.postId : null,
          body: item.body,
          categories: verdict.categories ?? [],
        });
      }
      if (item.kind === "post") await tx.delete(posts).where(eq(posts.id, item.id));
      else await tx.delete(comments).where(eq(comments.id, item.id));
    });
    result.removed++;
  }
  return result;
}

/** Runs now, then every 5 minutes. Never overlaps itself. Returns a stop function. */
export function startModerationRecheck(deps: RecheckDeps, intervalMs = RECHECK_INTERVAL_MS): () => void {
  let running = false;
  const log = deps.log ?? console;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runModerationRecheck(deps);
      if (r.checked || r.removed) {
        log.info(`[moderation] re-checked ${r.checked} and removed ${r.removed} saved while moderation was down`);
      }
    } catch (err) {
      log.error(`[moderation] re-check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
