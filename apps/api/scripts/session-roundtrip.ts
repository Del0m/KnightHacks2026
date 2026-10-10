// Operator entry point: same jobs as the API, no HTTP/admin endpoint needed.
import { neon } from "@neondatabase/serverless";
import { pino } from "pino";
import { createNeonDb } from "../src/db.js";
import { DatabricksUploader, uploadConfigFromEnv } from "../src/integrations/databricks/upload.js";
import { runExportRetry } from "../src/jobs/retryExports.js";
import { runInsightSync, syncConfigFromEnv } from "../src/jobs/syncInsights.js";
import { databricksExportQueue, drizzleExportStatusStore } from "../src/services/exportQueue.js";
const mode = process.argv[2];
if (!["retry", "sync"].includes(mode ?? ""))
  throw new Error("Usage: npm run session:roundtrip -- retry|sync");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the intended dev or demo branch");
const log = pino();
if (mode === "sync") {
  log.info(
    await runInsightSync({ db: neon(url), config: syncConfigFromEnv(), log }),
    "insight sync complete",
  );
} else {
  const { db, close } = createNeonDb(url);
  try {
    const queue = databricksExportQueue(
      new DatabricksUploader(uploadConfigFromEnv(), drizzleExportStatusStore(db), fetch, log),
      log,
    );
    log.info(await runExportRetry({ db, queue, log }), "export retry complete");
  } finally {
    await close();
  }
}
