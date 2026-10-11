import React from 'react';
import { benchmarkPoseModel, getPoseModelId } from 'steadyforum-pose';
import type { BenchmarkResult } from '../benchmark';
import { __clearPoseStoreForTests, loadBenchmark, loadCloudConsent, loadPreference, saveBenchmark } from '../modeStore';
import {
  __resetPoseModeForTests,
  reportCloudAvailability,
  rerunBenchmark,
  startPoseBenchmark,
  usePoseMode,
  type PoseModeState,
} from '../usePoseMode';

const { act, create } = require('react-test-renderer');

jest.mock('steadyforum-pose', () => ({ benchmarkPoseModel: jest.fn(), getPoseModelId: jest.fn() }));

const fast = { size: 320, model: 'yolov8n-pose-320', meanMs: 9, p95Ms: 10, samples: 150 };
const slow = (size: number) => ({ size, model: `yolov8n-pose-${size}`, meanMs: 150, p95Ms: 200, samples: 8 });
const cached = (modelId: string): BenchmarkResult =>
  ({ modelId, size: 320, fps: 100, meanMs: 9, p95Ms: 10, ranAt: 1, error: null });

/** Renders the hook for a signed-in account and returns a getter for its latest value. */
function renderMode(accountId: string | null = 'user-1') {
  let latest!: PoseModeState;
  function Probe() {
    latest = usePoseMode(accountId);
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(Probe)); });
  return { get: () => latest, unmount: () => act(() => renderer.unmount()) };
}

describe('usePoseMode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __clearPoseStoreForTests();
    __resetPoseModeForTests();
    jest.mocked(getPoseModelId).mockReturnValue('model-a');
    jest.mocked(benchmarkPoseModel).mockResolvedValue(fast);
  });

  it('is pending until the first benchmark, then picks on-device and saves it', async () => {
    const hook = renderMode();
    expect(hook.get().mode).toBe('pending');

    await act(() => startPoseBenchmark('ios'));
    expect(hook.get()).toMatchObject({ mode: 'coreml', size: 320, benchmarking: false, needsCloudConsent: false });
    expect(loadBenchmark()).toMatchObject({ modelId: 'model-a', size: 320, fps: 100 });
    hook.unmount();
  });

  it('uses the cached result without benchmarking when the model is unchanged', async () => {
    saveBenchmark(cached('model-a'));
    __resetPoseModeForTests();
    const hook = renderMode();
    expect(hook.get().mode).toBe('coreml');

    await act(() => startPoseBenchmark('ios'));
    expect(benchmarkPoseModel).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('benchmarks again when the model id changes', async () => {
    saveBenchmark(cached('model-old'));
    __resetPoseModeForTests();
    await startPoseBenchmark('ios');
    expect(benchmarkPoseModel).toHaveBeenCalled();
    expect(loadBenchmark()?.modelId).toBe('model-a');
  });

  it('shares one run between concurrent starts', async () => {
    await Promise.all([startPoseBenchmark('ios'), startPoseBenchmark('ios')]);
    expect(benchmarkPoseModel).toHaveBeenCalledTimes(1);
  });

  it('saves a model load failure, so the phone goes to cloud', async () => {
    jest.mocked(benchmarkPoseModel).mockRejectedValue(new Error('model missing'));
    const hook = renderMode();
    await act(() => startPoseBenchmark('ios'));
    expect(hook.get()).toMatchObject({ mode: 'unavailable', needsCloudConsent: true });
    expect(loadBenchmark()).toMatchObject({ fps: null, error: 'model missing' });
    hook.unmount();
  });

  it('does not save an unexpected failure, so the next launch retries', async () => {
    jest.mocked(getPoseModelId).mockImplementation(() => { throw new Error('no native module'); });
    const hook = renderMode();
    await act(() => startPoseBenchmark('ios'));
    expect(hook.get().mode).toBe('unavailable');
    expect(hook.get().benchmark?.error).toBe('no native module');
    expect(loadBenchmark()).toBeNull();
    hook.unmount();
  });

  it('asks a slow iPhone for cloud consent, then waits for the cloud client', async () => {
    jest.mocked(benchmarkPoseModel).mockResolvedValueOnce(slow(320)).mockResolvedValueOnce(slow(256));
    const hook = renderMode();
    await act(() => startPoseBenchmark('ios'));
    expect(hook.get()).toMatchObject({ mode: 'unavailable', needsCloudConsent: true, size: 320 });

    act(() => hook.get().setCloudConsent(true));
    // Cloud is unreachable until CONN-11, so consenting leads to `paused`.
    expect(hook.get()).toMatchObject({ mode: 'paused', needsCloudConsent: false, cloudConsent: true });
    expect(loadCloudConsent('user-1')).toBe(true);
    hook.unmount();
  });

  it('sends Android to cloud without touching native code', async () => {
    const hook = renderMode();
    await act(() => startPoseBenchmark('android'));
    expect(getPoseModelId).not.toHaveBeenCalled();
    expect(benchmarkPoseModel).not.toHaveBeenCalled();
    expect(hook.get()).toMatchObject({ mode: 'unavailable', needsCloudConsent: true });
    hook.unmount();
  });

  it('persists the preference', async () => {
    const hook = renderMode();
    act(() => hook.get().setPreference('vision'));
    expect(hook.get().mode).toBe('vision'); // no need to wait for the YOLOv8 benchmark
    act(() => hook.get().setPreference('auto'));
    expect(hook.get().mode).toBe('pending');

    await act(() => startPoseBenchmark('ios'));
    act(() => hook.get().setPreference('vision'));
    expect(hook.get().mode).toBe('vision');
    expect(loadPreference()).toBe('vision');

    act(() => hook.get().setPreference('cloud'));
    expect(hook.get()).toMatchObject({ mode: 'coreml', needsCloudConsent: true });
    hook.unmount();
  });

  it('re-runs on request even when the cache is current', async () => {
    saveBenchmark(cached('model-a'));
    __resetPoseModeForTests();
    let finish!: (v: typeof fast) => void;
    jest.mocked(benchmarkPoseModel).mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const hook = renderMode();

    let done!: Promise<void>;
    act(() => { done = rerunBenchmark('ios'); });
    expect(hook.get().benchmarking).toBe(true);
    await act(async () => { finish({ ...fast, p95Ms: 20 }); await done; });
    expect(hook.get()).toMatchObject({ benchmarking: false, benchmark: { p95Ms: 20, fps: 50 } });
    hook.unmount();
  });
});

