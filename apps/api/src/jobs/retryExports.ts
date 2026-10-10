// INT-08: retry Databricks uploads that didn't make it, so a finished session isn't lost.
//
// Every 10 minutes, finished sessions are re-uploaded (CONN-02) when they are:
//   failed                     the uploader gave up after its own retries
//   pending                    finished 15+ minutes ago and never queued
//   uploading                  upload lease is 15+ minutes old (e.g. API restarted)
// Retries continue until success. The export queue keeps each session's
// payload (with its joints) until its upload succeeds; after an API restart the session is rebuilt
// from Neon, which has everything except the per-frame joints (§9.1), so it's uploaded without them.
//
// Started from src/index.ts when Databricks is configured; run it on one API instance only.
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type { ExportQueue } from "../services/exportQueue.js";
import { buildExportSession } from "../services/sessions.js";

export const EXPORT_RETRY_INTERVAL_MS = 10 * 60 * 1000;
export const STALE_AFTER_MS = 15 * 60 * 1000;
const BATCH_SIZE = 50;

// Console or pino: both take a plain message.
export interface LogLike {
  info(msg: string): void;
  error(msg: string): void;
}

export interface RetryDeps {
  db: Db;
  queue: Required<Pick<ExportQueue, "payloadFor" | "exportNow">>;
  log?: LogLike;
  now?: () => Date;
}

export interface RetryResult {
  retried: number;
  exported: number;
  failed: number;
  without_joints: number; // rebuilt from Neon after a restart
}

export async function runExportRetry({
  db,
  queue,
  log = console,
  now = () => new Date(),
}: RetryDeps): Promise<RetryResult> {
  const { sessions } = schema;
  const staleBefore = new Date(now().getTime() - STALE_AFTER_MS);
  const due = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.finishedAt),
        or(
          eq(sessions.exportStatus, "failed"),
          and(eq(sessions.exportStatus, "pending"), lt(sessions.finishedAt, staleBefore)),
          and(
            eq(sessions.exportStatus, "uploading"),
            or(
              lt(sessions.exportStartedAt, staleBefore),
              and(isNull(sessions.exportStartedAt), lt(sessions.finishedAt, staleBefore)),
            ),
          ),
        ),
      ),
    )
    .orderBy(sql`coalesce(${sessions.exportStartedAt}, ${sessions.finishedAt}) asc`)
    .limit(BATCH_SIZE);

  const result: RetryResult = { retried: 0, exported: 0, failed: 0, without_joints: 0 };
  for (const { id, userId } of due) {
    try {
      let payload = queue.payloadFor(id);
      if (!payload) {
        payload = await buildExportSession(db, userId, id); // no joints
        result.without_joints++;
      }
      const status = await queue.exportNow(payload); // one at a time
      if (status === "uploading") continue; // another worker holds the lease
      result.retried++;
      if (status === "exported") result.exported++;
      else result.failed++;
    } catch (err) {
      result.retried++;
      result.failed++;
      log.error(`[exports] session ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

/** Runs every EXPORT_RETRY_INTERVAL_MS (first run after one interval). Never overlaps itself. */
export function startExportRetry(deps: RetryDeps, intervalMs = EXPORT_RETRY_INTERVAL_MS): () => void {
  let running = false;
  const log = deps.log ?? console;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runExportRetry(deps);
      if (r.retried) {
        log.info(
          `[exports] retried ${r.retried} session(s): ${r.exported} exported, ${r.failed} failed` +
            (r.without_joints ? `, ${r.without_joints} without joints (rebuilt after a restart)` : ""),
        );
      }
    } catch (err) {
      log.error(`[exports] retry run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
