// Cloud pose client (AI-17, Architecture §4.1): streams camera frames to the SteadyForum API's
// /pose/stream relay (CONN-11) and turns its replies into the same PoseDetection the on-device
// detectors produce. The protocol is in apps/api/src/routes/poseStream.ts:
//
//   phone -> API   one binary message per frame: 8-byte big-endian float64 timestamp_ms, then a
//                  JPEG ~320 px on the long side, upright and unmirrored
//   API -> phone   JSON: ready | pose | status "warming" | error
//
// One frame is in flight at a time plus one pending frame; the newest pending frame wins, as on the
// relay. A reply counts only for the in-flight frame on the current socket, and only while fresh.
// The socket authenticates with the Neon Auth token (never the Hugging Face token, which stays on
// the server). Frames live only in memory: nothing here stores or logs them.
import type { PoseDetection, PoseResult } from './types';

const HEADER_BYTES = 8;
/** Delay before each reconnect; the last one repeats. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
/** The relay drops frames for this long after a warming reply (WARMING_BACKOFF_MS); probe no faster. */
const WARMING_PROBE_MS = 2000;
/** No `ready` by then is a connect failure. */
const CONNECT_TIMEOUT_MS = 5000;
/** No reply to a transmitted frame by then is a timeout, so a lost reply can't stall the stream. */
const RESULT_TIMEOUT_MS = 5000;
/** A reply for a frame captured longer ago than this is stale. */
const MAX_AGE_MS = 1000;

/** `tracking` once the relay said ready; `reconnecting` while warming up or after a failure. */
export type CloudStatus = 'connecting' | 'tracking' | 'reconnecting' | 'stopped';
export type CloudFailure = 'warming' | 'connect' | 'inference' | 'timeout' | 'stale';
/** Frames dropped since the last reply: replaced here while pending, and skipped by the relay. */
export interface CloudDrops { replaced: number; relay: number }

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'pose'; timestamp_ms: number; result: PoseResult | null; latency_ms: number; endpoint_ms: number; dropped: number }
  | { type: 'status'; status: 'warming' }
  | { type: 'error'; message: string };

/** What the client needs from a WebSocket; the real one and test fakes both fit. */
export interface SocketLike {
  binaryType?: string;
  readyState: number;
  send(data: ArrayBuffer): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
}

export type CreateSocket = (url: string, token: string) => SocketLike;

const OPEN = 1;

/** One frame as the relay expects it: the capture time, then the JPEG bytes. */
export function encodeFrame(timestampMs: number, jpeg: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(HEADER_BYTES + jpeg.byteLength);
  new DataView(out).setFloat64(0, timestampMs, false); // big-endian
  new Uint8Array(out, HEADER_BYTES).set(new Uint8Array(jpeg));
  return out;
}

function isJoint(j: unknown): boolean {
  const x = j as { x?: unknown; y?: unknown; c?: unknown };
  return !!x && typeof x.x === 'number' && typeof x.y === 'number' && typeof x.c === 'number';
}

function isPoseResult(r: unknown): r is PoseResult {
  const x = r as PoseResult;
  return !!x && typeof x.model === 'string' && typeof x.timestamp_ms === 'number' && typeof x.score === 'number'
    && Array.isArray(x.joints) && x.joints.length === 17 && x.joints.every(isJoint);
}

/** A relay message, or null for anything malformed (ignored, never thrown). */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(data); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'status':
      return m.status === 'warming' ? { type: 'status', status: 'warming' } : null;
    case 'error':
      return { type: 'error', message: typeof m.message === 'string' ? m.message : 'pose endpoint error' };
    case 'pose':
      if (typeof m.timestamp_ms !== 'number' || (m.result !== null && !isPoseResult(m.result))) return null;
      return {
        type: 'pose',
        timestamp_ms: m.timestamp_ms,
        result: m.result as PoseResult | null,
        latency_ms: typeof m.latency_ms === 'number' ? m.latency_ms : 0,
        endpoint_ms: typeof m.endpoint_ms === 'number' ? m.endpoint_ms : 0,
        dropped: typeof m.dropped === 'number' ? m.dropped : 0,
      };
    default:
      return null;
  }
}

/** The API's base URL turned into the relay's WebSocket URL: https -> wss, http -> ws. */
export function poseStreamUrl(apiUrl: string): string {
  const url = new URL(apiUrl.replace(/\/$/, '') + '/pose/stream');
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else throw new Error('The API URL must be http(s).');
  return url.toString();
}

/** React Native's WebSocket can set headers, so the token goes in Authorization, not the URL. */
export const nativeSocket: CreateSocket = (url, token) => {
  const Ws = WebSocket as unknown as new (url: string, protocols?: string[] | null, options?: { headers: Record<string, string> }) => SocketLike;
  return new Ws(url, null, { headers: { Authorization: `Bearer ${token}` } });
};

export interface CloudPoseOptions {
  url: string;
  getToken: () => Promise<string | null>;
  onPose: (d: PoseDetection, drops: CloudDrops) => void;
  onStatus?: (status: CloudStatus) => void;
  /** True once the relay is ready; false after a failure or a drop. */
  onAvailability?: (available: boolean) => void;
  onFailure?: (kind: CloudFailure) => void;
  createSocket?: CreateSocket;
}

type Frame = { ts: number; jpeg: ArrayBuffer };

/**
 * The phone side of the relay. `send` a frame whenever the camera has one; it goes out at once
 * if nothing is in flight, else it waits (replacing any older waiting frame) until the reply.
 * Each connection attempt is a generation: callbacks from an older one do nothing.
 */
