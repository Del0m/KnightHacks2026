// Persisted pose mode inputs (AI-04): the cached benchmark, the user's preference and cloud consent.
// MMKV reads are synchronous, so the mode is known on the first render after launch.
import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { BenchmarkResult } from './benchmark';
import type { PosePreference } from './mode';

const KEYS = { benchmark: 'benchmark', preference: 'preference', cloudConsent: 'cloudConsent' } as const;
const PREFERENCES: readonly PosePreference[] = ['auto', 'cloud', 'vision'];

let storage: MMKV | undefined;
const store = (): MMKV => (storage ??= createMMKV({ id: 'pose' }));

/** The cached benchmark; null when none is saved or the JSON is unreadable. */
export function loadBenchmark(): BenchmarkResult | null {
  const json = store().getString(KEYS.benchmark);
  if (json == null) return null;
  try {
    const value = JSON.parse(json);
    return value != null && typeof value === 'object' && typeof value.modelId === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function saveBenchmark(result: BenchmarkResult): void {
  store().set(KEYS.benchmark, JSON.stringify(result));
}

/** Defaults to 'auto'. */
export function loadPreference(): PosePreference {
  const value = store().getString(KEYS.preference);
  return PREFERENCES.includes(value as PosePreference) ? (value as PosePreference) : 'auto';
}

export function savePreference(preference: PosePreference): void {
  store().set(KEYS.preference, preference);
}

/** Defaults to false. */
export function loadCloudConsent(): boolean {
  return store().getBoolean(KEYS.cloudConsent) ?? false;
}

export function saveCloudConsent(consent: boolean): void {
  store().set(KEYS.cloudConsent, consent);
}

/** Test-only: wipes the store. */
export function __clearPoseStoreForTests(): void {
  store().clearAll();
}
