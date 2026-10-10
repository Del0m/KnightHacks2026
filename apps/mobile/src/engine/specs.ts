// The bundled exercise specs. Metro reaches <repo>/specs through `watchFolders` (metro.config.js).
// JSON imports type as plain strings, so the cast goes through `unknown`; `node specs/validate.mjs`
// checks the files against schema.json, which these types mirror.

import bicepCurl from '../../../../specs/exercises/bicep_curl.json';
import lunge from '../../../../specs/exercises/lunge.json';
import pushUp from '../../../../specs/exercises/push_up.json';
import shoulderPress from '../../../../specs/exercises/shoulder_press.json';
import squat from '../../../../specs/exercises/squat.json';
import type { ExerciseSpec } from './types';

export const EXERCISE_SPECS = [squat, pushUp, bicepCurl, shoulderPress, lunge] as unknown as readonly ExerciseSpec[];

/** The bundled spec with this id, or undefined. */
export function getSpec(id: string): ExerciseSpec | undefined {
  return EXERCISE_SPECS.find((s) => s.id === id);
}