export class CloudPoseClient {
  private gen = 0;
  private socket: SocketLike | null = null;
  private ready = false; // the relay said ready on this socket
  private available = false;
  private warming = false;
  private inFlight: number | null = null; // timestamp of the frame awaiting its reply
  private answered: number | null = null;
  private pending: Frame | null = null;
  private lastSentAt = 0;
  private attempt = 0;
  private replaced = 0;
  private relay = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private status: CloudStatus | null = null;

  constructor(private readonly opts: CloudPoseOptions) {}

  start(): void {
    if (this.closed) return;
    this.setStatus('connecting');
    void this.connect();
  }

  /** Queues one JPEG captured at `timestampMs`; sent now if nothing is in flight. */
  send(timestampMs: number, jpeg: ArrayBuffer): void {
    if (this.closed) return;
    const frame = { ts: timestampMs, jpeg };
    if (this.warming) {
      // The relay is starting up: one probe every 2 s, everything in between is discarded.
      if (this.ready && this.inFlight == null && Date.now() - this.lastSentAt >= WARMING_PROBE_MS) this.transmit(frame);
      return;
    }
    if (this.pending) this.replaced += 1;
    this.pending = frame;
    this.flush();
  }

  /** Final: stops the socket, timers and any token request; later callbacks do nothing. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.drop();
    this.setStatus('stopped');
  }

  private setStatus(status: CloudStatus) {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus?.(status);
  }

  private setAvailable(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    this.opts.onAvailability?.(available);
  }

  /** A timer that only fires for the generation that set it. */
  private after(ms: number, fn: () => void) {
    const gen = this.gen;
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.closed && gen === this.gen) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private async connect(): Promise<void> {
    const gen = ++this.gen;
    let token: string | null;
    try { token = await this.opts.getToken(); } catch { token = null; }
    if (this.closed || gen !== this.gen) return;
    if (!token) { this.fail('connect'); return; }

    let socket: SocketLike;
    try { socket = (this.opts.createSocket ?? nativeSocket)(this.opts.url, token); } catch { this.fail('connect'); return; }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const live = () => !this.closed && gen === this.gen && this.socket === socket;
    socket.onmessage = (e) => { if (live()) this.onMessage(parseServerMessage(e.data)); };
    // Error and close usually both fire; the first ends this generation, so the second does nothing.
    socket.onerror = socket.onclose = () => { if (live()) this.fail(this.ready ? null : 'connect'); };
    this.after(CONNECT_TIMEOUT_MS, () => { if (!this.ready) this.fail('connect'); });
  }

  private onMessage(m: ServerMessage | null) {
    if (!m) return;
    if (m.type === 'ready') {
      if (this.ready) return;
      this.ready = true;
      this.setStatus('tracking');
      this.setAvailable(true);
      this.flush();
    } else if (m.type === 'status') {
      // The endpoint is scaling up from zero: this answers the in-flight frame, and the relay
      // drops (never answers) whatever arrives in the next 2 s.
      this.settle();
      this.warming = true;
      this.pending = null;
      this.lastSentAt = Date.now(); // the relay's hold starts at its reply, not at our send
      this.failure('warming');
    } else if (m.type === 'error') {
      this.fail('inference');
    } else {
      if (this.inFlight == null || m.timestamp_ms !== this.inFlight || m.timestamp_ms === this.answered) return;
      this.settle();
      this.answered = m.timestamp_ms;
      this.relay += m.dropped;
      if (Date.now() - m.timestamp_ms > MAX_AGE_MS) {
        this.failure('stale');
      } else {
        this.attempt = 0;
        this.warming = false;
        this.setStatus('tracking');
        this.setAvailable(true);
        const drops = { replaced: this.replaced, relay: this.relay };
        this.replaced = this.relay = 0;
        const result = m.result ? { ...m.result, source: 'cloud' as const } : undefined;
        this.opts.onPose({ result, latencyMs: m.latency_ms, timestampMs: m.timestamp_ms }, drops);
      }
      this.flush();
    }
  }

  /** The in-flight frame got its reply. */
  private settle() {
    this.inFlight = null;
    if (this.resultTimer != null) { clearTimeout(this.resultTimer); this.timers.delete(this.resultTimer); }
    this.resultTimer = null;
  }

  private flush() {
    const next = this.pending;
    if (!next || this.warming || this.inFlight != null || !this.ready) return;
    this.pending = null;
    this.transmit(next);
  }

  private transmit(frame: Frame) {
    if (this.socket?.readyState !== OPEN) return;
    this.inFlight = frame.ts;
    this.lastSentAt = Date.now();
    this.socket.send(encodeFrame(frame.ts, frame.jpeg));
    this.resultTimer = this.after(RESULT_TIMEOUT_MS, () => this.fail('timeout'));
  }

  /** A failure that keeps the socket: not tracking until a fresh reply. */
  private failure(kind: CloudFailure) {
    this.setStatus('reconnecting');
    this.setAvailable(false);
    this.opts.onFailure?.(kind);
  }

  /** Ends this generation: socket, timers and frames. */
  private drop() {
    this.gen += 1;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.resultTimer = null;
    this.inFlight = null;
    this.pending = null;
    this.ready = false;
    this.warming = false;
    const s = this.socket;
    this.socket = null;
    s?.close();
  }

  /** Closes the socket and reconnects after the backoff. `null`: a drop after ready, not a failure. */
  private fail(kind: CloudFailure | null) {
    if (this.closed) return;
    this.drop();
    this.setStatus('reconnecting');
    this.setAvailable(false);
    if (kind) this.opts.onFailure?.(kind);
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.after(delay, () => void this.connect());
  }
}
