import { benchmarkPoseModel, getPoseModelId } from 'spotter-pose';
import { MEASURE_MS, WARM_UP_MS, pickBenchmark, runPoseBenchmark, sustainedFps } from '../benchmark';

jest.mock('spotter-pose', () => ({ benchmarkPoseModel: jest.fn(), getPoseModelId: jest.fn() }));

/** A native result with the given p95; mean is a little lower. */
const run = (size: number, p95Ms: number) => ({ size, model: `yolov8n-pose-${size}`, meanMs: p95Ms * 0.8, p95Ms, samples: 100 });

describe('benchmark', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPoseModelId).mockReturnValue('model-a');
  });

  it('computes sustained fps from p95 latency', () => {
    expect(sustainedFps(50)).toBe(20);
    expect(sustainedFps(1000 / 12)).toBeCloseTo(12);
  });

  it('prefers the first passing run, else the fastest', () => {
    expect(pickBenchmark([])).toBeNull();
    expect(pickBenchmark([run(320, 50), run(256, 20)])).toEqual({ run: run(320, 50), passed: true });
    expect(pickBenchmark([run(320, 120), run(256, 90)])).toEqual({ run: run(256, 90), passed: false });
  });

  it('stops at 320 when it holds 12 fps', async () => {
    jest.mocked(benchmarkPoseModel).mockResolvedValueOnce(run(320, 10));
    const r = await runPoseBenchmark('ios');
    expect(benchmarkPoseModel).toHaveBeenCalledTimes(1);
    expect(benchmarkPoseModel).toHaveBeenCalledWith(320, WARM_UP_MS, MEASURE_MS);
    expect(r).toMatchObject({ modelId: 'model-a', size: 320, fps: 100, p95Ms: 10, meanMs: 8, error: null });
  });

  it('falls back to 256 when 320 is too slow', async () => {
    jest.mocked(benchmarkPoseModel).mockResolvedValueOnce(run(320, 100)).mockResolvedValueOnce(run(256, 70));
    const r = await runPoseBenchmark('ios');
    expect(jest.mocked(benchmarkPoseModel).mock.calls.map((c) => c[0])).toEqual([320, 256]);
    expect(r).toMatchObject({ size: 256, p95Ms: 70 });
    expect(r.fps).toBeCloseTo(1000 / 70);
  });

  it('keeps the best fps with no size when neither passes', async () => {
    jest.mocked(benchmarkPoseModel).mockResolvedValueOnce(run(320, 200)).mockResolvedValueOnce(run(256, 125));
    const r = await runPoseBenchmark('ios');
    expect(r).toMatchObject({ size: null, fps: 8, p95Ms: 125, error: null });
  });

  it('reports a model load failure with no fps', async () => {
    jest.mocked(benchmarkPoseModel).mockRejectedValueOnce(new Error('model yolov8n-pose-320 is not in the app bundle'));
    const r = await runPoseBenchmark('ios');
    expect(r).toMatchObject({ modelId: 'model-a', size: null, fps: null, error: 'model yolov8n-pose-320 is not in the app bundle' });
  });

  it('skips native code off iOS', async () => {
    const r = await runPoseBenchmark('android');
    expect(r).toMatchObject({ modelId: 'none', size: null, fps: null, error: null });
    expect(getPoseModelId).not.toHaveBeenCalled();
    expect(benchmarkPoseModel).not.toHaveBeenCalled();
  });
});
