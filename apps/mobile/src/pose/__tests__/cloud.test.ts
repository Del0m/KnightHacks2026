import {
  CloudPoseClient,
  encodeFrame,
  parseServerMessage,
  poseStreamUrl,
  probeCloud,
  type CloudState,
  type SocketLike,
} from '../cloud';

const joints = Array.from({ length: 17 }, (_, i) => ({ x: i / 20, y: 0.5, c: 0.9 }));
const result = { source: 'cloud', model: 'yolov8n-pose-320', timestamp_ms: 1000, score: 0.92, joints };

class FakeSocket implements SocketLike {
  binaryType?: string;
  readyState = 0;
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public url: string, public token: string) {}
  send(data: ArrayBuffer) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  // Server side
  open() { this.readyState = 1; this.onopen?.(); }
  reply(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.readyState = 3; this.onclose?.({}); }
}

const jpeg = (marker: number) => new Uint8Array([0xff, 0xd8, marker]).buffer;
const frameMarker = (frame: ArrayBuffer) => new Uint8Array(frame)[10];

describe('frame encoding', () => {
  it('puts the timestamp in 8 big-endian bytes, then the JPEG', () => {
    const frame = encodeFrame(1_791_682_526_428.5, jpeg(7));
    expect(frame.byteLength).toBe(11);
    expect(new DataView(frame).getFloat64(0, false)).toBe(1_791_682_526_428.5);
    expect(Array.from(new Uint8Array(frame, 8))).toEqual([0xff, 0xd8, 7]);
  });

  it('turns the API URL into the relay URL', () => {
    expect(poseStreamUrl('https://api.spotter.app/')).toBe('wss://api.spotter.app/pose/stream');
    expect(poseStreamUrl('http://localhost:3000')).toBe('ws://localhost:3000/pose/stream');
    expect(() => poseStreamUrl('ftp://x')).toThrow();
  });
});

