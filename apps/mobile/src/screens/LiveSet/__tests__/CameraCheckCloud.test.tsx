/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
// Camera check in cloud mode (AI-17): the real usePoseMode, usePoseOutput and CloudPoseClient, with
// fake sockets, a fake native encoder and a controllable session.
import React from 'react';
import { AppState, Text } from 'react-native';
import type { Frame } from 'react-native-vision-camera';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { createBasicPoseDetector, createCloudFrameEncoder, createPoseDetector } from 'steadyforum-pose';
import CameraCheck from '../CameraCheck';
import type { SocketLike } from '@/pose/cloud';
import { __clearPoseStoreForTests, saveBenchmark, saveCloudConsent, savePreference } from '@/pose/modeStore';
import { __resetPoseModeForTests, usePoseMode, type PoseModeState } from '@/pose/usePoseMode';
import { __setCloudSocketForTests } from '@/pose/useCloudConfig';
import type { PosePreference } from '@/pose/mode';
import * as modeStore from '@/pose/modeStore';
const { act, create } = require('react-test-renderer');

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => () => void) => require('react').useEffect(() => { const blur = cb(); mockBlurs.push(blur); return blur; }, [cb]),
}));
jest.mock('react-native-vision-camera', () => ({ Camera: 'Camera', useCameraDevice: (id: string) => ({ id, hasTorch: false }), useCameraPermission: () => ({ hasPermission: true }), useFrameOutput: jest.fn() }));
jest.mock('react-native-worklets', () => ({ createSynchronizable: jest.fn(), scheduleOnRN: jest.fn() }));
jest.mock('steadyforum-pose', () => ({
  createPoseDetector: jest.fn(), createBasicPoseDetector: jest.fn(), createCloudFrameEncoder: jest.fn(),
  getPoseModelId: jest.fn(() => 'model-a'), benchmarkPoseModel: jest.fn(),
}));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('../FramingGuide', () => ({ FramingGuide: 'Guide' }));
jest.mock('@/screens/Auth/client', () => ({ apiUrl: 'https://api.test', authClient: null, authConfigured: false }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => mockSession.current }));

class FakeSocket implements SocketLike {
  binaryType?: string;
  readyState = 1;
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public token: string) {}
  send(d: ArrayBuffer) { this.sent.push(d); }
  close() { this.closed = true; }
  reply(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
  stamps() { return this.sent.map((f) => new DataView(f).getFloat64(0, false)); }
}

const T0 = 1_800_000_000_000;
const joints = Array.from({ length: 17 }, (_, i) => ({ x: i % 2 ? 0.4 : 0.6, y: 0.2 + i / 30, c: 0.9 }));

interface Session { user: { id: string; email: string; name: string } | null; getApiToken: jest.Mock }
const mockSession: { current: Session } = { current: { user: null, getApiToken: jest.fn() } };
/** Focus cleanups registered by the mocked `useFocusEffect`; calling one blurs the screen. */
const mockBlurs: (() => void)[] = [];

