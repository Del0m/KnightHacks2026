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
    expect(loadCloudConsent()).toBe(false);
  });

  it('round-trips each value', () => {
    saveBenchmark(result);
    savePreference('vision');
    saveCloudConsent(true);
    expect(loadBenchmark()).toEqual(result);
    expect(loadPreference()).toBe('vision');
    expect(loadCloudConsent()).toBe(true);
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