describe('message parser', () => {
  it('reads each relay message and ignores anything malformed', () => {
    expect(parseServerMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseServerMessage('{"type":"status","status":"warming"}')).toEqual({ type: 'status', status: 'warming' });
    expect(parseServerMessage('{"type":"error","message":"boom"}')).toEqual({ type: 'error', message: 'boom' });
    expect(parseServerMessage(JSON.stringify({ type: 'pose', timestamp_ms: 5, result, latency_ms: 80, endpoint_ms: 12, dropped: 2 })))
      .toMatchObject({ type: 'pose', timestamp_ms: 5, latency_ms: 80, dropped: 2 });
    expect(parseServerMessage(JSON.stringify({ type: 'pose', timestamp_ms: 5, result: null }))).toMatchObject({ result: null, dropped: 0 });

    for (const bad of ['not json', '{}', '{"type":"pose"}', '{"type":"status","status":"other"}', new ArrayBuffer(2),
      JSON.stringify({ type: 'pose', timestamp_ms: 5, result: { ...result, joints: joints.slice(1) } })]) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});

describe('CloudPoseClient', () => {
  let sockets: FakeSocket[];
  let states: [CloudState, string | null][];
  let poses: { score: number | undefined; dropped: number }[];
  let client: CloudPoseClient;
  let now: number;
  const token = jest.fn(async () => 'neon-jwt');

  function start(getToken: () => Promise<string | null> = token) {
    client = new CloudPoseClient({
      url: 'wss://api.test/pose/stream',
      getToken,
      createSocket: (url, t) => { const s = new FakeSocket(url, t); sockets.push(s); return s; },
      onPose: (d, dropped) => poses.push({ score: d.result?.score, dropped }),
      onState: (s, e) => states.push([s, e]),
      backoffMs: [1000, 2000],
      now: () => now,
    });
    client.start();
  }
  const socket = () => sockets.at(-1)!;
  async function connected() {
    await Promise.resolve(); await Promise.resolve();
    socket().open();
    socket().reply({ type: 'ready' });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    sockets = []; states = []; poses = []; now = 1000;
    token.mockClear();
  });
  afterEach(() => { client.close(); jest.useRealTimers(); });

  it('authenticates with the session token and goes live on ready', async () => {
    start();
    await connected();
    expect(socket().token).toBe('neon-jwt');
    expect(socket().binaryType).toBe('arraybuffer');
    expect(states.at(-1)).toEqual(['live', null]);
  });

  it('keeps one frame in flight; the newest waiting frame replaces older ones', async () => {
    start();
    client.send(encodeFrame(1, jpeg(1))); // before ready: waits
    await connected();
    expect(socket().sent.map(frameMarker)).toEqual([1]);

    client.send(encodeFrame(2, jpeg(2)));
    client.send(encodeFrame(3, jpeg(3))); // replaces 2
    expect(socket().sent).toHaveLength(1);

    socket().reply({ type: 'pose', timestamp_ms: 1, result, latency_ms: 90, endpoint_ms: 10, dropped: 0 });
    expect(poses).toEqual([{ score: 0.92, dropped: 0 }]);
    expect(socket().sent.map(frameMarker)).toEqual([1, 3]);

    socket().reply({ type: 'pose', timestamp_ms: 3, result: null, latency_ms: 90, endpoint_ms: 10, dropped: 1 });
    expect(poses.at(-1)).toEqual({ score: undefined, dropped: 1 });
  });

  it('labels results as cloud', async () => {
    const seen: string[] = [];
    client = new CloudPoseClient({
      url: 'x', getToken: token, onPose: (d) => seen.push(d.result!.source),
      createSocket: (url, t) => { const s = new FakeSocket(url, t); sockets.push(s); return s; },
    });
    client.start();
    await connected();
    client.send(encodeFrame(1, jpeg(1)));
    socket().reply({ type: 'pose', timestamp_ms: 1, result: { ...result, source: 'coreml' }, latency_ms: 1, endpoint_ms: 1, dropped: 0 });
    expect(seen).toEqual(['cloud']);
  });

  it('shows warming as reconnecting and holds frames until the relay back-off ends', async () => {
    start();
    await connected();
    client.send(encodeFrame(1, jpeg(1)));
    socket().reply({ type: 'status', status: 'warming' });
    expect(states.at(-1)).toEqual(['reconnecting', null]);

    client.send(encodeFrame(2, jpeg(2)));
    expect(socket().sent).toHaveLength(1); // the relay would drop it unanswered
    now += 2000;
    jest.advanceTimersByTime(2000);
    expect(socket().sent.map(frameMarker)).toEqual([1, 2]);

    socket().reply({ type: 'pose', timestamp_ms: 2, result, latency_ms: 1, endpoint_ms: 1, dropped: 1 });
    expect(states.at(-1)).toEqual(['live', null]);
  });

  it('gives up on a frame with no reply, so a lost reply cannot stall the stream', async () => {
    start();
    await connected();
    client.send(encodeFrame(1, jpeg(1)));
    client.send(encodeFrame(2, jpeg(2)));
    expect(socket().sent).toHaveLength(1);
    jest.advanceTimersByTime(8000);
    expect(socket().sent.map(frameMarker)).toEqual([1, 2]);
  });

  it('reconnects with backoff after a close or an error, with a fresh token', async () => {
    start();
    await connected();
    socket().drop();
    expect(states.at(-1)).toEqual(['reconnecting', 'Connection to the pose service dropped.']);
    expect(sockets).toHaveLength(1);

    jest.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await connected();
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toEqual(['live', null]);

    socket().reply({ type: 'error', message: 'endpoint returned HTTP 500' });
    expect(sockets[1]!.closed).toBe(true);
    expect(states.at(-1)).toEqual(['reconnecting', 'endpoint returned HTTP 500']);
    jest.advanceTimersByTime(1000); // ready reset the backoff
    await connected();
    expect(sockets).toHaveLength(3);
    expect(token).toHaveBeenCalledTimes(3);
  });

  it('backs off further while the relay stays unreachable, and waits for a login', async () => {
    let t: string | null = null;
    start(async () => t);
    await Promise.resolve(); await Promise.resolve();
    expect(sockets).toHaveLength(0);
    expect(states.at(-1)).toEqual(['reconnecting', 'Please log in to use cloud mode.']);
    t = 'jwt';
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    socket().drop(); // never got ready
    expect(states.at(-1)).toEqual(['reconnecting', 'Could not reach the pose service.']);
    jest.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await Promise.resolve(); await Promise.resolve();
    expect(sockets).toHaveLength(2);
  });

  it('stops for good on close, without reconnecting', async () => {
    start();
    await connected();
    client.close();
    expect(socket().closed).toBe(true);
    expect(states.at(-1)).toEqual(['closed', null]);
    jest.advanceTimersByTime(60_000);
    client.send(encodeFrame(1, jpeg(1)));
    expect(sockets).toHaveLength(1);
    expect(socket().sent).toHaveLength(0);
  });
});

describe('probeCloud', () => {
  const make = (react: (s: FakeSocket) => void) => (url: string, token: string) => {
    const s = new FakeSocket(url, token);
    setTimeout(() => react(s), 0);
    return s;
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is reachable on ready or warming, and not on error, close or timeout', async () => {
    const run = (react: (s: FakeSocket) => void) => {
      const p = probeCloud('wss://x', 'jwt', 5000, make(react));
      jest.runAllTimers();
      return p;
    };
    await expect(run((s) => s.reply({ type: 'ready' }))).resolves.toBe(true);
    await expect(run((s) => s.reply({ type: 'status', status: 'warming' }))).resolves.toBe(true);
    await expect(run((s) => s.reply({ type: 'error', message: 'no' }))).resolves.toBe(false);
    await expect(run((s) => s.drop())).resolves.toBe(false);
    await expect(run(() => {})).resolves.toBe(false);
  });
});