function harness() {
  const h = {
    renderer: null as ReturnType<typeof create> | null,
    sockets: [] as FakeSocket[],
    onContinue: jest.fn(),
    detector: { model: 'yolov8n-pose-320', detect: jest.fn(), setFrameOutput: jest.fn() },
    encoder: { setFrameOutput: jest.fn(), encode: jest.fn(() => ({ jpeg: new Uint8Array([0xff, 0xd8]).buffer, timestampMs: Date.now(), width: 320, height: 180 })) },
    queue: null as (() => void)[] | null, // null: worklet deliveries run at once
    frameTs: 0,
  };
  const socket = () => h.sockets.at(-1)!;
  async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }
  async function mount() {
    act(() => { h.renderer = create(<CameraCheck exercise="squat" onContinue={h.onContinue} />); });
    await flush();
  }
  function unmount() { if (h.renderer) act(() => h.renderer!.unmount()); h.renderer = null; }
  const root = () => h.renderer!.root;
  const choices = () => root().findAllByType('Choice');
  const labels = (): string[] => choices().map((n: { props: { label: string } }) => n.props.label);
  const choice = (label: string) => choices().find((n: { props: { label: string } }) => n.props.label === label);
  const press = async (label: string) => { act(() => choice(label)!.props.onPress()); await flush(); };
  const text = (): string => root().findAllByType(Text).map((t: { props: { children: unknown } }) => [t.props.children].flat().join('')).join('\n');
  /** One camera frame through the worklet; returns the capture time it was encoded with. */
  function frame(): number {
    h.frameTs += 1;
    const stamp = Date.now();
    h.encoder.encode.mockReturnValueOnce({ jpeg: new Uint8Array([0xff, 0xd8]).buffer, timestampMs: stamp, width: 320, height: 180 });
    const options = jest.mocked(useFrameOutput).mock.calls.at(-1)![0];
    act(() => options.onFrame!({ timestamp: h.frameTs, dispose: jest.fn() } as unknown as Frame));
    return stamp;
  }
  function drain() { act(() => { while (h.queue?.length) h.queue.shift()!(); }); }
  /** Sends a frame and answers it with a fresh, well framed pose. */
  function tracked(person = true) {
    const ts = frame();
    act(() => socket().reply({ type: 'pose', timestamp_ms: ts, result: person ? { source: 'cloud', model: 'yolov8n-pose-320', timestamp_ms: ts, score: 0.9, joints } : null, latency_ms: 40, endpoint_ms: 30, dropped: 0 }));
  }
  function layout() {
    act(() => root().findByProps({ testID: 'framing-preview' }).props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } }));
    act(() => root().findByType('Camera').props.onConfigured());
  }
  const advance = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
  return { h, socket, flush, mount, unmount, root, labels, choice, press, text, frame, drain, tracked, layout, advance };
}

/** Saved phone state: the benchmark, preference and this account's consent. */
function phone({ fps, preference = 'auto', consent = true, user = 'user-1' }: { fps: number; preference?: PosePreference; consent?: boolean; user?: string | null }) {
  __clearPoseStoreForTests();
  saveBenchmark({ modelId: 'model-a', size: fps >= 12 ? 320 : 256, fps, meanMs: 10, p95Ms: 12, ranAt: 1, error: null });
  savePreference(preference);
  if (consent && user) saveCloudConsent(user, true);
  __resetPoseModeForTests();
  mockSession.current = { user: user ? { id: user, email: `${user}@example.com`, name: user } : null, getApiToken: jest.fn(async () => (user ? `jwt-${user}` : null)) };
}

function setup(h: ReturnType<typeof harness>['h']) {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  jest.clearAllMocks();
  mockBlurs.length = 0;
  h.sockets.length = 0;
  h.queue = null;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  __setCloudSocketForTests((_url, token) => { const s = new FakeSocket(token); h.sockets.push(s); return s; });
  jest.mocked(createSynchronizable).mockImplementation(((init: unknown) => {
    let v = init;
    return { getDirty: () => v, getBlocking: () => v, setBlocking: (x: unknown) => { v = typeof x === 'function' ? (x as (p: unknown) => unknown)(v) : x; } };
  }) as never);
  jest.mocked(scheduleOnRN).mockImplementation(((cb: (...a: unknown[]) => void, ...args: unknown[]) => {
    if (h.queue) h.queue.push(() => cb(...args)); else cb(...args);
  }) as never);
  jest.mocked(createPoseDetector).mockReturnValue(h.detector as never);
  jest.mocked(createBasicPoseDetector).mockReturnValue({ ...h.detector, model: 'apple-vision-body-pose' } as never);
  jest.mocked(createCloudFrameEncoder).mockReturnValue(h.encoder as never);
  jest.mocked(useFrameOutput).mockReturnValue({ currentResolution: { width: 1080, height: 1920 } } as never);
}

const t = harness();
const { h } = t;
beforeEach(() => setup(h));
afterEach(() => { t.unmount(); jest.useRealTimers(); });

