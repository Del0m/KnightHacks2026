// CONN-05: score a finished set on the Databricks Model Serving endpoint during the rest timer.
//
// The endpoint serves spotter.ml.form_quality@champion (CONN-04) and returns, per rep,
// { quality: 0-1, label: "clean" | "partial_range" | ... }. Those are advice (INT-06): a rep is
// clean when the phone raised no rule flags for it, whatever the source, and the set's medal
// follows from that (Architecture §8, applied to one set):
//   gold   every rep clean
//   silver clean share >= the lifter's own baseline (4-week average, 70% for a first workout)
//   bronze otherwise
//
// Never throws and never blocks the rest timer: if the endpoint is slow (Free Edition endpoints
// scale to zero, so the first call after idle can take minutes), down, or misconfigured, it
// returns the phone's rule score instead (source: "phone"). A rep is clean there when the phone
// raised no form flags.
//
// Job fallback (if serving isn't available on Free Edition): the phone score is shown live,
// and the pipeline's gold_workout_medals (CONN-03) recomputes medals in batch afterwards.
//
// The frame-derived features (tempo split, symmetry, trunk lean, knee tracking) are computed
// here from the set's joints, the same way the pipeline computes them for training (features.ts).
// Endpoint setup: databricks/notebooks/serving_endpoint.py, runbook docs/runbooks/set-scoring.md.

import type { Flag, JointFrame, Rep } from "../../../../../specs/set-record/types.js";
export type { Medal } from "../../../../../specs/set-record/types.js";
import type { Medal } from "../../../../../specs/set-record/types.js";
import type { Env } from "../../env.js";
import { repFeatures } from "./features.js";

// ---- Input / output ----

// A rep of the AI-08 set record. Boundaries are optional: without them the model gets null
// features for that rep, which it handles.
export type ScoreRep = Pick<Rep, "range_deg" | "tempo_ms"> &
  Partial<Pick<Rep, "start_ms" | "end_ms" | "quality">> & {
    flags: Pick<Flag, "rule_id">[]; // the phone's rule result
  };

export interface ScoreSetInput {
  exercise_id: string;
  weight_kg: number | null;
  reps: ScoreRep[];
  frames?: JointFrame[]; // the set's joints, on the same clock as the rep boundaries
  baseline_share?: number | null; // lifter's 4-week clean share; defaults to the beginner baseline
}

export interface SetScore {
  source: "databricks" | "phone";
  medal: Medal;
  clean_share: number;
  reps: { quality: number | null; label: string; clean: boolean }[];
  latency_ms: number;
  fallback_reason?: string;
}

export const BEGINNER_BASELINE = 0.7;

// ---- Config ----

export interface ScoreConfig {
  host: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  endpoint: string;
  timeoutMs: number; // whole budget: token (if not cached) + invocation
}

type ScoreEnv = Pick<
  Env,
  | "DATABRICKS_HOST"
  | "DATABRICKS_CLIENT_ID"
  | "DATABRICKS_CLIENT_SECRET"
  | "DATABRICKS_OAUTH_SCOPES"
  | "DATABRICKS_SERVING_ENDPOINT"
  | "DATABRICKS_SCORE_TIMEOUT_MS"
>;

