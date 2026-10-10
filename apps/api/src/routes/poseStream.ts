// CONN-11: WebSocket relay for cloud pose mode (Architecture §4.1, §14).
//
// The phone never talks to Hugging Face: it streams frames here with its Neon Auth token, and
// the API forwards each frame to the pose endpoint with the server's HF token.
//
//   GET /pose/stream  (WebSocket upgrade)
//   auth: "Authorization: Bearer <token>" header, or ?token=<token> where headers can't be set
//
// Phone -> API, one binary message per frame:
//   bytes 0-7   timestamp_ms, float64 big-endian (Date.now() when the frame was captured)
//   bytes 8-    JPEG, ~320 px on the long side, upright and unmirrored (rotate before sending)
//
// API -> phone, JSON text messages:
//   {"type":"ready"}
//   {"type":"pose","timestamp_ms":..,"result":{..}|null,"latency_ms":..,"endpoint_ms":..,"dropped":n}
//   {"type":"status","status":"warming"}   endpoint is scaling up from zero; show "reconnecting"
//   {"type":"error","message":".."}
//
// Backpressure: one frame in flight per connection. A frame that arrives meanwhile replaces any
// frame still waiting, so results are always for the newest frame and nothing queues up (same as
// on-device mode); `dropped` is the number of frames skipped since the previous pose message. Frames live only in memory and are never
// logged or written anywhere.

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { VerifyToken } from "../middleware/auth.js";
import type { PoseEndpointClient } from "../integrations/huggingface/poseEndpoint.js";

export const POSE_STREAM_PATH = "/pose/stream";
const HEADER_BYTES = 8;
const MAX_FRAME_BYTES = 512 * 1024;
const WARMING_BACKOFF_MS = 2000; // while the endpoint starts, forward at most one frame per 2 s

export interface LogLike {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface PoseStreamDeps {
  verifyToken: VerifyToken;
  endpoint: Pick<PoseEndpointClient, "detect">;
  log?: LogLike;
}

interface Frame {
  timestampMs: number;
  jpeg: Buffer;
}

function tokenFrom(req: IncomingMessage): string | null {
  const header = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (header) return header[1]!.trim();
  const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
  return query || null;
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function parseFrame(data: RawData, isBinary: boolean): Frame | string {
  if (!isBinary) return "send frames as binary messages: 8-byte timestamp then JPEG";
  const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
  if (buf.length <= HEADER_BYTES) return "frame is missing its JPEG";
  const timestampMs = buf.readDoubleBE(0);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "frame timestamp is invalid";
  const jpeg = buf.subarray(HEADER_BYTES);
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return "frame is not a JPEG";
  return { timestampMs, jpeg };
}

function relay(ws: WebSocket, userId: string, deps: PoseStreamDeps): void {
  let inFlight = false;
  let pending: Frame | null = null;
  let dropped = 0;
  let warmingUntil = 0;
  let closed = false;

  const send = (msg: object) => {
    if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const process = async (frame: Frame): Promise<void> => {
    inFlight = true;
    const reply = await deps.endpoint.detect(frame.jpeg, frame.timestampMs);
    if (reply.status === "ok") {
      send({
        type: "pose",
        timestamp_ms: frame.timestampMs,
        result: reply.result,
        latency_ms: reply.latencyMs,
        endpoint_ms: reply.endpointMs,
        dropped,
      });
      dropped = 0;
    } else if (reply.status === "warming") {
      warmingUntil = Date.now() + WARMING_BACKOFF_MS;
      send({ type: "status", status: "warming" });
    } else {
      send({ type: "error", message: reply.message });
    }
    inFlight = false;
    const next = pending;
    pending = null;
    if (next && !closed) void process(next);
  };

  ws.on("message", (data, isBinary) => {
    const frame = parseFrame(data, isBinary);
    if (typeof frame === "string") {
      send({ type: "error", message: frame });
      return;
    }
    if (Date.now() < warmingUntil) {
      dropped++; // don't hammer an endpoint that is still starting
      return;
    }
    if (inFlight) {
      if (pending) dropped++;
      pending = frame; // newest frame wins
      return;
    }
    void process(frame);
  });

  ws.on("close", () => {
    closed = true;
    pending = null;
    deps.log?.info(`[pose-stream] user ${userId} disconnected`);
  });

  deps.log?.info(`[pose-stream] user ${userId} connected`);
  send({ type: "ready" });
}

/** Serves cloud pose mode on the HTTP server at /pose/stream. Returns a function that closes it. */
export function attachPoseStream(server: Server, deps: PoseStreamDeps): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: HEADER_BYTES + MAX_FRAME_BYTES });

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // The only WebSocket route; anything else would otherwise hang until it times out.
    if (new URL(req.url ?? "/", "http://localhost").pathname !== POSE_STREAM_PATH) {
      return reject(socket, 404, "Not Found");
    }
    const token = tokenFrom(req);
    if (!token) return reject(socket, 401, "Unauthorized");
    let userId: string;
    try {
      userId = (await deps.verifyToken(token)).id;
    } catch {
      return reject(socket, 401, "Unauthorized");
    }
    wss.handleUpgrade(req, socket, head, (ws) => relay(ws, userId, deps));
  };

  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    for (const client of wss.clients) client.close(1001, "server shutting down");
    wss.close();
  };
}
