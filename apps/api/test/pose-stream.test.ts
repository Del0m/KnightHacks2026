// CONN-11: the /pose/stream WebSocket relay on a real HTTP server with real JWT checks; only the
// HF endpoint is faked. Also the endpoint client's handling of HF responses.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PoseEndpointClient, type PoseReply } from "../src/integrations/huggingface/poseEndpoint.js";
import { attachPoseStream, POSE_STREAM_PATH } from "../src/routes/poseStream.js";
import { createKeys } from "./helpers.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const joints = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5, c: 0.9 }));

function frame(timestampMs: number, jpeg = JPEG): Buffer {
  const header = Buffer.alloc(8);
  header.writeDoubleBE(timestampMs);
  return Buffer.concat([header, jpeg]);
}

// Fake endpoint: records what it was asked, answers after `delayMs` with `reply`.
const endpoint = {
  calls: [] as number[],
  delayMs: 0,
  reply: (t: number): PoseReply => ({
    status: "ok",
    result: { source: "cloud", model: "yolov8n-pose-320", timestamp_ms: t, score: 0.9, joints },
    latencyMs: 12,
    endpointMs: 8,
  }),
  async detect(_jpeg: Buffer, t: number): Promise<PoseReply> {
    this.calls.push(t);
    await new Promise((r) => setTimeout(r, this.delayMs));
    return this.reply(t);
  },
};

let server: Server;
let url: string;
let keys: Awaited<ReturnType<typeof createKeys>>;
let stop: () => void;

beforeAll(async () => {
  keys = await createKeys();
  server = createServer((_req, res) => res.writeHead(404).end());
  stop = attachPoseStream(server, { verifyToken: keys.verify, endpoint });
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  stop();
  await new Promise((r) => server.close(r));
});

async function connect(opts: { token?: string; viaQuery?: boolean; path?: string } = {}) {
  const token = opts.token ?? (await keys.sign("cloud-user"));
  const path = opts.path ?? POSE_STREAM_PATH;
  const ws = opts.viaQuery
    ? new WebSocket(`${url}${path}?token=${encodeURIComponent(token)}`)
    : new WebSocket(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const messages: Record<string, unknown>[] = [];
  ws.on("message", (m) => messages.push(JSON.parse(m.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
  const waitFor = async (n: number) => {
    for (let i = 0; i < 200 && messages.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    return messages;
  };
  return { ws, messages, waitFor };
}

describe("pose stream relay", () => {
  it("rejects connections without a valid token or on other paths", async () => {
    await expect(connect({ token: "" })).rejects.toThrow("HTTP 401");
    await expect(connect({ token: "not-a-jwt" })).rejects.toThrow("HTTP 401");
    await expect(connect({ token: await keys.sign("u", { issuer: "https://evil" }) })).rejects.toThrow(
      "HTTP 401",
    );
    await expect(connect({ path: "/somewhere-else" })).rejects.toThrow("HTTP 404");
  });

  it("returns the endpoint's pose result for a frame, with the header or ?token=", async () => {
    for (const viaQuery of [false, true]) {
      endpoint.calls = [];
      const { ws, waitFor } = await connect({ viaQuery });
      ws.send(frame(1_739_000_000_000));
      const [ready, pose] = await waitFor(2);
      expect(ready).toEqual({ type: "ready" });
      expect(pose).toMatchObject({ type: "pose", timestamp_ms: 1_739_000_000_000, dropped: 0 });
      expect((pose as { result: { joints: unknown[] } }).result.joints).toHaveLength(17);
      ws.close();
    }
  });

  it("keeps one frame in flight and answers the newest, dropping the ones in between", async () => {
    endpoint.calls = [];
    endpoint.delayMs = 150;
    const { ws, waitFor } = await connect();
    for (let t = 1; t <= 5; t++) ws.send(frame(t)); // 5 frames arrive while frame 1 is in flight
    const messages = await waitFor(3);
    expect(endpoint.calls).toEqual([1, 5]);
    // Frames 2-4 were skipped before frame 1's reply went out, so that reply reports them.
    expect(messages.slice(1)).toMatchObject([
      { type: "pose", timestamp_ms: 1, dropped: 3 },
      { type: "pose", timestamp_ms: 5, dropped: 0 },
    ]);
    endpoint.delayMs = 0;
    ws.close();
  });

  it("reports warming while the endpoint scales up, and backs off instead of hammering it", async () => {
    endpoint.calls = [];
    const original = endpoint.reply;
    endpoint.reply = () => ({ status: "warming" });
    const { ws, waitFor } = await connect();
    ws.send(frame(1));
    await waitFor(2);
    for (let t = 2; t <= 4; t++) ws.send(frame(t));
    await new Promise((r) => setTimeout(r, 100));
    expect(endpoint.calls).toEqual([1]); // frames during the back-off aren't forwarded
    const messages = await waitFor(2);
    expect(messages[1]).toEqual({ type: "status", status: "warming" });
    endpoint.reply = original;
    ws.close();
  });

  it("rejects frames that aren't timestamped JPEGs", async () => {
    const { ws, waitFor } = await connect();
    ws.send("hello");
    ws.send(frame(1, Buffer.from("PNG not jpeg")));
    ws.send(Buffer.from([1, 2, 3]));
    const messages = await waitFor(4);
    expect(messages.slice(1).map((m) => m.type)).toEqual(["error", "error", "error"]);
    ws.close();
  });
});

describe("pose endpoint client", () => {
  const config = { url: "https://pose.endpoints.huggingface.cloud", token: "hf_test", timeoutMs: 200 };
  const respond = (status: number, body?: unknown) =>
    (async () =>
      new Response(body === undefined ? "" : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("sends the frame as base64 with the server token, and parses the result", async () => {
    let sent: {
      headers: Record<string, string>;
      body: { inputs: string; parameters: { timestamp_ms: number } };
    } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return new Response(
        JSON.stringify({
          result: { source: "cloud", model: "m", timestamp_ms: 7, score: 0.8, joints },
          latency_ms: 9.5,
        }),
      );
    }) as unknown as typeof fetch;
    const reply = await new PoseEndpointClient(config, fake).detect(JPEG, 7);
    expect(reply).toMatchObject({ status: "ok", endpointMs: 9.5 });
    expect(sent!.headers.Authorization).toBe("Bearer hf_test");
    expect(Buffer.from(sent!.body.inputs, "base64")).toEqual(JPEG);
    expect(sent!.body.parameters.timestamp_ms).toBe(7);
  });

  it("maps no person, scale-up, errors, bad output and timeouts", async () => {
    const detect = (f: typeof fetch) => new PoseEndpointClient(config, f).detect(JPEG, 1);
    expect(await detect(respond(200, { result: null, latency_ms: 5 }))).toMatchObject({
      status: "ok",
      result: null,
    });
    expect(await detect(respond(503))).toEqual({ status: "warming" });
    expect(await detect(respond(500))).toEqual({ status: "error", message: "endpoint HTTP 500" });
    expect(await detect(respond(200, { result: { joints: [] } }))).toMatchObject({ status: "error" });
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch;
    expect(await detect(hang)).toEqual({ status: "error", message: "timed out after 200 ms" });
  });
});
