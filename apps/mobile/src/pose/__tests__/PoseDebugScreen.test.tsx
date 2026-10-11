/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React from 'react';
import { AppState, Text, View } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { PoseDebugScreen } from '../PoseDebugScreen';
import { usePoseOutput } from '../usePoseOutput';
import { benchmarkPoseModel } from 'steadyforum-pose';
import clip from '../../engine/__fixtures__/bicep_curl_clean.json';
import { __clearPoseStoreForTests, loadCloudConsent, saveBenchmark, saveCloudConsent } from '../modeStore';
import { __resetPoseModeForTests, startPoseBenchmark } from '../usePoseMode';

const { act, create } = require('react-test-renderer');

jest.mock('../usePoseOutput', () => ({ usePoseOutput: jest.fn() }));
jest.mock('steadyforum-pose', () => ({ benchmarkPoseModel: jest.fn(), getPoseModelId: jest.fn(() => 'model-a') }));
jest.mock('../PoseSkeleton', () => ({
  PoseSkeleton: (props: unknown) => require('react').createElement('PoseSkeleton', props),
}));
const mockBlurs: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => () => void) => require('react').useEffect(() => { const blur = cb(); mockBlurs.push(blur); return blur; }, [cb]),
}));
const mockAuth = { user: { id: 'user-1' } as { id: string } | null, getApiToken: jest.fn(async () => 'jwt') };
jest.mock('../../screens/Auth/session', () => ({ useAuth: () => mockAuth }));
jest.mock('../../screens/Auth/client', () => ({ apiUrl: 'https://api.test' }));
jest.mock('react-native-vision-camera', () => ({
  Camera: (props: unknown) => require('react').createElement('Camera', props),
  useCameraDevice: jest.fn((position) => ({ position })),
  useCameraPermission: jest.fn(),
}));

describe('PoseDebugScreen', () => {
  let renderer: ReturnType<typeof create>;
  let frameOutput: { currentResolution: { width: number; height: number } };

  beforeEach(() => {
    jest.clearAllMocks();
    __clearPoseStoreForTests();
    __resetPoseModeForTests();
    frameOutput = { currentResolution: { width: 1920, height: 1080 } };
    jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: true, canRequestPermission: false } as never);
    jest.mocked(usePoseOutput).mockReturnValue({ frameOutput, fps: 15, error: null, model: 'yolov8n-pose-320', dropped: 0 } as never);
  });

  afterEach(() => act(() => renderer.unmount()));

  it('refreshes upright overlay dimensions after switching cameras', () => {
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({
      nativeEvent: { layout: { width: 390, height: 844 } },
    }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 1080, height: 1920 });
    expect(renderer.root.findByType('PoseSkeleton').props.mirrored).toBe(true);
    expect(renderer.root.findByType('Camera').props.mirrorMode).toBe('off');
    expect(renderer.root.findByType('Camera').props.orientationSource).toBe('interface');

    const button = renderer.root.findAll((node: { props: { onPress?: unknown } }) =>
      typeof node.props.onPress === 'function')[0];
    act(() => button.props.onPress());
    expect(renderer.root.findAllByType('PoseSkeleton')).toHaveLength(0);
    frameOutput.currentResolution = { width: 1280, height: 720 };
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 720, height: 1280 });
    expect(renderer.root.findByType('PoseSkeleton').props.mirrored).toBe(false);
  });

  it('shows the skeleton on startup when the resolution is unknown at configure time', () => {
    frameOutput.currentResolution = undefined as never;
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({
      nativeEvent: { layout: { width: 390, height: 844 } },
    }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(renderer.root.findAllByType('PoseSkeleton')).toHaveLength(0);

    // Frames are flowing by the first pose, so the resolution is known.
    frameOutput.currentResolution = { width: 1920, height: 1080 };
    const { onPose } = jest.mocked(usePoseOutput).mock.calls.at(-1)![0];
    act(() => onPose({ latencyMs: 8 }));
    expect(renderer.root.findByType('PoseSkeleton').props.imageSize).toEqual({ width: 1080, height: 1920 });
  });

  it('toggles between YOLOv8 and Apple Vision', () => {
    saveBenchmark({ modelId: 'model-a', size: 320, fps: 60, meanMs: 9, p95Ms: 10, ranAt: 1, error: null });
    __resetPoseModeForTests();
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('coreml');

    const toggle = () => renderer.root.findByProps({ testID: 'pose-engine-toggle' });
    expect(JSON.stringify(renderer.toJSON())).toContain('Use Apple Vision');
    act(() => toggle().props.onPress());
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('vision');
    expect(JSON.stringify(renderer.toJSON())).toContain('Use Core ML');

    act(() => toggle().props.onPress());
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].engine).toBe('coreml');
  });

  it('re-runs the benchmark with the camera unmounted, then uses the size that passed', async () => {
    let finish!: (v: unknown) => void;
    jest.mocked(benchmarkPoseModel).mockReturnValueOnce(new Promise((r) => { finish = r; }) as never);
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(renderer.root.findAllByType('Camera')).toHaveLength(1);

    act(() => renderer.root.findByProps({ testID: 'pose-rerun-benchmark' }).props.onPress());
    expect(renderer.root.findAllByType('Camera')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Benchmarking');

    await act(async () => {
      finish({ size: 320, model: 'yolov8n-pose-320', meanMs: 9, p95Ms: 10, samples: 150 });
    });
    expect(renderer.root.findAllByType('Camera')).toHaveLength(1);
    expect(jest.mocked(usePoseOutput).mock.calls.at(-1)![0].size).toBe(320);
    expect(JSON.stringify(renderer.toJSON())).toContain('"mode ","coreml"');
  });

  it('toggles cloud consent', async () => {
    jest.mocked(benchmarkPoseModel).mockRejectedValue(new Error('model missing'));
    await act(() => startPoseBenchmark('ios'));
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    const text = () => renderer.root.findAllByType(Text)
      .map((t: { props: { children: unknown } }) => [t.props.children].flat().join('')).join('\n');
    expect(text()).toContain('consent needed');
    act(() => renderer.root.findByProps({ testID: 'pose-consent-toggle' }).props.onPress());
    expect(text()).toContain('consent yes');
    expect(text()).toContain('Revoke cloud consent');
    expect(loadCloudConsent('user-1')).toBe(true);
    expect(loadCloudConsent('user-2')).toBe(false);
  });

  it('shows a rejected permission request instead of an unhandled rejection', async () => {
    jest.mocked(useCameraPermission).mockReturnValue({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: jest.fn().mockRejectedValue(new Error('permission request failed')),
    } as never);
    await act(async () => { renderer = create(React.createElement(PoseDebugScreen)); });
    expect(JSON.stringify(renderer.toJSON())).toContain('permission request failed');
  });
});