describe('usePoseMode cloud reachability (AI-17)', () => {
  const { saveCloudConsent, savePreference } = jest.requireActual('../modeStore') as typeof import('../modeStore');

  beforeEach(() => {
    jest.useFakeTimers();
    __clearPoseStoreForTests();
    __resetPoseModeForTests();
    jest.mocked(getPoseModelId).mockReturnValue('model-a');
    // A slow iPhone that has consented: it wants cloud mode.
    saveBenchmark({ modelId: 'model-a', size: 256, fps: 5, meanMs: 200, p95Ms: 250, ranAt: 1, error: null });
    saveCloudConsent('user-1', true);
  });
  afterEach(() => jest.useRealTimers());

  it('is paused until the transport reports the relay available, and paused again when it drops', () => {
    const hook = renderMode();
    expect(hook.get().mode).toBe('paused');
    act(() => reportCloudAvailability(true));
    expect(hook.get().mode).toBe('cloud');
    act(() => reportCloudAvailability(false));
    expect(hook.get().mode).toBe('paused');
    hook.unmount();
  });

  it('never probes the relay itself: no timers, no sockets', () => {
    const hook = renderMode();
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(jest.getTimerCount()).toBe(0);
    expect(hook.get().mode).toBe('paused');
    hook.unmount();
  });

  it('pauses a capable, cloud-preferring iPhone when cloud is unreachable; Core ML never starts on its own', () => {
    saveBenchmark({ modelId: 'model-a', size: 320, fps: 60, meanMs: 9, p95Ms: 10, ranAt: 1, error: null });
    savePreference('cloud');
    __resetPoseModeForTests();
    const hook = renderMode();
    expect(hook.get().mode).toBe('paused');
    act(() => reportCloudAvailability(true));
    expect(hook.get().mode).toBe('cloud');
    act(() => reportCloudAvailability(false));
    expect(hook.get().mode).toBe('paused');
    hook.unmount();
  });
});
