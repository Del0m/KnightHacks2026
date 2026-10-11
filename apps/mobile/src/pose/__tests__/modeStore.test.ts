import { createMMKV } from 'react-native-mmkv';
import {
  __clearPoseStoreForTests,
  loadBenchmark,
  loadCloudConsent,
  loadPreference,
  saveBenchmark,
  saveCloudConsent,
  savePreference,
} from '../modeStore';
import type { BenchmarkResult } from '../benchmark';

const result: BenchmarkResult = { modelId: 'model-a', size: 320, fps: 90, meanMs: 9, p95Ms: 11, ranAt: 1, error: null };

describe('modeStore', () => {
  beforeEach(() => __clearPoseStoreForTests());

  it('defaults when nothing is saved', () => {
    expect(loadBenchmark()).toBeNull();
    expect(loadPreference()).toBe('auto');
    expect(loadCloudConsent('user-1')).toBe(false);
    expect(loadCloudConsent(null)).toBe(false);
  });

  it('round-trips each value', () => {
    saveBenchmark(result);
    savePreference('vision');
    saveCloudConsent('user-1', true);
    expect(loadBenchmark()).toEqual(result);
    expect(loadPreference()).toBe('vision');
    expect(loadCloudConsent('user-1')).toBe(true);
  });

  it('keeps cloud consent per account', () => {
    saveCloudConsent('user-1', true);
    expect(loadCloudConsent('user-2')).toBe(false);
    expect(createMMKV({ id: 'pose' }).getBoolean('cloudConsent:user-1')).toBe(true);
    saveCloudConsent('user-1', false);
    expect(loadCloudConsent('user-1')).toBe(false);
  });

  it('never reads the old device-wide consent as a grant', () => {
    createMMKV({ id: 'pose' }).set('cloudConsent', true);
    expect(loadCloudConsent('user-1')).toBe(false);
    expect(loadCloudConsent(null)).toBe(false);
  });

  it('ignores corrupt or unknown values', () => {
    const raw = createMMKV({ id: 'pose' });
    raw.set('benchmark', '{not json');
    raw.set('preference', 'turbo');
    expect(loadBenchmark()).toBeNull();
    expect(loadPreference()).toBe('auto');
    raw.set('benchmark', '{"fps":3}');
    expect(loadBenchmark()).toBeNull();
  });
});