describe('PoseDebugScreen cloud eligibility (AI-17)', () => {
  let renderer: ReturnType<typeof create>;
  let onAppState: (state: string) => void;
  const last = () => jest.mocked(usePoseOutput).mock.calls.at(-1)![0];
  const rerender = () => act(() => renderer.update(React.createElement(PoseDebugScreen)));

  beforeEach(() => {
    jest.clearAllMocks();
    mockBlurs.length = 0;
    __clearPoseStoreForTests();
    // A slow iPhone that has consented for user-1: cloud mode.
    saveBenchmark({ modelId: 'model-a', size: 256, fps: 5, meanMs: 200, p95Ms: 250, ranAt: 1, error: null });
    saveCloudConsent('user-1', true);
    __resetPoseModeForTests();
    mockAuth.user = { id: 'user-1' };
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (state: string) => void) => { onAppState = cb; return { remove: jest.fn() }; }) as never);
    jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: true, canRequestPermission: false } as never);
    jest.mocked(usePoseOutput).mockReturnValue({ frameOutput: { currentResolution: { width: 1920, height: 1080 } }, fps: 9, error: null, model: 'cloud', dropped: 0, cloudStatus: 'connecting' } as never);
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
  });
  afterEach(() => act(() => renderer.unmount()));

  it('streams to the relay while signed in, consented, in cloud mode, foreground and focused', () => {
    expect(last().engine).toBe('cloud');
    expect(last().cloud).toMatchObject({ url: 'wss://api.test/pose/stream' });
  });

  it('stops the transport when consent is revoked, and starts it again when allowed', () => {
    act(() => renderer.root.findByProps({ testID: 'pose-consent-toggle' }).props.onPress());
    expect(last().cloud).toBeNull();
    expect(last().engine).not.toBe('coreml');
    act(() => renderer.root.findByProps({ testID: 'pose-consent-toggle' }).props.onPress());
    expect(last().cloud).not.toBeNull();
  });

  it('stops the transport on logout and on a switch to an account without consent', () => {
    mockAuth.user = null;
    rerender();
    expect(last().cloud).toBeNull();
    mockAuth.user = { id: 'user-2' };
    rerender();
    expect(last().cloud).toBeNull();
    mockAuth.user = { id: 'user-1' };
    rerender();
    expect(last().cloud).not.toBeNull();
  });

  it('gives each account its own client', () => {
    const first = last().cloud;
    saveCloudConsent('user-2', true);
    mockAuth.user = { id: 'user-2' };
    rerender();
    expect(last().cloud).not.toBeNull();
    expect(last().cloud).not.toBe(first);
  });

  it('stops the transport while backgrounded or unfocused', () => {
    act(() => onAppState('background'));
    expect(last().cloud).toBeNull();
    act(() => onAppState('active'));
    expect(last().cloud).not.toBeNull();
    act(() => mockBlurs.at(-1)!());
    expect(last().cloud).toBeNull();
  });
});

