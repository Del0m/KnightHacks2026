// On-device benchmark (AI-04, Architecture §4.1). Runs YOLOv8 natively on a synthetic frame at 320,
// then 256 if 320 is too slow. The fps feeds `selectPoseMode`; `usePoseMode` caches the result.
import { benchmarkPoseModel, getPoseModelId, type PoseBenchmark } from 'spotter-pose';
import { MIN_ON_DEVICE_FPS } from './mode';

/** Input sizes, in the order they are tried. */
export const BENCHMARK_SIZES = [320, 256] as const;
/** Discarded after the first (model load) inference. */
export const WARM_UP_MS = 500;
export const MEASURE_MS = 1500;

export type BenchmarkSize = (typeof BENCHMARK_SIZES)[number];

export interface BenchmarkResult {
  /** `getPoseModelId()` at run time; 'none' off iOS. A different id invalidates the cache. */
  modelId: string;
  /** Size that reached `MIN_ON_DEVICE_FPS`, else null. */
  size: BenchmarkSize | null;
  /** Sustained fps of the passing size, else the best seen; null if the model failed or not iOS. */
  fps: number | null;
  meanMs: number | null;
  p95Ms: number | null;
  /** Unix ms. */
  ranAt: number;
  /** Model load failure message. */
  error: string | null;
}

/** Sustained fps: the rate the phone holds 95% of the time. */
export function sustainedFps(p95Ms: number): number {
  return 1000 / p95Ms;
}

/** True when a run is fast enough for live on-device pose. */
export function passesOnDevice(run: PoseBenchmark): boolean {
  return sustainedFps(run.p95Ms) >= MIN_ON_DEVICE_FPS;
}

/** Picks the first passing run (sizes are tried largest first), else the fastest. Null when there are none. */
export function pickBenchmark(runs: PoseBenchmark[]): { run: PoseBenchmark; passed: boolean } | null {
  const passing = runs.find(passesOnDevice);
  if (passing) return { run: passing, passed: true };
  if (runs.length === 0) return null;
  const fastest = runs.reduce((a, b) => (b.p95Ms < a.p95Ms ? b : a));
  return { run: fastest, passed: false };
}

/**
 * Benchmarks YOLOv8 at 320, then 256 if 320 falls short. Off iOS it returns straight away without
 * touching native code. A rejected `benchmarkPoseModel` (model missing or failed to load) ends the run
 * with `error` set; anything else that throws (e.g. `getPoseModelId`) propagates to the caller.
 */
export async function runPoseBenchmark(platform: string): Promise<BenchmarkResult> {
  const empty = { size: null, fps: null, meanMs: null, p95Ms: null, error: null };
  if (platform !== 'ios') return { ...empty, modelId: 'none', ranAt: Date.now() };

  const modelId = getPoseModelId();
  const runs: PoseBenchmark[] = [];
  let error: string | null = null;
  for (const size of BENCHMARK_SIZES) {
    try {
      const run = await benchmarkPoseModel(size, WARM_UP_MS, MEASURE_MS);
      runs.push(run);
      if (passesOnDevice(run)) break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }

  const picked = pickBenchmark(runs);
  return {
    modelId,
    size: picked?.passed ? (picked.run.size as BenchmarkSize) : null,
    fps: picked ? sustainedFps(picked.run.p95Ms) : null,
    meanMs: picked?.run.meanMs ?? null,
    p95Ms: picked?.run.p95Ms ?? null,
    ranAt: Date.now(),
    error,
  };
}