describe('camera check: cloud failure never starts Core ML on its own', () => {
  it('offers local tracking on a capable phone, and starts Core ML only after the tap', async () => {
    phone({ fps: 60, preference: 'cloud' });
    const save = jest.spyOn(modeStore, 'savePreference');
    await t.mount();
    expect(h.sockets).toHaveLength(1);
    expect(t.socket().token).toBe('jwt-user-1');
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(t.text()).toContain('Connecting…');

    act(() => t.socket().reply({ type: 'ready' }));
    // The first failure: the relay is warming. Mode flips cloud -> paused without remounting the transport.
    act(() => t.socket().reply({ type: 'status', status: 'warming' }));
    await t.flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].closed).toBe(false);
    expect(t.text()).toContain('Reconnecting…');
    expect(t.labels()).toEqual(expect.arrayContaining(['Use local tracking', 'Retry cloud', 'Continue without camera']));
    expect(t.labels()).not.toContain('Use basic tracking');

    // Core ML stays off however long cloud keeps failing.
    await t.advance(60_000);
    expect(createPoseDetector).not.toHaveBeenCalled();

    // Retry: a fresh client (new socket, backoff reset), still no Core ML.
    const before = h.sockets.length;
    await t.press('Retry cloud');
    expect(h.sockets.length).toBe(before + 1);
    expect(h.sockets.slice(0, -1).every((s) => s.closed)).toBe(true);
    expect(createPoseDetector).not.toHaveBeenCalled();

    // Fails again (closed before ready), then the user taps local.
    act(() => t.socket().onclose?.({}));
    await t.flush();
    expect(t.labels()).toContain('Use local tracking');
    await t.press('Use local tracking');
    expect(createPoseDetector).toHaveBeenCalledWith(320);
    expect(h.sockets.every((s) => s.closed)).toBe(true);
    const count = h.sockets.length;
    await t.advance(120_000);
    expect(h.sockets.length).toBe(count);
    expect(t.text()).toContain('On-device tracking');
    expect(t.labels()).not.toContain('Retry cloud');
    expect(save).not.toHaveBeenCalled();
    expect(modeStore.loadPreference()).toBe('cloud');

    // Reopening the flow goes back to the saved preference: cloud.
    t.unmount();
    jest.mocked(createPoseDetector).mockClear();
    await t.mount();
    expect(h.sockets.length).toBe(count + 1);
    expect(t.socket().closed).toBe(false);
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(t.labels()).not.toContain('Use local tracking');
    expect(save).not.toHaveBeenCalled();
  });

  it('never offers local tracking (Core ML or Apple Vision) to a slow phone', async () => {
    phone({ fps: 5 });
    await t.mount();
    expect(h.sockets).toHaveLength(1);
    act(() => t.socket().onclose?.({}));
    await t.flush();
    expect(t.labels()).toEqual(expect.arrayContaining(['Retry cloud', 'Continue without camera']));
    expect(t.labels()).not.toContain('Use local tracking');
    expect(t.labels()).not.toContain('Use basic tracking');
    await t.advance(60_000);
    expect(createPoseDetector).not.toHaveBeenCalled();
    expect(createBasicPoseDetector).not.toHaveBeenCalled();
  });

  it('makes continuing without the camera the primary choice after 15 s of recovery', async () => {
    phone({ fps: 60, preference: 'cloud' });
    await t.mount();
    act(() => t.socket().onclose?.({}));
    await t.flush();
    expect(t.choice('Continue without camera')!.props.primary).toBeFalsy();
    expect(t.choice('Use local tracking')!.props.primary).toBe(true);
    await t.advance(14_000);
    expect(t.choice('Continue without camera')!.props.primary).toBeFalsy();
    await t.advance(1_000);
    expect(t.choice('Continue without camera')!.props.primary).toBe(true);
    expect(t.choice('Use local tracking')!.props.primary).toBeFalsy();
    await t.press('Continue without camera');
    expect(h.onContinue).toHaveBeenCalledWith('manual');
  });

  it('hides the recovery choices after a fresh tracked result', async () => {
    phone({ fps: 5 });
    await t.mount();
    act(() => t.socket().reply({ type: 'ready' }));
    act(() => t.socket().reply({ type: 'status', status: 'warming' }));
    expect(t.labels()).toContain('Retry cloud');
    await t.advance(2_000);
    t.tracked();
    expect(t.labels()).not.toContain('Retry cloud');
    expect(t.text()).not.toContain('Reconnecting…');
    expect(t.text()).toContain('Cloud tracking');
  });
});

