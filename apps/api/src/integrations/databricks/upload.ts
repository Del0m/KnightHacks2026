// upload each finished session to the Databricks Volume via Files API.
//
// Per session we write two files (see databricks/setup.sql):
//   <volume>/joints/<date>/<session_id>.ndjson.gz  one line per set, per-frame joints
//   <volume>/meta/<date>/<session_id>.json         session metadata + per-rep aggregates
// Joints go first and metadata last, so Auto Loader never sees metadata whose joints are missing.
// Both PUTs use overwrite=true, so retrying a whole session is idempotent.
//
// Privacy (Architecture §13): payloads are built from an explicit allow-list of fields, so
// nothing else on the input (video, frames, email, handle) can leak through, and the user id
// is replaced with an HMAC pseudonym.
//
import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  ExportJointsLine,
  ExportMeta,
  ExportSession,
  JointFrame,
} from "../../../../../specs/set-record/types.js";
import type { Env } from "../../env.js";
export type {
  JointFrame,
  Rep as FinishedRep,
  ExportSet as FinishedSet,
  ExportSession as FinishedSession,
} from "../../../../../specs/set-record/types.js";
type FinishedSession = ExportSession;

export const JOINT_COUNT = 17; // COCO keypoints
export const VALUES_PER_JOINT = 3; // x, y, confidence

// ---- export_status in Neon ----

export type ExportStatus = "pending" | "uploading" | "exported" | "failed";

// Implemented by drizzleExportStatusStore (services/exportQueue.ts).
export interface ExportStatusStore {
  claim?(sessionId: string): Promise<boolean>;
  set(sessionId: string, status: ExportStatus, error?: string): Promise<void>;
}

// ---- Config ----

export interface UploadConfig {
  host: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  volumePath: string;
  pseudonymSecret: string;
  maxAttempts: number;
  baseDelayMs: number;
}

type UploadEnv = Pick<
  Env,
  | "DATABRICKS_HOST"
  | "DATABRICKS_CLIENT_ID"
  | "DATABRICKS_CLIENT_SECRET"
  | "DATABRICKS_OAUTH_SCOPES"
  | "DATABRICKS_VOLUME_PATH"
  | "STEADYFORUM_PSEUDONYM_SECRET"
>;

