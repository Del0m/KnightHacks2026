// BE-01: the Express app. Dependencies are passed in so tests can run it against PGlite with
// local signing keys, and so CONN clients can be swapped in as they land.
import express, { type RequestHandler } from "express";
import { pino, type Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Db } from "./db.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { requireAuth, type VerifyToken } from "./middleware/auth.js";
import { adviceRouter } from "./routes/advice.js";
import { buddiesRouter } from "./routes/buddies.js";
import { exercisesRouter } from "./routes/exercises.js";
import { feedRouter } from "./routes/feed.js";
import { healthRouter } from "./routes/health.js";
import { mediaRouter } from "./routes/media.js";
import { meRouter } from "./routes/me.js";
import { plansRouter } from "./routes/plans.js";
import { progressRouter } from "./routes/progress.js";
import { publicRecoveryRouter, recoveryRouter, type RecoveryOptions } from "./routes/recovery.js";
import { rehabRouter } from "./routes/rehab.js";
import { sessionsRouter } from "./routes/sessions.js";
import { setsRouter } from "./routes/sets.js";
import { socialRouter } from "./routes/social.js";
import { disabledExportQueue, JointsBuffer, type ExportQueue } from "./services/exportQueue.js";
import { AdviceWriter } from "./services/advice.js";
import type { AdviceDeps } from "./services/adviceThread.js";
import type { MediaDeps } from "./services/feedMedia.js";
import { allowAllModerator, type Moderator } from "./services/moderation.js";
import type { IntegrationStatus } from "./services/integrationStatus.js";
import type { PlannerDeps } from "./services/planner.js";
import type { ProfileEmbeddings } from "./services/profileEmbeddings.js";
import type { RestTimeDeps } from "./services/restTime.js";
import { userProvisioner } from "./services/users.js";

export interface AppDeps {
  db: Db;
  verifyToken: VerifyToken;
  logger?: Logger;
  exportQueue?: ExportQueue;
  moderator?: Moderator;
  joints?: JointsBuffer;
  pseudonymSecret?: string;
  corsOrigins?: string[];
  rest?: RestTimeDeps; // INT-05: set scoring + rest notes; defaults to phone score + fixed notes
  planner?: PlannerDeps; // AI-12: gpt-oss and the query embedder; defaults to the rules planner
  recovery?: RecoveryOptions; // BE-16/BE-17: tests pin the clock
  advice?: AdviceDeps; // BE-11: AI-13 writer and the query embedder; defaults to no AI answer
  media?: MediaDeps; // feed photos and videos: R2 storage and the photo check; defaults to off
  profileEmbeddings?: ProfileEmbeddings; // CONN-08: buddy-matching embeddings; off without HF_TOKEN
  integrations?: IntegrationStatus; // INT-04: per-integration state for GET /health
}

function cors(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origins.includes("*") || origins.includes(origin))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function createApp(deps: AppDeps): express.Express {
  const logger = deps.logger ?? pino({ level: "silent" });
  const exportQueue = deps.exportQueue ?? disabledExportQueue(logger);
  const joints = deps.joints ?? new JointsBuffer();
  const moderator = deps.moderator ?? allowAllModerator;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    pinoHttp({
      logger,
      // Never log tokens.
      redact: ["req.headers.authorization", "req.headers.cookie"],
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  if (deps.corsOrigins?.length) app.use(cors(deps.corsOrigins));
  // Sets can carry a few minutes of per-frame joints.
  app.use(express.json({ limit: "5mb" }));

  // Public
  app.use(healthRouter(deps.db, deps.integrations));
  app.use(exercisesRouter(deps.db));
  // BE-16: a shared physio report opens without an account; its unguessable token is the access.
  app.use(publicRecoveryRouter(deps.db, deps.recovery));

  // Everything below needs a Neon Auth token.
  const provision = userProvisioner(deps.db, deps.pseudonymSecret);
  const media: MediaDeps = deps.media ?? { storage: null, checkImage: null, log: logger };
  app.use(requireAuth(deps.verifyToken, provision));
  app.use(
    meRouter(deps.db, {
      pseudonymSecret: deps.pseudonymSecret,
      onAccountDeleted: provision.forget,
      profileEmbeddings: deps.profileEmbeddings,
      media,
    }),
  );
  app.use(sessionsRouter(deps.db, { exportQueue, joints, log: logger, rest: deps.rest }));
  app.use(setsRouter(deps.db));
  app.use(progressRouter(deps.db));
  app.use(rehabRouter(deps.db));
  app.use(recoveryRouter(deps.db, deps.recovery));
  app.use(plansRouter(deps.db, deps.planner ?? { llm: null, embed: null, log: logger }));
  app.use(feedRouter(deps.db, media));
  app.use(socialRouter(deps.db, moderator, media));
  app.use(mediaRouter(deps.db, media));
  app.use(
    adviceRouter(
      deps.db,
      moderator,
      deps.advice ?? { writer: new AdviceWriter(null), embed: null, log: logger },
    ),
  );
  app.use(buddiesRouter(deps.db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
