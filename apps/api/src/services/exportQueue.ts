// BE-04 -> CONN-02: queue a finished session for upload to the Databricks Volume.
//
// The uploader retries with backoff and records export_status itself, so "queueing" here is
// fire-and-forget after the finish transaction commits; the HTTP response never waits on Databricks.
// Per-frame joints arrive with each set but are never written to Neon (§9.1): they wait in
// JointsBuffer until the session finishes. The buffer is in memory, so joints for sessions that
// are in flight during an API restart are lost (the aggregates in Neon are not).
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type {
  DatabricksUploader,
  ExportStatus,
  ExportStatusStore,
} from "../integrations/databricks/upload.js";
import type { ExportSession, JointFrame } from "../../../../specs/set-record/types.js";
export type { ExportSession } from "../../../../specs/set-record/types.js";

export interface ExportQueue {
  enqueue(session: ExportSession): void;
  payloadFor?(sessionId: string): ExportSession | undefined;
  exportNow?(session: ExportSession): Promise<ExportStatus>;
}

// Joints are never persisted in Neon. Bounded retention preserves them for retries.
const RETAIN_MAX = 500;
const RETAIN_MS = 24 * 60 * 60 * 1000;
export function databricksExportQueue(uploader: DatabricksUploader, log: Logger): Required<ExportQueue> {
  const retained = new Map<string, { session: ExportSession; at: number }>();
  const exportNow = async (session: ExportSession): Promise<ExportStatus> => {
    for (const [id, entry] of retained) if (entry.at < Date.now() - RETAIN_MS) retained.delete(id);
    if (!retained.has(session.id) && retained.size >= RETAIN_MAX)
      retained.delete(retained.keys().next().value!);
    retained.set(session.id, { session, at: retained.get(session.id)?.at ?? Date.now() });
    const status = await uploader.exportSession(session);
    if (status === "exported") retained.delete(session.id);
    return status;
  };
  return {
    enqueue(session) {
      exportNow(session).catch((err: unknown) => {
        log.error({ err, sessionId: session.id }, "databricks export crashed");
      });
    },
    payloadFor(sessionId) {
      const entry = retained.get(sessionId);
      if (entry && entry.at < Date.now() - RETAIN_MS) {
        retained.delete(sessionId);
        return undefined;
      }
      return entry?.session;
    },
    exportNow,
  };
}

export function disabledExportQueue(log: Logger): ExportQueue {
  let warned = false;
  return {
    enqueue(session) {
      if (!warned) log.warn("Databricks is not configured; finished sessions stay export_status=pending");
      warned = true;
      log.debug({ sessionId: session.id }, "skipped databricks export");
    },
  };
}

export function drizzleExportStatusStore(db: Db): ExportStatusStore {
  return {
    async claim(sessionId) {
      const { sessions } = schema;
      const now = new Date();
      const rows = await db
        .update(sessions)
        .set({
          exportStatus: "uploading",
          exportError: null,
          exportStartedAt: now,
          exportAttempts: sql`${sessions.exportAttempts} + 1`,
        })
        .where(
          and(
            eq(sessions.id, sessionId),
            isNotNull(sessions.finishedAt),
            or(
              inArray(sessions.exportStatus, ["pending", "failed"]),
              and(
                eq(sessions.exportStatus, "uploading"),
                or(
                  isNull(sessions.exportStartedAt),
                  lt(sessions.exportStartedAt, new Date(now.getTime() - 15 * 60 * 1000)),
                ),
              ),
            ),
          ),
        )
        .returning({ id: sessions.id });
      return rows.length > 0;
    },
    async set(sessionId: string, status: ExportStatus, error?: string) {
      await db
        .update(schema.sessions)
        .set({
          exportStatus: status,
          exportError: error ?? null,
          ...(status === "uploading"
            ? { exportAttempts: sql`${schema.sessions.exportAttempts} + 1`, exportStartedAt: new Date() }
            : {}),
          ...(status === "exported" ? { exportedAt: new Date() } : {}),
        })
        .where(eq(schema.sessions.id, sessionId));
    },
  };
}

// ---- Joints waiting for their session to finish ----

export interface BufferedSetJoints {
  fps: number | null;
  frames: JointFrame[];
}

export class JointsBuffer {
  private readonly bySession = new Map<string, { touched: number; sets: Map<number, BufferedSetJoints> }>();

  constructor(private readonly ttlMs = 6 * 60 * 60 * 1000) {}

  put(sessionId: string, setIndex: number, joints: BufferedSetJoints): void {
    this.evictStale();
    const entry = this.bySession.get(sessionId) ?? { touched: 0, sets: new Map() };
    entry.touched = Date.now();
    entry.sets.set(setIndex, joints);
    this.bySession.set(sessionId, entry);
  }

  // Read without removing: finishSession builds the upload inside its transaction and only
  // drains the buffer once that commits.
  peek(sessionId: string): ReadonlyMap<number, BufferedSetJoints> {
    return this.bySession.get(sessionId)?.sets ?? new Map();
  }

  take(sessionId: string): Map<number, BufferedSetJoints> {
    const entry = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    return entry?.sets ?? new Map();
  }

  private evictStale(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.bySession) if (entry.touched < cutoff) this.bySession.delete(id);
  }
}
