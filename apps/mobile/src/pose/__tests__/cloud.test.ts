import {
  CloudPoseClient,
  encodeFrame,
  parseServerMessage,
  poseStreamUrl,
  type CloudDrops,
  type CloudFailure,
  type CloudStatus,
  type SocketLike,
} from '../cloud';
import type { PoseDetection } from '../types';

const T0 = 1_800_000_000_000;
const joints = Array.from({ length: 17 }, (_, i) => ({ x: i / 20, y: 0.5, c: 0.9 }));
const result = { source: 'coreml', model: 'yolov8n-pose-320', timestamp_ms: T0, score: 0.92, joints };

class FakeSocket implements SocketLike {
  binaryType?: string;
  readyState = 1;
  sent: ArrayBuffer[] = [];
  closed = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public url: string, public token: string) {}
  send(data: ArrayBuffer) { this.sent.push(data); }
  close() { this.closed += 1; this.readyState = 3; }
  // Server side
  reply(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  raw(data: unknown) { this.onmessage?.({ data }); }
  stamps() { return this.sent.map((f) => new DataView(f).getFloat64(0, false)); }
}

const jpeg = (marker: number) => new Uint8Array([0xff, 0xd8, marker]).buffer;
const pose = (timestamp_ms: number, extra: object = {}) =>
  ({ type: 'pose', timestamp_ms, result, latency_ms: 90, endpoint_ms: 10, dropped: 0, ...extra });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('frame packet', () => {
  it('is an 8-byte big-endian float64 timestamp followed by the JPEG bytes', () => {
    expect(Array.from(new Uint8Array(encodeFrame(1, jpeg(7)))))
      .toEqual([0x3f, 0xf0, 0, 0, 0, 0, 0, 0, 0xff, 0xd8, 7]);
    const frame = encodeFrame(1_791_682_526_428.5, jpeg(9));
    expect(frame.byteLength).toBe(11);
    expect(new DataView(frame).getFloat64(0, false)).toBe(1_791_682_526_428.5);
  });

  it('turns the API URL into the relay URL', () => {
    expect(poseStreamUrl('https://api.steadyforum.app/')).toBe('wss://api.steadyforum.app/pose/stream');
    expect(poseStreamUrl('http://localhost:3000')).toBe('ws://localhost:3000/pose/stream');
    expect(() => poseStreamUrl('ftp://x')).toThrow();
  });
});

