// Pose mode hook (AI-04, Architecture §4.1): the cached benchmark plus the user's preference and
// this account's cloud consent, fed through `selectPoseMode`. One module-level store, shared by every caller.
import { useCallback, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getPoseModelId } from 'steadyforum-pose';
import { runPoseBenchmark, type BenchmarkResult, type BenchmarkSize } from './benchmark';
import { selectPoseMode, type PoseMode, type PosePreference } from './mode';
import {
  loadBenchmark,
  loadCloudConsent,
  loadPreference,
  saveBenchmark,
  saveCloudConsent,
  savePreference,
} from './modeStore';

interface State {
  platform: string;
  benchmark: BenchmarkResult | null;
  benchmarking: boolean;
  preference: PosePreference;
  /** Consent per account id, read from storage on first use. */
  consents: Record<string, boolean>;
  /** The cloud transport's last report (`reportCloudAvailability`); false until it connects. */
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
    consents: {},
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

/**
 * The camera screens wire this to `CloudConfig.onAvailability`: true once the relay is ready or a
 * fresh pose arrives, false after any failure. It moves the mode between `cloud` and `paused`; both
 * keep the transport running, so it can recover while paused.
 */
export function reportCloudAvailability(available: boolean): void {
  if (getState().cloudReachable !== available) update({ cloudReachable: available });
}

export interface PoseModeState {
  /** 'pending' while there is no benchmark result yet, unless the user picked Apple Vision. */
  mode: PoseMode | 'pending';
  benchmark: BenchmarkResult | null;
  benchmarking: boolean;
  /** YOLOv8 input size for the live detector: the size that passed, else 320. */
  size: BenchmarkSize;
  /** Cloud mode is wanted (slow phone, Android, or the user picked it) but this account hasn't consented. */
  needsCloudConsent: boolean;
  preference: PosePreference;
  setPreference(p: PosePreference): void;
  /** This account's consent; false with no account. */
  cloudConsent: boolean;
  /** Saves consent for this account; does nothing with no account. */
  setCloudConsent(c: boolean): void;
  rerunBenchmark(): Promise<void>;
}

function setPreference(preference: PosePreference) {
  savePreference(preference);
  update({ preference });
}

function setCloudConsent(userId: string, consent: boolean) {
  saveCloudConsent(userId, consent);
  update({ consents: { ...getState().consents, [userId]: consent } });
}

const rerun = () => rerunBenchmark();

/** `accountId`: the signed-in user; consent is per account, and with no account it is false. */
export function usePoseMode(accountId?: string | null): PoseModeState {
  const s = useSyncExternalStore(subscribe, getState);
  const { benchmark, preference } = s;
  const cloudConsent = accountId ? s.consents[accountId] ?? loadCloudConsent(accountId) : false;
  const inputs = {
    platform: s.platform,
    coremlFps: benchmark?.fps ?? null,
    preference,
    cloudConsent,
    cloudReachable: s.cloudReachable,
  };
  // Would this phone use cloud if the user consented and the endpoint answered?
  const wantsCloud = benchmark != null && selectPoseMode({ ...inputs, cloudConsent: true, cloudReachable: true }) === 'cloud';
  const setConsent = useCallback((c: boolean) => { if (accountId) setCloudConsent(accountId, c); }, [accountId]);
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
    setCloudConsent: setConsent,
    rerunBenchmark: rerun,
  };
}

/** Test-only: drops the in-memory state so the next read reloads from storage. */
export function __resetPoseModeForTests() {
  state = undefined;
  inflight = null;
  listeners.clear();
}
