// Form rules over closed reps, held until the set ends. Behaviour:
// docs/superpowers/specs/2026-10-10-form-rules-design.md §3–§5.

import { JOINT_NAMES } from '../pose/types';
import type {
  DetectedView,
  EffectiveSpec,
  EngineEvent,
  EngineFrame,
  ExerciseSpec,
  Flag,
  RepRecord,
  RepResult,
  Rule,
  RuleAggregate,
  RuleOutcome,
  RulePhase,
  SetEndReason,
  SetFlags,
  View,
} from './types';
import { detectView } from './view';
import { gatePasses } from './gate';
import { assertEvaluationSpec, ruleThreshold } from './validation';

/** A frame within this many degrees of the rep's extreme counts as at the extreme. */
export const NEAR_EXTREME_DEG = 1;
/** A window needs at least this share of frames with the metric, or the rule is `unmeasured`. */
export const MIN_COVERAGE = 0.5;

const jointIndex = new Map(JOINT_NAMES.map((name, i) => [name, i]));

/**
 * Time in `phase`, from the frames: the way out up to first reaching the extreme, the time at the
 * extreme, and the way back up to the count. The three add up to the rep, so a pause at the bottom
 * is `peak`, not lowering. Falls back to `rep.durations` if no frame is at the extreme.
 */
export function phaseDuration(spec: ExerciseSpec, rep: RepRecord, phase: RulePhase): number {
  if (phase === 'rep') return rep.countedAt - rep.startedAt;
  const name = spec.primary_angle.name;
  const near = rep.windows.rep.filter((f) => {
    const p = f.metrics[name];
    return f.t <= rep.countedAt && gatePasses(spec.primary_angle.gate, f.metrics) && p != null && Math.abs(p - rep.extreme) <= NEAR_EXTREME_DEG;
  });
  if (near.length === 0) return rep.durations[phase];
  const firstNear = near[0].t;
  const lastNear = near[near.length - 1].t;
  switch (phase) {
    case 'outbound':
      return firstNear - rep.startedAt;
    case 'peak':
      return lastNear - firstNear;
    case 'return':
      return rep.countedAt - lastNear;
  }
}

/** The `<base>` of every `mid_<base>` point the metric uses. */
function midBases(spec: ExerciseSpec, metric: string): string[] {
  const angle = spec.angles[metric];
  if (!angle) return [];
  const points =
    angle.type === 'joint_angle' ? angle.joints : angle.type === 'segment_tilt' ? [angle.from, angle.to] : [];
  return [...new Set(points.filter((p) => p.startsWith('mid_')).map((p) => p.slice(4)))];
}

const present = (f: EngineFrame, name: string): boolean => {
  const i = jointIndex.get(name);
  return i !== undefined && f.joints[i] != null;
};

function reduce(values: number[], how: string): number {
  switch (how) {
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    default:
      return values.reduce((s, v) => s + v, 0) / values.length;
  }
}

/** The reduced metric over the rule's window, or null when too few frames have it. */
function windowValue(spec: ExerciseSpec, rule: Rule, rep: RepRecord): number | null {
  const { metric } = rule.check;
  // The dwell can delay `peak` until after the turn. Primary-angle depth/lockout checks need
  // the accepted extreme of the movement, including outbound frames but excluding the settle tail.
  const primaryExtreme =
    rule.phase === 'peak' &&
    metric === spec.primary_angle.name &&
    rule.check.reduce === (spec.primary_angle.direction === 'decreasing' ? 'min' : 'max');
  const frames = primaryExtreme
    ? rep.windows.rep.filter((f) => f.t <= rep.countedAt && gatePasses(spec.primary_angle.gate, f.metrics))
    : rep.windows[rule.phase];
  let valid = frames.filter((f) => f.metrics[metric] != null);
  if (valid.length === 0 || valid.length < MIN_COVERAGE * frames.length) return null;
  // A `mid_` point is the mean of both sides or just the one present, so the two read differently.
  // Reduce over whichever kind most frames are; a tie keeps the two-sided frames.
  const bases = midBases(spec, metric);
  if (bases.length > 0) {
    const isTwoSided = (f: EngineFrame) => bases.every((b) => present(f, `left_${b}`) && present(f, `right_${b}`));
    const twoSided = valid.filter(isTwoSided);
    valid = twoSided.length * 2 >= valid.length ? twoSided : valid.filter((f) => !isTwoSided(f));
  }
  return reduce(
    valid.map((f) => f.metrics[metric] as number),
    rule.check.reduce ?? 'mean',
  );
}

function holds(value: number, op: Rule['check']['op'], threshold: number): boolean {
  switch (op) {
    case '<=':
      return value <= threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '>':
      return value > threshold;
  }
}

/** One rule on one rep. `spec` is the effective spec, so threshold names read its phases. */
export function evaluateRule(spec: ExerciseSpec, rule: Rule, rep: RepRecord, view: DetectedView): RuleOutcome {
  const threshold = ruleThreshold(spec, rule);
  const base = { rule_id: rule.id, threshold };
  if (rule.view !== 'any' && rule.view !== view) return { ...base, status: 'skipped_view', value: null };
  const value =
    rule.check.metric === 'duration_ms' ? phaseDuration(spec, rep, rule.phase) : windowValue(spec, rule, rep);
  if (value === null) return { ...base, status: 'unmeasured', value: null };
  return { ...base, status: holds(value, rule.check.op, threshold) ? 'pass' : 'flag', value };
}

