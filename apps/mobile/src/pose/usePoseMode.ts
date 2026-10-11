// Pose mode hook (AI-04, Architecture §4.1): the cached benchmark plus the user's preference and
// cloud consent, fed through `selectPoseMode`. One module-level store, shared by every caller.
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getPoseModelId } from 'spotter-pose';
import { runPoseBenchmark, type BenchmarkResult, type BenchmarkSize } from './benchmark';
import { probeCloud, type CreateSocket } from './cloud';
import { selectPoseMode, type PoseMode, type PosePreference } from './mode';
import {
  loadBenchmark,
  loadCloudConsent,
  loadPreference,
  saveBenchmark,
  saveCloudConsent,
  savePreference,
} from './modeStore';

/** While the relay is unreachable, check again this often. */
export const CLOUD_RECHECK_MS = 30_000;

interface State {
  platform: string;
  benchmark: BenchmarkResult | null;
  benchmarking: boolean;
  preference: PosePreference;
  cloudConsent: boolean;
  /** The relay answered `ready` (or warming) for this user; false until checked. */
  cloudReachable: boolean;
}

let state: State | undefined;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function getState(): State {
  return (state ??= {
    platform: Platform.OS,
    benchmark: loadBenchmark(),
    benchmarking: false,
    preference: loadPreference(),
    cloudConsent: loadCloudConsent(),
    cloudReachable: false,
  });
}

function update(patch: Partial<State>) {
  state = { ...getState(), ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function execute(platform: string): Promise<void> {
  update({ platform, benchmarking: true });
  try {
    const result = await runPoseBenchmark(platform);
    saveBenchmark(result);
    update({ benchmark: result, benchmarking: false });
  } catch (e) {
    // An unexpected throw (not a model load failure) is kept in memory only, so the mode settles
    // for this session (no fps: cloud prompt or unavailable) and the next launch benchmarks again.
    const message = e instanceof Error ? e.message : String(e);
    update({
      benchmarking: false,
      benchmark: { modelId: '', size: null, fps: null, meanMs: null, p95Ms: null, ranAt: Date.now(), error: message },
    });
  }
}

function run(platform: string): Promise<void> {
  const current = execute(platform).finally(() => {
    if (inflight === current) inflight = null;
  });
  inflight = current;
  return current;
}

/**
 * Benchmarks at launch unless the cached result is for the current model (`getPoseModelId()` on iOS,
 * 'none' elsewhere). Concurrent calls share one run. Completed runs are saved, model load failures included.
 */
export function startPoseBenchmark(platform: string = Platform.OS): Promise<void> {
  if (inflight) return inflight;
  let modelId: string;
  try {
    modelId = platform === 'ios' ? getPoseModelId() : 'none';
  } catch {
    // Let the run hit the same failure, so it settles through the unsaved path above.
    return run(platform);
  }
  if (getState().benchmark?.modelId === modelId) {
    if (getState().platform !== platform) update({ platform });
    return Promise.resolve();
  }
  return run(platform);
}

/** Runs the benchmark again and saves it, after any run already in progress. */
export async function rerunBenchmark(platform: string = getState().platform): Promise<void> {
  if (inflight) await inflight;
  return run(platform);
}

/** Where to check the cloud relay from; a screen with a signed-in session passes it to `usePoseMode`. */
export interface CloudCheck {
  /** The relay's WebSocket URL, from `poseStreamUrl(apiUrl)`. */
  url: string;
  getToken: () => Promise<string | null>;
  createSocket?: CreateSocket; // tests
}

/** Probes the relay and records the answer, so `selectPoseMode` can return cloud or paused. */
export async function checkCloudReachable(check: CloudCheck): Promise<boolean> {
  let reachable = false;
  try {
    const token = await check.getToken();
    reachable = token != null && (await probeCloud(check.url, token, 5000, check.createSocket));
  } catch {
    reachable = false;
  }
  if (getState().cloudReachable !== reachable) update({ cloudReachable: reachable });
  return reachable;
}

export interface PoseModeState {
  /** 'pending' while there is no benchmark result yet, unless the user picked Apple Vision. */
  mode: PoseMode | 'pending';
  benchmark: BenchmarkResult | null;
  benchmarking: boolean;
  /** YOLOv8 input size for the live detector: the size that passed, else 320. */
  size: BenchmarkSize;
  /** Cloud mode is wanted (slow phone, Android, or the user picked it) but not consented to yet (FE-15 asks). */
  needsCloudConsent: boolean;
  preference: PosePreference;
  setPreference(p: PosePreference): void;
  cloudConsent: boolean;
  setCloudConsent(c: boolean): void;
  rerunBenchmark(): Promise<void>;
}

function setPreference(preference: PosePreference) {
  savePreference(preference);
  update({ preference });
}

function setCloudConsent(cloudConsent: boolean) {
  saveCloudConsent(cloudConsent);
  update({ cloudConsent });
}

const rerun = () => rerunBenchmark();

/**
 * `cloud`: pass it where there's a signed-in session, so a phone that wants cloud mode (and has
 * consented) checks the relay now and every 30 s while it's unreachable. Without it, cloud mode
 * reads as unreachable and the phone falls back to on-device or `paused`.
 */
export function usePoseMode(cloud?: CloudCheck): PoseModeState {
  const s = useSyncExternalStore(subscribe, getState);
  const { benchmark, preference, cloudConsent } = s;
  const inputs = {
    platform: s.platform,
    coremlFps: benchmark?.fps ?? null,
    preference,
    cloudConsent,
    cloudReachable: s.cloudReachable,
  };
  // Would this phone use cloud if the user consented and the endpoint answered?
  const wantsCloud = benchmark != null && selectPoseMode({ ...inputs, cloudConsent: true, cloudReachable: true }) === 'cloud';
  const checkUrl = cloud?.url;
  const shouldCheck = Boolean(checkUrl) && cloudConsent && wantsCloud;
  const cloudRef = cloud;
  useEffect(() => {
    if (!shouldCheck || !cloudRef) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const ok = await checkCloudReachable(cloudRef);
      if (!stopped && !ok) timer = setTimeout(check, CLOUD_RECHECK_MS);
    };
    void check();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
    // Re-run when the URL changes, not on every render's new getToken closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCheck, checkUrl]);
  return {
    // Apple Vision does not depend on the YOLOv8 benchmark, so it never waits for one.
    mode: benchmark || selectPoseMode(inputs) === 'vision' ? selectPoseMode(inputs) : 'pending',
    benchmark,
    benchmarking: s.benchmarking,
    size: benchmark?.size ?? 320,
    needsCloudConsent: !cloudConsent && wantsCloud,
    preference,
    setPreference,
    cloudConsent,
    setCloudConsent,
    rerunBenchmark: rerun,
  };
}

/** Test-only: drops the in-memory state so the next read reloads from storage. */
export function __resetPoseModeForTests() {
  state = undefined;
  inflight = null;
  listeners.clear();
}