describe('camera check: cloud consent belongs to the account', () => {
  it('explains cloud frames before consent and sends nothing until the user allows it', async () => {
    phone({ fps: 5, consent: false });
    await t.mount();
    expect(t.text()).toContain('sends camera frames to the SteadyForum API for pose detection');
    expect(t.text()).toContain('processed in memory and never stored');
    expect(t.labels()).toEqual(expect.arrayContaining(['Allow cloud tracking', 'Continue without camera']));
    await t.advance(10_000);
    expect(h.sockets).toHaveLength(0);
    expect(mockSession.current.getApiToken).not.toHaveBeenCalled();

    await t.press('Allow cloud tracking');
    expect(modeStore.loadCloudConsent('user-1')).toBe(true);
    expect(h.sockets).toHaveLength(1);
    expect(t.socket().token).toBe('jwt-user-1');
  });

  it("doesn't use another account's consent, or the old device-wide one", async () => {
    phone({ fps: 5, user: 'user-2', consent: false });
    modeStore.saveCloudConsent('user-1', true);
    require('react-native-mmkv').createMMKV({ id: 'pose' }).set('cloudConsent', true);
    await t.mount();
    expect(t.labels()).toContain('Allow cloud tracking');
    expect(h.sockets).toHaveLength(0);
  });

  it('continues manually from the consent prompt', async () => {
    phone({ fps: 5, consent: false });
    await t.mount();
    await t.press('Continue without camera');
    expect(h.onContinue).toHaveBeenCalledWith('manual');
    expect(h.sockets).toHaveLength(0);
  });

  it('describes cloud frames accurately in the iOS camera permission text', () => {
    const text: string = require('../../../../app.json').expo.ios.infoPlist.NSCameraUsageDescription;
    expect(text).not.toMatch(/never leaves/i);
    expect(text).toMatch(/SteadyForum/);
    expect(text).toMatch(/never stored/i);
  });
});

