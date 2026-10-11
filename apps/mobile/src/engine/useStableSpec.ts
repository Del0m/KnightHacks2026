import { useMemo } from 'react';
import type { ExerciseSpec } from './types';

/** Keep equivalent effective specs stable, including reordered object keys; real limit changes reset. */
export function useStableSpec(input: ExerciseSpec | null): { spec: ExerciseSpec | null; error: Error | null } {
  let key: string | Error;
  try {
    key = JSON.stringify(input, (_name, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))
        : value,
    );
  } catch (cause) {
    key = cause instanceof Error ? cause : new Error(String(cause));
  }
  return useMemo(() => typeof key === 'string'
    ? { spec: JSON.parse(key) as ExerciseSpec | null, error: null }
    : { spec: null, error: key }, [key]);
}