/** Every rule of `spec` on one rep. The view is the caller's, else detected from the rep's frames. */
export function evaluateRep(spec: ExerciseSpec, rep: RepRecord, opts: { view?: View } = {}): RepResult {
  const view: DetectedView = opts.view ?? detectView(rep.windows.rep, rep.imageAspect);
  const rep_index = rep.index - 1;
  const outcomes = spec.rules.map((rule) => evaluateRule(spec, rule, rep, view));
  const flags: Flag[] = [];
  const tint: string[] = [];
  spec.rules.forEach((rule, i) => {
    if (outcomes[i].status !== 'flag') return;
    flags.push({ rule_id: rule.id, severity: rule.severity, rep_index });
    for (const j of rule.joints) if (!tint.includes(j)) tint.push(j);
  });
  return {
    rep_index,
    view,
    view_source: opts.view ? 'caller' : 'detected',
    flags,
    outcomes,
    tint_joints: tint,
  };
}

export type RulesEvent = { type: 'rep_evaluated'; result: RepResult } | { type: 'set_flags'; set: SetFlags };

export interface SetRules {
  /** Feed every engine event. Returns what it produced, or null. */
  handle(e: EngineEvent): RulesEvent | null;
  /** Null until `set_ended`. */
  summary(): SetFlags | null;
  reset(): void;
}

/** Evaluates each closed rep and holds the results until the set ends; then ignores events until `reset`. */
export function createSetRules(spec: ExerciseSpec | EffectiveSpec, opts: { view?: View } = {}): SetRules {
  assertEvaluationSpec(spec);
  let reps: RepResult[] = [];
  let summary: SetFlags | null = null;
  return {
    handle(e) {
      if (summary) return null;
      if (e.type === 'rep_closed') {
        const result = evaluateRep(spec, e.rep, opts);
        reps.push(result);
        return { type: 'rep_evaluated', result };
      }
      if (e.type === 'set_ended') {
        summary = summarizeSet(spec, reps, e.reason);
        return { type: 'set_flags', set: summary };
      }
      return null;
    },
    summary: () => summary,
    reset() {
      reps = [];
      summary = null;
    },
  };
}

/** The held flags and one aggregate per rule, for the rest note and AI-08. */
export function summarizeSet(
  spec: ExerciseSpec | EffectiveSpec,
  reps: RepResult[],
  reason: SetEndReason,
): SetFlags {
  const rules: RuleAggregate[] = spec.rules.map((rule) => {
    const outcomes = reps.flatMap((r) => r.outcomes.filter((o) => o.rule_id === rule.id));
    const flagged = outcomes.filter((o) => o.status === 'flag').map((o) => o.value as number);
    return {
      rule_id: rule.id,
      severity: rule.severity,
      priority: rule.priority,
      n: flagged.length,
      evaluated: outcomes.filter((o) => o.status === 'pass' || o.status === 'flag').length,
      mean_value: flagged.length ? flagged.reduce((s, v) => s + v, 0) / flagged.length : null,
    };
  });
  const top = rules.filter((a) => a.n > 0).reduce<RuleAggregate | null>(
    (best, a) => (
      best === null || (a.severity === 'safety' && best.severity !== 'safety') ||
      (a.severity === best.severity && a.priority < best.priority) ? a : best
    ),
    null,
  );
  return {
    exercise_id: spec.id,
    reason,
    total_reps: reps.length,
    clean_reps: reps.filter((r) => r.flags.length === 0).length,
    flags: reps.flatMap((r) => r.flags),
    reps,
    rules,
    top,
    extra_notes: 'extra_notes' in spec ? [...spec.extra_notes] : [],
  };
}

/** An integer from 10 up, otherwise up to 2 decimals with trailing zeros dropped. */
export function formatValue(v: number): string {
  return String(Math.abs(v) >= 10 ? Math.round(v) : Number(v.toFixed(2)));
}

/** Fills `{n}`, `{total}`, `{value}` and `{t}` (seconds to 0.1, `.0` dropped). */
export function fillRestNote(note: string, agg: RuleAggregate, totalReps: number): string {
  const mean = agg.mean_value;
  return note
    .replaceAll('{n}', String(agg.n))
    .replaceAll('{total}', String(totalReps))
    .replaceAll('{value}', mean === null ? '' : formatValue(mean))
    .replaceAll('{t}', mean === null ? '' : String(Number((mean / 1000).toFixed(1))));
}

/** The top rule's filled `rest_note` and the injury notes, or null when every rep was clean. */
export function restNote(spec: ExerciseSpec | EffectiveSpec, set: SetFlags): string | null {
  const { top } = set;
  if (!top) return null;
  const rule = spec.rules.find((r) => r.id === top.rule_id);
  const note = rule ? fillRestNote(rule.rest_note, top, set.total_reps) : '';
  return [note, ...set.extra_notes].filter((s) => s !== '').join(' ');
}
