import { pino } from "pino";
import { createApp } from "./app.js";
import { createNeonDb } from "./db.js";
import { neon } from "@neondatabase/serverless";
import { databricksConfigured, insightSyncConfigured, loadEnv } from "./env.js";
import { DatabricksUploader, uploadConfigFromEnv } from "./integrations/databricks/upload.js";
import { Moderator as LlamaGuard, moderationConfigFromEnv } from "./integrations/huggingface/moderation.js";
import { startInsightSync, syncConfigFromEnv } from "./jobs/syncInsights.js";
import { neonAuthVerifier } from "./middleware/auth.js";
import {
  databricksExportQueue,
  disabledExportQueue,
  drizzleExportStatusStore,
} from "./services/exportQueue.js";
import { allowAllModerator, llamaGuardModerator } from "./services/moderation.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: env.LOG_LEVEL });

const { db, close } = createNeonDb(env.DATABASE_URL);

const exportQueue = databricksConfigured(env)
  ? databricksExportQueue(
      new DatabricksUploader(uploadConfigFromEnv(), drizzleExportStatusStore(db), fetch, logger),
      logger,
    )
  : disabledExportQueue(logger);

// CONN-09: Llama Guard on posts and comments.
const moderator = env.HF_TOKEN
  ? llamaGuardModerator(new LlamaGuard(moderationConfigFromEnv(), undefined, logger))
  : allowAllModerator;
if (!env.HF_TOKEN) logger.warn("HF_TOKEN is not set; posts and comments are not moderated");

// CONN-06: copy gold tables into Neon every 15 minutes. Run it on one API instance only.
const stopInsightSync = insightSyncConfigured(env)
  ? startInsightSync({ db: neon(env.DATABASE_URL), config: syncConfigFromEnv(), log: logger })
  : () => {};

const app = createApp({
  db,
  logger,
  exportQueue,
  moderator,
  verifyToken: neonAuthVerifier(env.NEON_AUTH_JWKS_URL, {
    issuer: env.NEON_AUTH_ISSUER,
    audience: env.NEON_AUTH_AUDIENCE,
  }),
  pseudonymSecret: env.SPOTTER_PSEUDONYM_SECRET,
  corsOrigins: env.CORS_ORIGINS?.split(",").map((s) => s.trim()),
});

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      databricksExport: databricksConfigured(env),
      insightSync: insightSyncConfigured(env),
      moderation: Boolean(env.HF_TOKEN),
    },
    "spotter api listening",
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopInsightSync();
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
