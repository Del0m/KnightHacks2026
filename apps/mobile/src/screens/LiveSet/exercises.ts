import { EXERCISE_SPECS, getSpec } from '@/engine/specs';
const aliases: Record<string, string> = { curl: 'bicep_curl', press: 'shoulder_press' };
export const cameraExercises = EXERCISE_SPECS.map(spec => ({ id: spec.id, label: spec.name }));
export function cameraSpec(id?: string) { return getSpec(aliases[id ?? ''] ?? id ?? '') ?? getSpec('bicep_curl')!; }
