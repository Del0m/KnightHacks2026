// Persisted pose mode inputs (AI-04): the cached benchmark, the user's preference and cloud consent.
// MMKV reads are synchronous, so the mode is known on the first render after launch. Consent is per
// account (`cloudConsent:<userId>`, AI-17); the old device-wide `cloudConsent` key is never read.
import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { BenchmarkResult } from './benchmark';
import type { PosePreference } from './mode';

const KEYS = { benchmark: 'benchmark', preference: 'preference' } as const;
const consentKey = (userId: string) => `cloudConsent:${userId}`;
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

/** This account agreed to send frames to the cloud endpoint. False without an account. */
export function loadCloudConsent(userId: string | null | undefined): boolean {
  return userId ? store().getBoolean(consentKey(userId)) ?? false : false;
}

export function saveCloudConsent(userId: string, consent: boolean): void {
  store().set(consentKey(userId), consent);
}

/** Test-only: wipes the store. */
export function __clearPoseStoreForTests(): void {
  store().clearAll();
}
