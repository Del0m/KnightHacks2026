import { pino } from "pino";
import { createApp } from "./app.js";
import { createNeonDb } from "./db.js";
import { neon } from "@neondatabase/serverless";
import { databricksConfigured, insightSyncConfigured, loadEnv } from "./env.js";
import { DatabricksUploader, uploadConfigFromEnv } from "./integrations/databricks/upload.js";
import { Moderator as LlamaGuard, moderationConfigFromEnv } from "./integrations/huggingface/moderation.js";
import { startExportRetry } from "./jobs/retryExports.js";
import { startInsightSync, syncConfigFromEnv } from "./jobs/syncInsights.js";
import { neonAuthVerifier } from "./middleware/auth.js";
import { PoseEndpointClient, poseEndpointConfigFromEnv } from "./integrations/huggingface/poseEndpoint.js";
import { attachPoseStream } from "./routes/poseStream.js";
import { DatabricksScorer, scoreConfigFromEnv } from "./integrations/databricks/score.js";
import { HfLlm, llmConfigFromEnv } from "./integrations/huggingface/llm.js";
import { RestNoteWriter } from "./services/restNote.js";
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

const databricksQueue = databricksConfigured(env)
  ? databricksExportQueue(
      new DatabricksUploader(uploadConfigFromEnv(), drizzleExportStatusStore(db), fetch, logger),
      logger,
    )
  : null;
const exportQueue = databricksQueue ?? disabledExportQueue(logger);
const stopExportRetry = databricksQueue
  ? startExportRetry({ db, queue: databricksQueue, log: logger })
  : () => {};

// CONN-09: Llama Guard on posts and comments.
const moderator = env.HF_TOKEN
  ? llamaGuardModerator(new LlamaGuard(moderationConfigFromEnv(), undefined, logger))
  : allowAllModerator;
if (!env.HF_TOKEN) logger.warn("HF_TOKEN is not set; posts and comments are not moderated");

// CONN-06: copy gold tables into Neon every 15 minutes. Run it on one API instance only.
const stopInsightSync = insightSyncConfigured(env)
  ? startInsightSync({ db: neon(env.DATABASE_URL), config: syncConfigFromEnv(), log: logger })
  : () => {};

// INT-05: rest-time scoring (CONN-05) and rest notes (CONN-07). Each is optional: without
// Databricks the phone's rule score is used, without HF_TOKEN the spec's fixed note.
const scoringConfigured = Boolean(
  env.DATABRICKS_HOST && env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET,
);
const rest = {
  scorer: scoringConfigured ? new DatabricksScorer(scoreConfigFromEnv(env), fetch, logger) : null,
  notes: new RestNoteWriter(env.HF_TOKEN ? new HfLlm(llmConfigFromEnv()) : null, logger),
};

const verifyToken = neonAuthVerifier(env.NEON_AUTH_JWKS_URL, {
  issuer: env.NEON_AUTH_ISSUER,
  audience: env.NEON_AUTH_AUDIENCE,
});

const app = createApp({
  db,
  logger,
  exportQueue,
  moderator,
  verifyToken,
  rest,
  pseudonymSecret: env.SPOTTER_PSEUDONYM_SECRET,
  corsOrigins: env.CORS_ORIGINS?.split(",").map((s) => s.trim()),
});

const poseEndpoint = poseEndpointConfigFromEnv();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      databricksExport: databricksConfigured(env),
      insightSync: insightSyncConfigured(env),
      moderation: Boolean(env.HF_TOKEN),
      cloudPose: Boolean(poseEndpoint),
      setScoring: scoringConfigured,
      llmRestNotes: Boolean(env.HF_TOKEN),
    },
    "spotter api listening",
  );
});

// CONN-11: cloud pose mode. Phones stream frames over a WebSocket; the HF token stays here.
const stopPoseStream = poseEndpoint
  ? attachPoseStream(server, { verifyToken, endpoint: new PoseEndpointClient(poseEndpoint), log: logger })
  : () => {};

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopInsightSync();
  stopExportRetry();
  stopPoseStream();
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