describe('camera check: nothing is sent outside an eligible session', () => {
  const rerender = () => act(() => h.renderer!.update(<CameraCheck exercise="squat" onContinue={h.onContinue} />));
  const sent = () => h.sockets.reduce((n, s) => n + s.sent.length, 0);
  /** Consent changed elsewhere (e.g. settings) for the same account. */
  function consentElsewhere(userId: string) {
    let latest!: PoseModeState;
    function Probe() { latest = usePoseMode(userId); return null; }
    act(() => { create(<Probe />); });
    return (c: boolean) => act(() => latest.setCloudConsent(c));
  }
  function deferToken() {
    const pending: ((token: string | null) => void)[] = [];
    mockSession.current.getApiToken.mockImplementation(() => new Promise<string | null>((r) => pending.push(r)));
    return pending;
  }
  async function expectSilent() {
    const count = h.sockets.length, frames = sent();
    t.frame();
    await t.advance(60_000);
    expect(h.sockets.every((s) => s.closed)).toBe(true);
    expect(h.sockets.length).toBe(count);
    expect(sent()).toBe(frames);
  }

  it('stops at once when consent is revoked, and a late encoder delivery sends nothing', async () => {
    phone({ fps: 5 });
    const setConsent = consentElsewhere('user-1');
    await t.mount();
    act(() => t.socket().reply({ type: 'ready' }));
    t.frame();
    expect(sent()).toBe(1);
    h.queue = [];
    t.frame(); // encoded, still on its way to JS
    act(() => t.socket().reply({ type: 'pose', timestamp_ms: t.socket().stamps()[0], result: null, latency_ms: 1, endpoint_ms: 1, dropped: 0 }));
    setConsent(false);
    expect(t.socket().closed).toBe(true);
    t.drain();
    h.queue = null;
    expect(sent()).toBe(1);
    expect(t.labels()).toContain('Allow cloud tracking');
    await expectSilent();
  });

  it('never connects when consent is revoked while the token is on its way', async () => {
    phone({ fps: 5 });
    const pending = deferToken();
    const setConsent = consentElsewhere('user-1');
    await t.mount();
    expect(pending).toHaveLength(1);
    setConsent(false);
    await act(async () => { pending[0]('jwt-user-1'); });
    expect(h.sockets).toHaveLength(0);
    await expectSilent();
  });

  it('stops at once on logout', async () => {
    phone({ fps: 5 });
    await t.mount();
    act(() => t.socket().reply({ type: 'ready' }));
    mockSession.current = { user: null, getApiToken: jest.fn(async () => null) };
    rerender();
    expect(t.socket().closed).toBe(true);
    await expectSilent();
  });

  it("stops at once on an account change, and a late token for the old account is never used", async () => {
    phone({ fps: 5 });
    modeStore.saveCloudConsent('user-2', true);
    const pending = deferToken();
    await t.mount();
    expect(pending).toHaveLength(1);
    mockSession.current = { ...mockSession.current, user: { id: 'user-2', email: 'user-2@example.com', name: 'user-2' } };
    rerender();
    await t.flush();
    expect(pending).toHaveLength(2);
    await act(async () => { pending[0]('jwt-user-1'); });
    expect(h.sockets).toHaveLength(0);
    await act(async () => { pending[1]('jwt-user-2'); });
    expect(h.sockets.map((s) => s.token)).toEqual(['jwt-user-2']);
  });

  it('switching to an account without consent stops the stream', async () => {
    phone({ fps: 5 });
    await t.mount();
    act(() => t.socket().reply({ type: 'ready' }));
    mockSession.current = { user: { id: 'user-2', email: 'user-2@example.com', name: 'user-2' }, getApiToken: jest.fn(async () => 'jwt-user-2') };
    rerender();
    expect(t.socket().closed).toBe(true);
    expect(t.labels()).toContain('Allow cloud tracking');
    await expectSilent();
    expect(h.sockets.map((s) => s.token)).toEqual(['jwt-user-1']);
  });

  it('stops while backgrounded, including a delivery that lands after', async () => {
    let onAppState!: (state: string) => void;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (state: string) => void) => { onAppState = cb; return { remove: jest.fn() }; }) as never);
    phone({ fps: 5 });
    await t.mount();
    act(() => t.socket().reply({ type: 'ready' }));
    h.queue = [];
    t.frame();
    act(() => onAppState('background'));
    expect(h.sockets[0].closed).toBe(true);
    t.drain();
    h.queue = null;
    expect(sent()).toBe(0);
    await t.advance(60_000);
    expect(h.sockets).toHaveLength(1);

    act(() => onAppState('active'));
    await t.flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].closed).toBe(false);
  });

  it('stops when the screen loses focus, even if the token arrives later', async () => {
    phone({ fps: 5 });
    const pending = deferToken();
    await t.mount();
    act(() => mockBlurs.at(-1)!());
    await act(async () => { pending[0]('jwt-user-1'); });
    expect(h.sockets).toHaveLength(0);
    await t.advance(60_000);
    expect(h.sockets).toHaveLength(0);
  });
});

describe('camera check: an interruption clears framing', () => {
  it("restarts the one-second hold after cloud tracking drops, so readiness can't span the gap", async () => {
    phone({ fps: 5 });
    await t.mount();
    t.layout();
    act(() => t.socket().reply({ type: 'ready' }));
    for (let i = 0; i < 4; i++) { t.tracked(); await t.advance(200); }
    expect(t.text()).toContain('Hold your position…');

    act(() => t.socket().onclose?.({})); // dropped after ready: reconnects after 500 ms
    expect(t.text()).toContain('Reconnecting…');
    expect(t.text()).not.toContain('Hold your position…');
    expect(t.root().findByType('Guide').props.ready).toBe(false);
    await t.advance(500);
    act(() => t.socket().reply({ type: 'ready' }));
    t.tracked(); await t.advance(200); t.tracked();
    expect(h.onContinue).not.toHaveBeenCalled();
    expect(t.text()).toContain('Hold your position…');
  });
});