describe('message parser', () => {
  it('reads each relay message and ignores anything malformed', () => {
    expect(parseServerMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseServerMessage('{"type":"status","status":"warming"}')).toEqual({ type: 'status', status: 'warming' });
    expect(parseServerMessage('{"type":"error","message":"boom"}')).toEqual({ type: 'error', message: 'boom' });
    expect(parseServerMessage(JSON.stringify(pose(5, { latency_ms: 80, dropped: 2 }))))
      .toMatchObject({ type: 'pose', timestamp_ms: 5, latency_ms: 80, dropped: 2 });
    expect(parseServerMessage(JSON.stringify({ type: 'pose', timestamp_ms: 5, result: null }))).toMatchObject({ result: null, dropped: 0 });

    for (const bad of ['not json', 'null', '{}', '{"type":"pose"}', '{"type":"status","status":"other"}', new ArrayBuffer(2),
      JSON.stringify(pose(5, { result: { ...result, joints: joints.slice(1) } }))]) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});

describe('CloudPoseClient', () => {
  let sockets: FakeSocket[];
  let statuses: CloudStatus[];
  let available: boolean[];
  let failures: CloudFailure[];
  let poses: [PoseDetection, CloudDrops][];
  let client: CloudPoseClient;
  let getToken: jest.Mock<Promise<string | null>, []>;

  function start() {
    client = new CloudPoseClient({
      url: 'wss://api.test/pose/stream',
      getToken,
      createSocket: (url, t) => { const s = new FakeSocket(url, t); sockets.push(s); return s; },
      onPose: (d, drops) => poses.push([d, drops]),
      onStatus: (s) => statuses.push(s),
      onAvailability: (a) => available.push(a),
      onFailure: (k) => failures.push(k),
    });
    client.start();
  }
  const socket = () => sockets.at(-1)!;
  async function connected() {
    await flush();
    socket().reply({ type: 'ready' });
  }
  /** Sends a frame captured now and returns its timestamp. */
  function send(marker = 1) {
    const ts = Date.now();
    client.send(ts, jpeg(marker));
    return ts;
  }
  async function advance(ms: number) { await jest.advanceTimersByTimeAsync(ms); await flush(); }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    sockets = []; statuses = []; available = []; failures = []; poses = [];
    getToken = jest.fn(async () => 'neon-jwt');
  });
  afterEach(() => { client.close(); jest.useRealTimers(); });

  it('connects with the token in the socket options, then tracks on ready', async () => {
    start();
    expect(statuses).toEqual(['connecting']);
    await connected();
    expect(socket().token).toBe('neon-jwt');
    expect(socket().url).not.toContain('neon-jwt');
    expect(socket().binaryType).toBe('arraybuffer');
    expect(statuses).toEqual(['connecting', 'tracking']);
    expect(available).toEqual([true]);
  });

  it('sends nothing before ready, then the exact packet', async () => {
    start();
    await flush();
    const ts = send(7);
    expect(socket().sent).toHaveLength(0);
    socket().reply({ type: 'ready' });
    expect(Array.from(new Uint8Array(socket().sent[0]!))).toEqual(Array.from(new Uint8Array(encodeFrame(ts, jpeg(7)))));
  });

  it('turns replies into detections: result null is no person, results are labelled cloud', async () => {
    start();
    await connected();
    let ts = send();
    socket().reply(pose(ts, { latency_ms: 95 }));
    expect(poses[0]![0]).toEqual({ result: { ...result, source: 'cloud' }, latencyMs: 95, timestampMs: ts });
    await advance(100);
    ts = send();
    socket().reply(pose(ts, { result: null }));
    expect(poses[1]![0]).toEqual({ result: undefined, latencyMs: 90, timestampMs: ts });
  });

  it('accepts only the reply to the in-flight frame, once; malformed, duplicate and obsolete replies are dropped', async () => {
    start();
    await connected();
    const a = send();
    socket().reply(pose(a - 100)); // obsolete
    socket().raw('{"type":"pose"'); // malformed
    socket().raw(new ArrayBuffer(4));
    expect(poses).toHaveLength(0);
    socket().reply(pose(a));
    socket().reply(pose(a)); // duplicate
    expect(poses).toHaveLength(1);
    await advance(100);
    const b = send();
    socket().reply(pose(a)); // duplicate of an answered frame
    expect(poses).toHaveLength(1);
    socket().reply(pose(b));
    expect(poses).toHaveLength(2);
    expect(failures).toEqual([]);
  });

  it('drops a reply more than 1 s old as stale and frees the in-flight slot', async () => {
    start();
    await connected();
    const a = send(1);
    await advance(1001);
    send(2);
    expect(socket().sent).toHaveLength(1);
    socket().reply(pose(a));
    expect(poses).toHaveLength(0);
    expect(failures).toEqual(['stale']);
    expect(socket().sent).toHaveLength(2); // the waiting frame went out
  });

  it('accepts a reply exactly 1 s old', async () => {
    start();
    await connected();
    const a = send();
    await advance(1000);
    socket().reply(pose(a));
    expect(poses).toHaveLength(1);
  });

  it('keeps one frame in flight and one pending; the newest pending frame wins and replacements count', async () => {
    start();
    await connected();
    const a = send(1);
    await advance(10); send(2);
    await advance(10); send(3);
    await advance(10); const d = send(4);
    await advance(900);
    expect(socket().sent).toHaveLength(1); // never a second transmission before the reply
    socket().reply(pose(a));
    expect(socket().stamps()).toEqual([a, d]);
    expect(poses[0]![1]).toEqual({ replaced: 2, relay: 0 });
    socket().reply(pose(d, { dropped: 3 }));
    expect(poses[1]![1]).toEqual({ replaced: 0, relay: 3 });
  });

  it('gives up after 5 s without ready and reconnects with a fresh token', async () => {
    start();
    await flush();
    await advance(4999);
    expect(failures).toEqual([]);
    await advance(1);
    expect(failures).toEqual(['connect']);
    expect(sockets[0]!.closed).toBe(1);
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(available).toEqual([]);
    await advance(500);
    expect(sockets).toHaveLength(2);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('times out a frame after 5 s without a reply and reconnects as a new generation', async () => {
    start();
    await connected();
    const a = send();
    await advance(4999);
    expect(failures).toEqual([]);
    await advance(1);
    expect(failures).toEqual(['timeout']);
    expect(sockets[0]!.closed).toBe(1);
    expect(available).toEqual([true, false]);
    expect(statuses.at(-1)).toBe('reconnecting');
    await advance(500);
    await connected();
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe('tracking');
    sockets[0]!.reply(pose(a)); // late reply on the old socket
    expect(poses).toHaveLength(0);
  });

  it('treats a relay error as an inference failure and reconnects', async () => {
    start();
    await connected();
    send();
    socket().reply({ type: 'error', message: 'endpoint returned HTTP 500' });
    expect(failures).toEqual(['inference']);
    expect(sockets[0]!.closed).toBe(1);
    expect(available).toEqual([true, false]);
    await advance(500);
    expect(sockets).toHaveLength(2);
  });

  it('waits 2 s from the warming reply before probing, matching the relay hold', async () => {
    start();
    await connected();
    send(1);
    await advance(800); // the endpoint took 800 ms to say it is warming
    const warmedAt = Date.now();
    socket().reply({ type: 'status', status: 'warming' });
    jest.setSystemTime(warmedAt + 1999); // 2.8 s after the send, but the relay still holds
    send(2);
    expect(socket().sent).toHaveLength(1);
    jest.setSystemTime(warmedAt + 2000);
    send(3);
    expect(socket().sent).toHaveLength(2);
  });

  it('while warming: reconnecting, pending frames discarded, at most one probe per 2 s after each warming reply', async () => {
    start();
    await connected();
    const a = send(1); // in flight
    await advance(10);
    send(2); // pending
    const w = Date.now();
    socket().reply({ type: 'status', status: 'warming' });
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(failures).toEqual(['warming']);
    expect(available).toEqual([true, false]);
    expect(socket().sent).toHaveLength(1); // pending frame discarded, not sent

    jest.setSystemTime(w + 1999);
    send(3);
    expect(socket().sent).toHaveLength(1);
    jest.setSystemTime(w + 2000);
    const probe = send(4);
    expect(socket().stamps()).toEqual([a, probe]);
    jest.setSystemTime(w + 2100);
    send(5); // probe in flight: discarded
    const w2 = Date.now();
    socket().reply({ type: 'status', status: 'warming' });
    expect(failures).toEqual(['warming', 'warming']);
    jest.setSystemTime(w2 + 1999);
    send(6);
    expect(socket().sent).toHaveLength(2);
    jest.setSystemTime(w2 + 2000);
    const probe2 = send(7);
    expect(socket().stamps()).toEqual([a, probe, probe2]);
    socket().reply(pose(probe2));
    expect(poses).toHaveLength(1);
    expect(poses[0]![1]).toEqual({ replaced: 0, relay: 0 });
    expect(statuses.at(-1)).toBe('tracking');
    expect(available).toEqual([true, false, true]);
    expect(sockets).toHaveLength(1);

    // Back to normal: frames queue again.
    await advance(100);
    const b = send(8);
    await advance(10);
    send(9);
    expect(socket().stamps()).toEqual([a, probe, probe2, b]);
  });

  it('handles an error followed by a close once', async () => {
    start();
    await flush();
    socket().onerror?.({});
    socket().onclose?.({});
    expect(failures).toEqual(['connect']);
    expect(statuses).toEqual(['connecting', 'reconnecting']);
    await advance(500);
    expect(sockets).toHaveLength(2);
    socket().reply({ type: 'ready' });
    socket().onerror?.({});
    socket().onclose?.({});
    expect(failures).toEqual(['connect']); // a drop after ready is not a connect failure
    expect(available).toEqual([true, false]);
    await advance(5000);
    expect(sockets).toHaveLength(3);
  });

  it('backs off 500, 1000, 2000, 4000, 8000, then 15000 ms repeating', async () => {
    const calls: number[] = [];
    getToken.mockImplementation(async () => { calls.push(Date.now()); return null; });
    start();
    await flush();
    for (const ms of [500, 1000, 2000, 4000, 8000, 15000, 15000]) await advance(ms);
    expect(calls.slice(1).map((t, i) => t - calls[i]!)).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
    expect(failures.every((f) => f === 'connect')).toBe(true);
    expect(sockets).toHaveLength(0);
  });

  it('resets the backoff only after a fresh accepted pose, not on ready', async () => {
    start();
    await flush();
    socket().onclose?.({}); // fail 1 -> 500
    await advance(500);
    socket().onclose?.({}); // fail 2 -> 1000
    await advance(1000);
    socket().reply({ type: 'ready' });
    socket().onclose?.({}); // ready did not reset -> 2000
    await advance(1999);
    expect(sockets).toHaveLength(3);
    await advance(1);
    expect(sockets).toHaveLength(4);
    socket().reply({ type: 'ready' });
    const a = send();
    await advance(1001);
    socket().reply(pose(a)); // stale: no reset
    socket().onclose?.({}); // -> 4000
    await advance(3999);
    expect(sockets).toHaveLength(4);
    await advance(1);
    socket().reply({ type: 'ready' });
    const b = send();
    socket().reply(pose(b)); // fresh: reset
    socket().onclose?.({});
    await advance(500);
    expect(sockets).toHaveLength(6);
  });

  it('close stops sockets, timers and a token still being fetched', async () => {
    let resolve!: (t: string) => void;
    getToken.mockImplementation(() => new Promise((r) => { resolve = r; }));
    start();
    client.close();
    expect(statuses.at(-1)).toBe('stopped');
    resolve('late');
    await flush();
    expect(sockets).toHaveLength(0);
    await advance(60_000);
    expect(sockets).toHaveLength(0);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('close ends a live stream and ignores every later callback', async () => {
    start();
    await connected();
    const a = send();
    const s = socket();
    const handlers = { msg: s.onmessage, close: s.onclose, error: s.onerror };
    const before = { statuses: statuses.length, available: available.length };
    client.close();
    expect(s.closed).toBe(1);
    expect(statuses.at(-1)).toBe('stopped');
    handlers.msg?.({ data: JSON.stringify(pose(a)) });
    handlers.error?.({});
    handlers.close?.({});
    client.send(Date.now(), jpeg(2));
    await advance(60_000);
    expect(poses).toHaveLength(0);
    expect(failures).toEqual([]);
    expect(sockets).toHaveLength(1);
    expect(s.sent).toHaveLength(1);
    expect(statuses.length).toBe(before.statuses + 1);
    expect(available.length).toBe(before.available);
  });

  it('ignores sockets and timers from an older generation', async () => {
    start();
    await connected();
    const old = socket();
    const handlers = { msg: old.onmessage, close: old.onclose, error: old.onerror };
    const a = send();
    await advance(5000); // timeout: generation 1 ends
    expect(failures).toEqual(['timeout']);
    await advance(500);
    await connected();
    const b = send();
    handlers.msg?.({ data: JSON.stringify(pose(a)) });
    handlers.msg?.({ data: JSON.stringify({ type: 'status', status: 'warming' }) });
    handlers.msg?.({ data: JSON.stringify({ type: 'error', message: 'x' }) });
    handlers.error?.({});
    handlers.close?.({});
    expect(failures).toEqual(['timeout']);
    expect(statuses.at(-1)).toBe('tracking');
    expect(sockets).toHaveLength(2);
    socket().reply(pose(b));
    expect(poses).toHaveLength(1);
    await advance(30_000); // no stray timers from generation 1
    expect(sockets).toHaveLength(2);
  });
});
