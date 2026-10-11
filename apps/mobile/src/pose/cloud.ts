// Cloud pose client (AI-17, Architecture §4.1): streams camera frames to the SteadyForum API's
// /pose/stream relay (CONN-11) and turns its replies into the same PoseDetection the on-device
// detectors produce. The protocol is in apps/api/src/routes/poseStream.ts:
//
//   phone -> API   one binary message per frame: 8-byte big-endian float64 timestamp_ms, then a
//                  JPEG ~320 px on the long side, upright and unmirrored
//   API -> phone   JSON: ready | pose | status "warming" | error
//
// One frame is in flight at a time; a newer frame replaces one still waiting, as on the relay.
// The socket authenticates with the Neon Auth token (never the Hugging Face token, which stays on
// the server). Frames live only in memory: nothing here stores or logs them.
import type { PoseDetection, PoseResult } from './types';

const HEADER_BYTES = 8;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
/** The relay silently drops frames for this long after a warming reply (WARMING_BACKOFF_MS). */
const WARMING_HOLD_MS = 2000;
/** A frame with no reply by then is given up on, so a lost reply can't stall the stream. */
const IN_FLIGHT_TIMEOUT_MS = 8000;

/** `live` once the relay said ready; `reconnecting` while warming up or after a drop. */
export type CloudState = 'connecting' | 'live' | 'reconnecting' | 'closed';

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
  onPose: (d: PoseDetection, dropped: number) => void;
  onState?: (state: CloudState, error: string | null) => void;
  createSocket?: CreateSocket;
  /** Reconnect delays; the last one repeats. */
  backoffMs?: number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  now?: () => number;
}

/**
 * The phone side of the relay. `send` a frame whenever the camera has one; it goes out at once
 * if nothing is in flight, else it waits (replacing any older waiting frame) until the reply.
 */
export class CloudPoseClient {
  private socket: SocketLike | null = null;
  private ready = false; // the relay said ready on this socket
  private inFlight = false;
  private waiting: ArrayBuffer | null = null;
  private holdUntil = 0; // after a warming reply, frames sent before this are dropped by the relay
  private attempt = 0;
  private timer: unknown = null; // reconnect
  private holdTimer: unknown = null; // flush when the warming hold ends
  private watchdog: unknown = null; // in-flight frame with no reply
  private closed = false;
  private state: CloudState = 'connecting';

  private now() { return (this.opts.now ?? Date.now)(); }
  private schedule(fn: () => void, ms: number) { return (this.opts.setTimer ?? setTimeout)(fn, ms); }
  private cancel(id: unknown) { if (id != null) (this.opts.clearTimer ?? clearTimeout)(id as ReturnType<typeof setTimeout>); }

  constructor(private readonly opts: CloudPoseOptions) {}

  start(): void {
    this.closed = false;
    void this.connect();
  }

  /** Queues one encoded frame (from `encodeFrame`); sent now if nothing is in flight. */
  send(frame: ArrayBuffer): void {
    if (this.closed) return;
    this.waiting = frame; // newest wins; an older waiting frame is dropped
    this.flush();
  }

  close(): void {
    this.closed = true;
    this.waiting = null;
    for (const id of [this.timer, this.holdTimer, this.watchdog]) this.cancel(id);
    this.timer = this.holdTimer = this.watchdog = null;
    const s = this.socket;
    this.socket = null;
    if (s) { s.onclose = null; s.close(); }
    this.setState('closed', null);
  }

  private setState(state: CloudState, error: string | null) {
    this.state = state;
    this.opts.onState?.(state, error);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    let token: string | null;
    try { token = await this.opts.getToken(); } catch { token = null; }
    if (this.closed) return;
    if (!token) { this.retry('Please log in to use cloud mode.'); return; }

    const socket = (this.opts.createSocket ?? nativeSocket)(this.opts.url, token);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.ready = false;
    this.settle();
    socket.onmessage = (e) => this.onMessage(parseServerMessage(e.data));
    socket.onerror = () => {}; // onclose follows and reconnects
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.retry(this.state === 'live' ? 'Connection to the pose service dropped.' : 'Could not reach the pose service.');
    };
  }

  private onMessage(m: ServerMessage | null) {
    if (!m) return;
    if (m.type === 'ready') {
      this.attempt = 0;
      this.ready = true;
      this.setState('live', null);
      this.flush();
    } else if (m.type === 'status') {
      // The endpoint is scaling up from zero. Show "reconnecting", and hold the next frame until
      // the relay's back-off ends, since it drops (and never answers) frames sent before then.
      this.settle();
      this.holdUntil = this.now() + WARMING_HOLD_MS;
      this.setState('reconnecting', null);
      this.cancel(this.holdTimer);
      this.holdTimer = this.schedule(() => { this.holdTimer = null; this.flush(); }, WARMING_HOLD_MS);
    } else if (m.type === 'pose') {
      if (this.state !== 'live') this.setState('live', null);
      this.settle();
      const result = m.result ? { ...m.result, source: 'cloud' as const } : undefined;
      this.opts.onPose({ result, latencyMs: m.latency_ms }, m.dropped);
      this.flush();
    } else {
      // A relay error ends this socket; reconnect from scratch.
      const s = this.socket;
      this.socket = null;
      if (s) { s.onclose = null; s.close(); }
      this.retry(m.message);
    }
  }

  /** The in-flight frame got its reply (or is given up on). */
  private settle() {
    this.inFlight = false;
    this.cancel(this.watchdog);
    this.watchdog = null;
  }

  private flush() {
    const next = this.waiting;
    if (!next || this.inFlight || !this.ready || this.socket?.readyState !== OPEN || this.now() < this.holdUntil) return;
    this.waiting = null;
    this.inFlight = true;
    this.socket.send(next);
    this.watchdog = this.schedule(() => { this.watchdog = null; this.inFlight = false; this.flush(); }, IN_FLIGHT_TIMEOUT_MS);
  }

  private retry(error: string) {
    if (this.closed) return;
    this.ready = false;
    this.settle();
    this.setState('reconnecting', error);
    const delays = this.opts.backoffMs ?? BACKOFF_MS;
    const delay = delays[Math.min(this.attempt, delays.length - 1)]!;
    this.attempt += 1;
    this.timer = this.schedule(() => { this.timer = null; void this.connect(); }, delay);
  }
}

/**
 * Whether the relay accepts this user right now: opens a socket and waits for `ready` (or a
 * warming status, which also means it's there). Resolves false on close, error or timeout.
 */
export function probeCloud(url: string, token: string, timeoutMs = 5000, createSocket: CreateSocket = nativeSocket): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: SocketLike | null = null;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      const s = socket;
      socket = null;
      if (s) { s.onclose = null; s.onmessage = null; s.close(); }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { socket = createSocket(url, token); } catch { finish(false); return; }
    socket.onmessage = (e) => {
      const m = parseServerMessage(e.data);
      if (m?.type === 'ready' || m?.type === 'status') finish(true);
      else if (m?.type === 'error') finish(false);
    };
    socket.onerror = () => {};
    socket.onclose = () => finish(false);
  });
}
