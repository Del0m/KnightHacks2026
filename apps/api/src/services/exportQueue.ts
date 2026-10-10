// BE-04 -> CONN-02: queue a finished session for upload to the Databricks Volume.
//
// The uploader retries with backoff and records export_status itself, so "queueing" here is
// fire-and-forget after the finish transaction commits; the HTTP response never waits on Databricks.
// Per-frame joints arrive with each set but are never written to Neon (§9.1): they wait in
// JointsBuffer until the session finishes. The buffer is in memory, so joints for sessions that
// are in flight during an API restart are lost (the aggregates in Neon are not).
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../db.js";
import { schema } from "../db.js";
import type {
  DatabricksUploader,
  ExportStatus,
  ExportStatusStore,
  FinishedSession,
  JointFrame,
} from "../integrations/databricks/upload.js";

// The session as the uploader takes it (CONN-02).
export type ExportSession = FinishedSession;

export interface ExportQueue {
  enqueue(session: ExportSession): void;
}

export function databricksExportQueue(uploader: DatabricksUploader, log: Logger): ExportQueue {
  return {
    enqueue(session) {
      uploader.exportSession(session).catch((err: unknown) => {
        log.error({ err, sessionId: session.id }, "databricks export crashed");
      });
    },
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
    async set(sessionId: string, status: ExportStatus, error?: string) {
      await db
        .update(schema.sessions)
        .set({
          exportStatus: status,
          exportError: error ?? null,
          ...(status === "exported" ? { exportedAt: new Date() } : {}),
        })
        .where(eq(schema.sessions.id, sessionId));
    },
  };
}

// ---- Joints waiting for their session to finish ----

export interface BufferedSetJoints {
  fps: number;
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
