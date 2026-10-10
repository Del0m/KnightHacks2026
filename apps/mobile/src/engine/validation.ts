import type { ExerciseSpec, Rule } from './types';

const THRESHOLDS = ['start_exit', 'count_min', 'target', 'start_enter'] as const;
const OPS = ['<=', '>=', '<', '>'];
const REDUCERS = ['min', 'max', 'mean', 'first', 'last'];
const PHASES = ['outbound', 'peak', 'return', 'rep'];

function requireSpec(ok: boolean, path: string, problem: string): asserts ok {
  if (!ok) throw new Error(`Invalid exercise spec: ${path}: ${problem}`);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const owns = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Validate a check before comparing, including direct evaluateRule callers and view-skipped rules. */
export function ruleThreshold(spec: ExerciseSpec, rule: Rule): number {
  const path = `rules.${rule.id}.check`;
  const check = rule.check;
  requireSpec(check != null, path, 'required');
  requireSpec(PHASES.includes(rule.phase), `rules.${rule.id}.phase`, 'unknown phase');
  requireSpec(OPS.includes(check.op), `${path}.op`, 'unknown comparison');
  requireSpec(
    check.metric === 'duration_ms' || owns(spec.angles ?? {}, check.metric),
    `${path}.metric`, 'unknown metric',
  );
  requireSpec(
    check.metric === 'duration_ms' ? check.reduce === undefined : REDUCERS.includes(check.reduce ?? 'mean'),
    `${path}.reduce`, 'invalid reduction',
  );
  const value = check.value;
  if (typeof value === 'number') {
    requireSpec(finite(value), `${path}.value`, 'must be finite');
    return value;
  }
  requireSpec(THRESHOLDS.includes(value), `${path}.value`, 'unknown threshold name');
  const threshold = spec.phases?.[value];
  requireSpec(finite(threshold), `phases.${value}`, `must be finite (referenced by ${path}.value)`);
  return threshold;
}

/** Runtime evaluation checks for effective specs; authoring/schema/tone checks stay in validate.mjs. */
export function assertEvaluationSpec(spec: ExerciseSpec): void {
  requireSpec(spec != null, '/', 'required');
  const primary = spec.primary_angle;
  requireSpec(primary != null, 'primary_angle', 'required');
  requireSpec(primary.direction === 'increasing' || primary.direction === 'decreasing', 'primary_angle.direction', 'unknown direction');
  requireSpec(
    owns(spec.angles ?? {}, primary.name) && spec.angles[primary.name]?.type === 'joint_angle',
    'primary_angle.name', 'must reference a joint_angle',
  );
  for (const key of THRESHOLDS) {
    const value = spec.phases?.[key];
    requireSpec(finite(value) && value >= 0 && value <= 180, `phases.${key}`, 'must be finite and between 0 and 180');
  }
  for (const key of ['reverse_deg', 'set_end_still_ms'] as const) {
    const value = spec.phases?.[key];
    requireSpec(finite(value) && value > 0, `phases.${key}`, 'must be finite and positive');
  }
  requireSpec(Number.isInteger(spec.phases?.min_state_ms) && spec.phases.min_state_ms >= 0, 'phases.min_state_ms', 'must be a nonnegative integer');
  const { target, count_min: countMin, start_exit: exit, start_enter: enter } = spec.phases;
  const ordered = primary.direction === 'decreasing'
    ? target <= countMin && countMin < exit && exit < enter
    : target >= countMin && countMin > exit && exit > enter;
  requireSpec(ordered, 'phases', 'threshold order does not match primary direction');
  if (primary.gate !== undefined) {
    const gate = primary.gate;
    requireSpec(gate != null, 'primary_angle.gate', 'must be a gate object');
    requireSpec(gate.metric !== primary.name && gate.metric !== 'duration_ms' && owns(spec.angles ?? {}, gate.metric), 'primary_angle.gate.metric', 'must reference another angle');
    requireSpec(OPS.includes(gate.op), 'primary_angle.gate.op', 'unknown comparison');
    requireSpec(finite(gate.value), 'primary_angle.gate.value', 'must be finite');
  }
  requireSpec(Array.isArray(spec.rules), 'rules', 'must be an array');
  for (const rule of spec.rules) {
    requireSpec(rule != null, 'rules', 'each rule must be an object');
    ruleThreshold(spec, rule);
  }
}