/** From the validated env (src/env.ts); scripts can pass process.env. */
export function uploadConfigFromEnv(env: UploadEnv = process.env): UploadConfig {
  const required = [
    "DATABRICKS_HOST",
    "DATABRICKS_CLIENT_ID",
    "DATABRICKS_CLIENT_SECRET",
    "STEADYFORUM_PSEUDONYM_SECRET",
  ] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing env for Databricks upload: ${missing.join(", ")}`);

  return {
    host: env.DATABRICKS_HOST!.replace(/\/+$/, ""),
    clientId: env.DATABRICKS_CLIENT_ID!,
    clientSecret: env.DATABRICKS_CLIENT_SECRET!,
    scopes: env.DATABRICKS_OAUTH_SCOPES || "all-apis",
    volumePath: (env.DATABRICKS_VOLUME_PATH || "/Volumes/steadyforum/raw/sessions").replace(/\/+$/, ""),
    pseudonymSecret: env.STEADYFORUM_PSEUDONYM_SECRET!,
    maxAttempts: 5,
    baseDelayMs: 500,
  };
}

// ---- Payloads ----

export type InjurySide = "left" | "right" | "both";

/** A coarse injury tag for Databricks: "knee", or "knee:left" when the side is known. */
export function injuryGroup(bodyPart: string, side?: string | null): string {
  return side === "left" || side === "right" || side === "both" ? `${bodyPart}:${side}` : bodyPart;
}

// Only tags of that shape leave the server, so free text can't slip into Databricks.
const isInjuryGroup = (tag: unknown): tag is string =>
  typeof tag === "string" && /^[a-z_]{1,20}(:(left|right|both))?$/.test(tag);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const SCHEMA_VERSION = 1;

// Stable per user, not reversible without the secret. The Databricks delete job (§13)
// recomputes it from the Neon user id.
export function pseudonymize(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
}

export function volumePaths(session: FinishedSession, volumePath: string) {
  const date = session.finished_at.slice(0, 10); // YYYY-MM-DD partition
  return {
    joints: `${volumePath}/joints/${date}/${session.id}.ndjson.gz`,
    meta: `${volumePath}/meta/${date}/${session.id}.json`,
  };
}

function assertFrame(frame: JointFrame): JointFrame {
  const len = JOINT_COUNT * VALUES_PER_JOINT;
  if (!Array.isArray(frame.kp) || frame.kp.length !== len || !frame.kp.every(Number.isFinite)) {
    throw new NonRetryableError(`Joint frame must be ${len} finite numbers`);
  }
  return { t_ms: frame.t_ms, kp: frame.kp };
}

export function buildJointsFile(session: FinishedSession): Buffer {
  const lines = session.sets.map((set) => {
    const line: ExportJointsLine = {
      session_id: session.id,
      set_index: set.set_index,
      exercise_id: set.exercise_id,
      fps: set.fps,
      frames: set.frames.map(assertFrame),
    };
    return JSON.stringify(line);
  });
  return gzipSync(lines.join("\n") + "\n");
}

export function buildMetadata(
  session: FinishedSession,
  config: UploadConfig,
  jointsPath: string,
): ExportMeta {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: session.id,
    user_id: pseudonymize(session.user_id, config.pseudonymSecret),
    started_at: session.started_at,
    finished_at: session.finished_at,
    device: session.device,
    inference_mode: session.inference_mode,
    medal: session.medal,
    form_score: session.form_score,
    experience_level: session.experience_level,
    injury_groups: session.injury_groups.filter(isInjuryGroup),
    rehab_start_on: isDate(session.rehab_start_on) ? session.rehab_start_on : null,
    joints_path: jointsPath,
    exported_at: new Date().toISOString(),
    sets: session.sets.map((set) => ({
      set_index: set.set_index,
      exercise_id: set.exercise_id,
      weight_kg: set.weight_kg,
      medal: set.medal,
      end_reason: set.end_reason,
      partial_reps: set.partial_reps,
      frame_count: set.frames.length,
      reps: set.reps.map((rep) => ({
        rep_index: rep.rep_index,
        start_ms: rep.start_ms,
        end_ms: rep.end_ms,
        tempo_ms: rep.tempo_ms,
        range_deg: rep.range_deg,
        quality: rep.quality,
        lowering_ms: rep.lowering_ms,
        rising_ms: rep.rising_ms,
        flags: rep.flags.map((flag) => ({
          rule_id: flag.rule_id,
          severity: flag.severity,
          rep_index: flag.rep_index,
        })),
      })),
    })),
  };
}

// ---- HTTP ----

export class NonRetryableError extends Error {
  name = "NonRetryableError";
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof HttpError)
    return err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500;
  return true; // network errors, timeouts
}

// Console or pino: both take a plain message.
export interface LogLike {
  error(msg: string): void;
}

export class DatabricksUploader {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: UploadConfig,
    private readonly status: ExportStatusStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: LogLike = console,
  ) {}

  /** Uploads a finished session and records the outcome in Neon. Never throws. */
  async exportSession(session: FinishedSession): Promise<ExportStatus> {
    if (this.status.claim) {
      if (!(await this.status.claim(session.id))) return "uploading";
    } else {
      await this.status.set(session.id, "uploading");
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        await this.uploadOnce(session);
        await this.status.set(session.id, "exported");
        return "exported";
      } catch (err) {
        lastError = err;
        if (err instanceof HttpError && err.status === 401) this.token = null;
        if (!isRetryable(err) || attempt === this.config.maxAttempts) break;

        const backoff = this.config.baseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.random() * this.config.baseDelayMs;
        const retryAfter = err instanceof HttpError ? (err.retryAfterMs ?? 0) : 0;
        // Keep a configured five-attempt run inside the 15-minute export lease.
        await sleep(Math.min(60_000, Math.max(backoff + jitter, retryAfter)));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    this.log.error(`[databricks] export failed for session ${session.id}: ${message}`);
    await this.status.set(session.id, "failed", message);
    return "failed";
  }

  private async uploadOnce(session: FinishedSession): Promise<void> {
    const paths = volumePaths(session, this.config.volumePath);
    const joints = buildJointsFile(session);
    const meta = Buffer.from(JSON.stringify(buildMetadata(session, this.config, paths.joints)));

    await this.putFile(paths.joints, joints);
    await this.putFile(paths.meta, meta);
  }

  private async putFile(volumeFilePath: string, body: Buffer): Promise<void> {
    const token = await this.getToken();
    const url = `${this.config.host}/api/2.0/fs/files${encodeURI(volumeFilePath)}?overwrite=true`;
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new HttpError(res.status, await res.text(), retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
  }

  private async getToken(): Promise<string> {
    // Refresh a minute early so a token never expires mid-upload.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.config.host}/oidc/v1/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: this.config.scopes }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = json.access_token;
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.token;
  }
}
