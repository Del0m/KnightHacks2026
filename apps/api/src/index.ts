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
import { hfQueryEmbedder } from "./integrations/huggingface/embed.js";
import { hfEmbedder } from "./integrations/huggingface/embeddings.js";
import { profileEmbeddings } from "./services/profileEmbeddings.js";
import { RestNoteWriter } from "./services/restNote.js";
import { AdviceWriter } from "./services/advice.js";
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
      new DatabricksUploader(uploadConfigFromEnv(env), drizzleExportStatusStore(db), fetch, logger),
      logger,
    )
  : null;
const exportQueue = databricksQueue ?? disabledExportQueue(logger);
const stopExportRetry = databricksQueue
  ? startExportRetry({ db, queue: databricksQueue, log: logger })
  : () => {};

// CONN-07: gpt-oss chain, shared by rest notes and the threats/harassment check.
const llm = env.HF_TOKEN ? new HfLlm(llmConfigFromEnv(env)) : null;

// CONN-09: Llama Guard plus the threats/harassment check on posts and comments.
const moderator = env.HF_TOKEN
  ? llamaGuardModerator(new LlamaGuard(moderationConfigFromEnv(env), undefined, logger, llm))
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
  notes: new RestNoteWriter(llm, logger),
};

// AI-12: gpt-oss drafts plans and bge-small embeds the search; without HF_TOKEN the rules planner runs.
const planner = {
  llm,
  embed: env.HF_TOKEN ? hfQueryEmbedder(env.HF_TOKEN) : null,
  log: logger,
};

// BE-11: AI-13 writes the suggested first answer to advice questions; without HF_TOKEN there is none
// (the fixed pain reply still works, it needs no model).
const advice = { writer: new AdviceWriter(llm, logger), embed: planner.embed, log: logger };

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
  planner,
  advice,
  // CONN-08: buddy-matching embeddings, refreshed when goals or bio change.
  profileEmbeddings: env.HF_TOKEN ? profileEmbeddings(db, hfEmbedder(env.HF_TOKEN)) : undefined,
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
      profileEmbeddings: Boolean(env.HF_TOKEN),
      cloudPose: Boolean(poseEndpoint),
      setScoring: scoringConfigured,
      llmRestNotes: Boolean(env.HF_TOKEN),
      llmPlans: Boolean(env.HF_TOKEN),
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
