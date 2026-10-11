// BE-01: the Express app. Dependencies are passed in so tests can run it against PGlite with
// local signing keys, and so CONN clients can be swapped in as they land.
import express, { type RequestHandler } from "express";
import { pino, type Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Db } from "./db.js";
import { errorHandler, notFoundHandler } from "./http.js";
import { requireAuth, type VerifyToken } from "./middleware/auth.js";
import { buddiesRouter } from "./routes/buddies.js";
import { exercisesRouter } from "./routes/exercises.js";
import { feedRouter } from "./routes/feed.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { plansRouter } from "./routes/plans.js";
import { progressRouter } from "./routes/progress.js";
import { rehabRouter } from "./routes/rehab.js";
import { sessionsRouter } from "./routes/sessions.js";
import { setsRouter } from "./routes/sets.js";
import { socialRouter } from "./routes/social.js";
import { disabledExportQueue, JointsBuffer, type ExportQueue } from "./services/exportQueue.js";
import { allowAllModerator, type Moderator } from "./services/moderation.js";
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
  profileEmbeddings?: ProfileEmbeddings; // CONN-08: buddy-matching embeddings; off without HF_TOKEN
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
  app.use(healthRouter(deps.db));
  app.use(exercisesRouter(deps.db));

  // Everything below needs a Neon Auth token.
  const provision = userProvisioner(deps.db, deps.pseudonymSecret);
  app.use(requireAuth(deps.verifyToken, provision));
  app.use(
    meRouter(deps.db, {
      pseudonymSecret: deps.pseudonymSecret,
      onAccountDeleted: provision.forget,
      profileEmbeddings: deps.profileEmbeddings,
    }),
  );
  app.use(sessionsRouter(deps.db, { exportQueue, joints, log: logger, rest: deps.rest }));
  app.use(setsRouter(deps.db));
  app.use(progressRouter(deps.db));
  app.use(rehabRouter(deps.db));
  app.use(plansRouter(deps.db, deps.planner ?? { llm: null, embed: null, log: logger }));
  app.use(feedRouter(deps.db));
  app.use(socialRouter(deps.db, moderator));
  app.use(buddiesRouter(deps.db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