describe('PoseDebugScreen cloud readout and form resets (AI-17)', () => {
  let renderer: ReturnType<typeof create>;
  let status: string;
  const last = () => jest.mocked(usePoseOutput).mock.calls.at(-1)![0];
  const text = () => renderer.root.findAllByType(Text)
    .map((t: { props: { children: unknown } }) => [t.props.children].flat().join('')).join('\n');
  const rerender = () => act(() => renderer.update(React.createElement(PoseDebugScreen)));
  const reps = () => [renderer.root.findByProps({ testID: 'pose-form-readout' }).props.children].flat().join('');
  function feed(from: number, to: number) {
    for (let i = from; i < to; i++) act(() => last().onPose({ result: clip.frames[i] as never, latencyMs: 8 }));
  }
  function setStatus(next: string) { status = next; rerender(); }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_800_000_000_000);
    jest.clearAllMocks();
    __clearPoseStoreForTests();
    saveBenchmark({ modelId: 'model-a', size: 256, fps: 5, meanMs: 200, p95Ms: 250, ranAt: 1, error: null });
    saveCloudConsent('user-1', true);
    __resetPoseModeForTests();
    mockAuth.user = { id: 'user-1' };
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    status = 'tracking';
    jest.mocked(useCameraPermission).mockReturnValue({ hasPermission: true, canRequestPermission: false } as never);
    jest.mocked(usePoseOutput).mockImplementation(() => ({ frameOutput: { currentResolution: { width: 1920, height: 1080 } }, fps: 9, error: null, model: 'yolov8n-pose-320', dropped: 3, cloudStatus: status }) as never);
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
  });
  afterEach(() => { act(() => renderer.unmount()); jest.useRealTimers(); });

  it('shows the source, cloud status, fps, drops and capture-to-result latency', () => {
    const now = Date.now();
    act(() => last().onPose({ latencyMs: 40, timestampMs: now - 120, result: { ...clip.frames[0], source: 'cloud', timestamp_ms: now - 120 } as never }));
    expect(text()).toContain('source cloud · tracking');
    expect(text()).toContain('fps 9');
    expect(text()).toContain('dropped 3');
    expect(text()).toContain('capture→result 120 ms');
    setStatus('reconnecting');
    expect(text()).toContain('source cloud · reconnecting');
  });

  it('clears the skeleton and result when cloud tracking stops', () => {
    act(() => last().onPose({ latencyMs: 40, timestampMs: Date.now(), result: { ...clip.frames[0], source: 'cloud', timestamp_ms: Date.now() } as never }));
    expect(renderer.root.findByType('PoseSkeleton').props.result).toBeDefined();
    setStatus('reconnecting');
    expect(renderer.root.findByType('PoseSkeleton').props.result).toBeUndefined();
  });

  it("doesn't finish a rep that was half done before a cloud interruption", () => {
    for (let i = 0; i < 2; i++) act(() => renderer.root.findByProps({ testID: 'pose-exercise-next' }).props.onPress());
    expect(reps()).toContain('Bicep curl');
    // Control: the same frames without a gap count one rep.
    feed(0, 62);
    expect(reps()).toContain('reps 1');
    act(() => renderer.root.findByProps({ testID: 'pose-set-reset' }).props.onPress());

    feed(0, 47); // on the way back down
    setStatus('reconnecting');
    setStatus('tracking');
    feed(47, 62);
    expect(reps()).toContain('reps 0');
  });

  it("doesn't finish a rep across a source switch", () => {
    act(() => renderer.unmount());
    saveBenchmark({ modelId: 'model-a', size: 320, fps: 60, meanMs: 9, p95Ms: 10, ranAt: 1, error: null });
    __resetPoseModeForTests();
    act(() => { renderer = create(React.createElement(PoseDebugScreen)); });
    act(() => renderer.root.findAllByType(View)[0].props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } }));
    act(() => renderer.root.findByType('Camera').props.onConfigured());
    expect(last().engine).toBe('coreml');
    for (let i = 0; i < 2; i++) act(() => renderer.root.findByProps({ testID: 'pose-exercise-next' }).props.onPress());
    feed(0, 47);
    act(() => renderer.root.findByProps({ testID: 'pose-engine-toggle' }).props.onPress());
    expect(last().engine).toBe('vision');
    feed(47, 62);
    expect(reps()).toContain('reps 0');
  });
});