export function scoreConfigFromEnv(env: ScoreEnv): ScoreConfig {
  const required = ["DATABRICKS_HOST", "DATABRICKS_CLIENT_ID", "DATABRICKS_CLIENT_SECRET"] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing env for Databricks scoring: ${missing.join(", ")}`);

  return {
    host: env.DATABRICKS_HOST!.replace(/\/+$/, ""),
    clientId: env.DATABRICKS_CLIENT_ID!,
    clientSecret: env.DATABRICKS_CLIENT_SECRET!,
    scopes: env.DATABRICKS_OAUTH_SCOPES || "all-apis",
    endpoint: env.DATABRICKS_SERVING_ENDPOINT || "form-quality",
    timeoutMs: Number(env.DATABRICKS_SCORE_TIMEOUT_MS) || 1200,
  };
}

// ---- Medal ----

export function pickMedal(cleanFlags: boolean[], baseline: number): { medal: Medal; clean_share: number } {
  const total = cleanFlags.length;
  const clean = cleanFlags.filter(Boolean).length;
  const clean_share = total ? clean / total : 0;
  if (total > 0 && clean === total) return { medal: "gold", clean_share };
  // Rounded so "matched the average" isn't lost to float error (same as gold_workout_medals).
  if (Math.round(clean_share * 1e4) >= Math.round(baseline * 1e4)) return { medal: "silver", clean_share };
  return { medal: "bronze", clean_share };
}

export function phoneScore(input: ScoreSetInput, startedAt: number, reason: string): SetScore {
  const reps = input.reps.map((r) => {
    const clean = r.flags.length === 0;
    return { quality: r.quality ?? null, label: clean ? "clean" : "flagged", clean };
  });
  const baseline = input.baseline_share ?? BEGINNER_BASELINE;
  return {
    source: "phone",
    ...pickMedal(
      reps.map((r) => r.clean),
      baseline,
    ),
    reps,
    latency_ms: Date.now() - startedAt,
    fallback_reason: reason,
  };
}

// ---- Client ----

// Console or pino: both take a plain message.
export interface LogLike {
  warn(msg: string): void;
}

export class DatabricksScorer {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: ScoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: LogLike = console,
  ) {}

  /** Scores a set on Databricks, or falls back to the phone's rule score. Never throws. */
  async scoreSet(input: ScoreSetInput): Promise<SetScore> {
    const startedAt = Date.now();
    if (input.reps.length === 0) return phoneScore(input, startedAt, "no reps");

    const signal = AbortSignal.timeout(this.config.timeoutMs);
    try {
      const predictions = await this.invoke(input, signal);
      if (predictions.length !== input.reps.length) {
        throw new Error(`expected ${input.reps.length} predictions, got ${predictions.length}`);
      }
      // INT-06: the rule flags decide clean (and so the medal); the model's quality and label are advice.
      const reps = predictions.map((p, i) => ({
        quality: p.quality,
        label: p.label,
        clean: input.reps[i]!.flags.length === 0,
      }));
      return {
        source: "databricks",
        ...pickMedal(
          reps.map((r) => r.clean),
          input.baseline_share ?? BEGINNER_BASELINE,
        ),
        reps,
        latency_ms: Date.now() - startedAt,
      };
    } catch (err) {
      const reason = signal.aborted
        ? `timed out after ${this.config.timeoutMs} ms`
        : err instanceof Error
          ? err.message
          : String(err);
      if (/HTTP 401|HTTP 403/.test(reason)) this.token = null;
      this.log.warn(`[databricks] scoring fell back to phone score: ${reason}`);
      return phoneScore(input, startedAt, reason);
    }
  }

  private async invoke(input: ScoreSetInput, signal: AbortSignal) {
    const token = await this.getToken(signal);
    // Column names match the model signature in databricks/notebooks/form_model.py.
    const features = repFeatures(input.exercise_id, input.reps, input.frames);
    const records = input.reps.map((r, i) => ({
      exercise_id: input.exercise_id,
      weight_kg: input.weight_kg,
      range_deg: r.range_deg,
      tempo_ms: r.tempo_ms,
      ...features[i]!,
    }));

    const res = await this.fetchImpl(
      `${this.config.host}/serving-endpoints/${encodeURIComponent(this.config.endpoint)}/invocations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dataframe_records: records }),
        signal,
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    return parsePredictions(await res.json());
  }

  private async getToken(signal: AbortSignal): Promise<string> {
    // Refresh a minute early so a token never expires mid-request.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.config.host}/oidc/v1/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: this.config.scopes }),
      signal,
    });
    if (!res.ok) throw new Error(`token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = json.access_token;
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.token;
  }
}

// Serving returns { predictions: [{quality, label}, ...] } for a DataFrame output; accept the
// column-oriented form too ({ predictions: { quality: [...], label: [...] } }).
export function parsePredictions(body: unknown): { quality: number | null; label: string }[] {
  const p = (body as { predictions?: unknown })?.predictions;
  const rows = Array.isArray(p)
    ? p
    : p && typeof p === "object" && Array.isArray((p as { label?: unknown }).label)
      ? (p as { label: unknown[]; quality?: unknown[] }).label.map((label, i) => ({
          label,
          quality: (p as { quality?: unknown[] }).quality?.[i],
        }))
      : null;
  if (!rows) throw new Error("unexpected response shape from serving endpoint");

  return rows.map((row) => {
    const { quality, label } = (row ?? {}) as { quality?: unknown; label?: unknown };
    if (typeof label !== "string") throw new Error("prediction missing label");
    return { quality: typeof quality === "number" ? quality : null, label };
  });
}
