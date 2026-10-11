// CONN-11: client for the cloud pose endpoint (ml/cloud_endpoint/handler.py on HF Inference
// Endpoints). One frame per request; the WebSocket relay in routes/poseStream.ts streams them.
//
// The endpoint scales to zero when idle. While a replica starts (a few minutes) the HF proxy
// answers 503, which comes back here as { status: "warming" } so the phone can show its quiet
// "reconnecting" state instead of an error. Frames are only held in memory for the request.

import type { Env } from "../../env.js";

export interface Joint {
  x: number;
  y: number;
  c: number;
}

// docs/pose/pose-result-contract.md
export interface PoseResult {
  source: string;
  model: string;
  timestamp_ms: number;
  score: number;
  joints: Joint[];
}

export type PoseReply =
  | { status: "ok"; result: PoseResult | null; latencyMs: number; endpointMs: number }
  | { status: "warming" }
  | { status: "error"; message: string };

export interface PoseEndpointConfig {
  url: string; // the endpoint's URL from its HF page
  token: string; // HF token with access to the endpoint; never sent to the phone
  timeoutMs: number;
}

type PoseEnv = Pick<Env, "POSE_ENDPOINT_URL" | "HF_TOKEN" | "POSE_ENDPOINT_TIMEOUT_MS">;

/** From the validated env (src/env.ts); scripts can pass process.env. */
export function poseEndpointConfigFromEnv(env: PoseEnv = process.env): PoseEndpointConfig | null {
  if (!env.POSE_ENDPOINT_URL || !env.HF_TOKEN) return null;
  return {
    url: env.POSE_ENDPOINT_URL,
    token: env.HF_TOKEN,
    timeoutMs: Number(env.POSE_ENDPOINT_TIMEOUT_MS) || 2000,
  };
}

function isPoseResult(value: unknown): value is PoseResult {
  const r = value as PoseResult;
  return (
    !!r &&
    typeof r.score === "number" &&
    Array.isArray(r.joints) &&
    r.joints.length === 17 &&
    r.joints.every((j) => typeof j?.x === "number" && typeof j?.y === "number" && typeof j?.c === "number")
  );
}

export class PoseEndpointClient {
  constructor(
    private readonly config: PoseEndpointConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Runs pose detection on one JPEG frame. Never throws. */
  async detect(jpeg: Buffer, timestampMs: number): Promise<PoseReply> {
    const started = Date.now();
    try {
      const res = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ inputs: jpeg.toString("base64"), parameters: { timestamp_ms: timestampMs } }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (res.status === 503) return { status: "warming" };
      if (!res.ok) return { status: "error", message: `endpoint HTTP ${res.status}` };

      const body = (await res.json()) as { result?: unknown; latency_ms?: unknown };
      if (body.result !== null && !isPoseResult(body.result)) {
        return { status: "error", message: "endpoint returned an unexpected pose result" };
      }
      return {
        status: "ok",
        result: body.result,
        latencyMs: Date.now() - started,
        endpointMs: typeof body.latency_ms === "number" ? body.latency_ms : 0,
      };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return { status: "error", message: timedOut ? `timed out after ${this.config.timeoutMs} ms` : "endpoint unreachable" };
    }
  }
}
