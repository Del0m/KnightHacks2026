// Removes feed uploads that were never posted (services/feedMedia.ts): every hour, pending rows
// older than a day go, with their files. Started from src/index.ts when R2 is configured.
import type { Db } from "../db.js";
import { cleanupPendingMedia, type MediaDeps } from "../services/feedMedia.js";

export const MEDIA_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function startMediaCleanup(opts: {
  db: Db;
  media: MediaDeps;
  log: { info(msg: string): void; error(msg: string): void };
}): () => void {
  const run = async () => {
    try {
      const removed = await cleanupPendingMedia(opts.db, opts.media);
      if (removed) opts.log.info(`[media] removed ${removed} unposted uploads`);
    } catch (err) {
      opts.log.error(`[media] cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const timer = setInterval(run, MEDIA_CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
