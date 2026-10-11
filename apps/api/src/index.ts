import { pino } from "pino";
import { createApp } from "./app.js";
import { createNeonDb } from "./db.js";
import { databricksConfigured, insightSyncConfigured, insightSyncEnabled, loadEnv } from "./env.js";
import { DatabricksUploader, uploadConfigFromEnv } from "./integrations/databricks/upload.js";
import { Moderator as LlamaGuard, moderationConfigFromEnv } from "./integrations/huggingface/moderation.js";
import { startExportRetry } from "./jobs/retryExports.js";
import { startModerationRecheck } from "./jobs/recheckModeration.js";
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
import { IntegrationStatus, tracked } from "./services/integrationStatus.js";
import { allowAllModerator, llamaGuardModerator } from "./services/moderation.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: env.LOG_LEVEL });

// One Neon pool for the routes, the export status store and the insight sync.
const { db, query, close } = createNeonDb(env.DATABASE_URL);

// INT-04: each integration's state for GET /health: disabled without its env, then live or error
// from its latest real call.
const scoringConfigured = Boolean(
  env.DATABRICKS_HOST && env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET,
);
const poseEndpoint = poseEndpointConfigFromEnv(env);
const integrations = new IntegrationStatus();
integrations.configure("databricks_export", databricksConfigured(env));
integrations.configure("insight_sync", insightSyncEnabled(env));
integrations.configure("set_scoring", scoringConfigured);
for (const name of ["llm", "moderation", "embeddings"] as const)
  integrations.configure(name, Boolean(env.HF_TOKEN));
integrations.configure("cloud_pose", Boolean(poseEndpoint));

const uploader = databricksConfigured(env)
  ? new DatabricksUploader(uploadConfigFromEnv(env), drizzleExportStatusStore(db), fetch, logger)
  : null;
const databricksQueue = uploader
  ? databricksExportQueue(
      {
        exportSession: (session) =>
          tracked(
            integrations,
            "databricks_export",
            () => uploader.exportSession(session),
            (status) => (status === "exported" ? null : "upload_failed"),
          ),
      },
      logger,
    )
  : null;
const exportQueue = databricksQueue ?? disabledExportQueue(logger);
const stopExportRetry = databricksQueue
  ? startExportRetry({ db, queue: databricksQueue, log: logger })
  : () => {};

// CONN-07: gpt-oss chain, shared by rest notes and the threats/harassment check.
const hfLlm = env.HF_TOKEN ? new HfLlm(llmConfigFromEnv(env)) : null;
const llm: Pick<HfLlm, "generateJson"> | null = hfLlm
  ? { generateJson: (input) => tracked(integrations, "llm", () => hfLlm.generateJson(input)) }
  : null;

// CONN-09: Llama Guard plus the threats/harassment check on posts and comments.
const guard = env.HF_TOKEN ? new LlamaGuard(moderationConfigFromEnv(env), undefined, logger, llm) : null;
const moderator = guard
  ? llamaGuardModerator({
      // Llama Guard never throws; checked: false means it (or the threats check) was unreachable.
      moderate: (text, kind) =>
        tracked(
          integrations,
          "moderation",
          () => guard.moderate(text, kind),
          (r) => (r.checked ? null : "unreachable"),
        ),
    })
  : allowAllModerator;
if (!env.HF_TOKEN) logger.warn("HF_TOKEN is not set; posts and comments are not moderated");
// INT-04: re-check what was saved while moderation was unreachable.
const stopModerationRecheck = guard ? startModerationRecheck({ db, moderator, log: logger }) : () => {};

// CONN-06: copy gold tables into Neon every 15 minutes, on the one instance with
// INSIGHT_SYNC_ENABLED=true.
const stopInsightSync = insightSyncEnabled(env)
  ? startInsightSync({ db: { query }, config: syncConfigFromEnv(env), log: logger, status: integrations })
  : () => {};
if (insightSyncConfigured(env) && !insightSyncEnabled(env)) {
  logger.info("insight sync is configured but INSIGHT_SYNC_ENABLED isn't true; another instance runs it");
}

// INT-05: rest-time scoring (CONN-05) and rest notes (CONN-07). Each is optional: without
// Databricks the phone's rule score is used, without HF_TOKEN the spec's fixed note.
const scorer = scoringConfigured ? new DatabricksScorer(scoreConfigFromEnv(env), fetch, logger) : null;
const rest = {
  // The scorer falls back to the phone's score itself; a fallback (other than "no reps") is an error.
  scorer: scorer
    ? {
        scoreSet: (input: Parameters<DatabricksScorer["scoreSet"]>[0]) =>
          tracked(
            integrations,
            "set_scoring",
            () => scorer.scoreSet(input),
            (score) =>
              score.source === "databricks"
                ? null
                : score.fallback_reason === "no reps"
                  ? undefined
                  : /timed out/i.test(score.fallback_reason ?? "")
                    ? "timeout"
                    : "fallback",
          ),
      }
    : null,
  notes: new RestNoteWriter(llm, logger),
};

// AI-12: gpt-oss drafts plans and bge-small embeds the search; without HF_TOKEN the rules planner runs.
const planner = {
  llm,
  embed: env.HF_TOKEN
    ? (
        (embedQuery) => (q: string, timeoutMs: number) =>
          tracked(integrations, "embeddings", () => embedQuery(q, timeoutMs))
      )(hfQueryEmbedder(env.HF_TOKEN))
    : null,
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
  profileEmbeddings: env.HF_TOKEN
    ? profileEmbeddings(
        db,
        (
          (embed) => (texts: string[]) =>
            tracked(integrations, "embeddings", () => embed(texts))
        )(hfEmbedder(env.HF_TOKEN)),
      )
    : undefined,
  integrations,
  pseudonymSecret: env.STEADYFORUM_PSEUDONYM_SECRET,
  corsOrigins: env.CORS_ORIGINS?.split(",").map((s) => s.trim()),
});

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      databricksExport: databricksConfigured(env),
      insightSync: insightSyncEnabled(env),
      moderation: Boolean(env.HF_TOKEN),
      profileEmbeddings: Boolean(env.HF_TOKEN),
      cloudPose: Boolean(poseEndpoint),
      setScoring: scoringConfigured,
      llmRestNotes: Boolean(env.HF_TOKEN),
      llmPlans: Boolean(env.HF_TOKEN),
    },
    "steadyforum api listening",
  );
});

// CONN-11: cloud pose mode. Phones stream frames over a WebSocket; the HF token stays here.
const stopPoseStream = poseEndpoint
  ? attachPoseStream(server, {
      verifyToken,
      endpoint: ((client) => ({
        // "warming" (scaling up from zero) says nothing either way; "error" is a failure.
        detect: (jpeg: Buffer, timestampMs: number) =>
          tracked(
            integrations,
            "cloud_pose",
            () => client.detect(jpeg, timestampMs),
            (reply) => (reply.status === "ok" ? null : reply.status === "error" ? "failed" : undefined),
          ),
      }))(new PoseEndpointClient(poseEndpoint)),
      log: logger,
    })
  : () => {};

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopInsightSync();
  stopModerationRecheck();
  stopExportRetry();
  stopPoseStream();
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
