// Injury overrides: the spec as it applies to a user's injuries. A port of `applyOverride` and
// `applyInjuries` in specs/validate.mjs; __tests__/overrides.test.ts checks both give the same
// output for every bundled spec. Contract: docs/superpowers/specs/2026-10-10-form-rules-design.md §1.

import type { CompareOp, EffectiveSpec, ExerciseSpec, Injury, InjuryOverride, Phases } from './types';

/** The order overrides are applied in. */
export const INJURY_ORDER: readonly Injury[] = ['knee', 'shoulder', 'lower_back'];

type RulePatch = NonNullable<InjuryOverride['rules']>[string];

interface MergedOverride {
  phases: Partial<Phases>;
  rules: Record<string, RulePatch>;
  disable_rules: string[];
}

/** Applies one override object: phases merged, rule patches applied, disabled rules removed. */
function patchSpec(spec: ExerciseSpec, override: Partial<MergedOverride>): ExerciseSpec {
  const disabled = new Set(override.disable_rules ?? []);
  const patches = override.rules ?? {};
  return {
    ...spec,
    phases: { ...spec.phases, ...override.phases },
    rules: spec.rules
      .filter((rule) => !disabled.has(rule.id))
      .map((rule) => {
        const patch = patches[rule.id];
        if (!patch) return rule;
        const { value, ...rest } = patch;
        return {
          ...rule,
          ...rest,
          check: value === undefined ? rule.check : { ...rule.check, value },
        };
      }),
  };
}

/**
 * The spec as it applies to a user with one injury: phases merged, rule patches applied,
 * disabled rules removed. Does not mutate `spec`.
 */
export function applyOverride(spec: ExerciseSpec, injury: Injury): ExerciseSpec {
  return patchSpec(spec, spec.injury_overrides[injury] ?? {});
}

/** Phase keys where the override asking for less range wins. */
const RANGE_KEYS = new Set<string>(['count_min', 'target']);

/** True when `later` should replace `earlier` as a rule's numeric `value` (ties go to `later`). */
function stricterOrEqual(op: CompareOp | undefined, earlier: number, later: number): boolean {
  return op === '>=' || op === '>' ? later >= earlier : later <= earlier;
}

/**
 * Folds several overrides (already in INJURY_ORDER) into one, keeping the more conservative value
 * wherever two of them set the same thing. See applyInjuries.
 */
function mergeOverrides(spec: ExerciseSpec, overrides: Partial<InjuryOverride>[]): MergedOverride {
  const decreasing = spec.primary_angle.direction === 'decreasing';
  const phases: Partial<Record<keyof Phases, number>> = {};
  const rules: Record<string, RulePatch> = {};
  const valueFrom: Record<string, RulePatch> = {}; // rule id -> the patch whose value won
  const latestNote: Record<string, string> = {}; // rule id -> the last rest_note set
  const disabled = new Set<string>();

  for (const override of overrides) {
    for (const [key, v] of Object.entries(override.phases ?? {}) as [keyof Phases, number][]) {
      const earlier = phases[key];
      if (earlier !== undefined && RANGE_KEYS.has(key)) {
        phases[key] = decreasing ? Math.max(earlier, v) : Math.min(earlier, v);
      } else {
        phases[key] = v;
      }
    }
    for (const [id, patch] of Object.entries(override.rules ?? {})) {
      const merged = (rules[id] ??= {});
      if (patch.value !== undefined) {
        const op = spec.rules.find((r) => r.id === id)?.check.op;
        const bothNumbers = typeof merged.value === 'number' && typeof patch.value === 'number';
        if (!bothNumbers || stricterOrEqual(op, merged.value as number, patch.value as number)) {
          merged.value = patch.value;
          valueFrom[id] = patch;
        }
      }
      if (patch.severity !== undefined && merged.severity !== 'safety') merged.severity = patch.severity;
      if (patch.rest_note !== undefined) latestNote[id] = patch.rest_note;
    }
    for (const id of override.disable_rules ?? []) disabled.add(id);
  }

  for (const [id, merged] of Object.entries(rules)) {
    const note = valueFrom[id]?.rest_note ?? latestNote[id];
    if (note !== undefined) merged.rest_note = note;
  }
  return { phases, rules, disable_rules: [...disabled] };
}

/**
 * The spec as it applies to a user with any set of injuries. Injuries are deduped and applied in
 * INJURY_ORDER. Where two overrides set the same thing, the more conservative one wins:
 * - `count_min` / `target`: less range (the larger for decreasing, the smaller for increasing).
 *   Other phase keys: the later override.
 * - a rule's `value`: when both are numbers, the stricter bound for the rule's `op` (larger for
 *   `>=` and `>`, smaller for `<=` and `<`); a threshold name on either side, the later override.
 * - `severity`: `safety` if any override says so. `rest_note`: the note from the override whose
 *   `value` won, else the latest note set.
 * - `disable_rules`: the union. `extra_notes`: every applied override's `extra_note`, in order.
 * With one injury, `phases` and `rules` equal applyOverride. Does not mutate `spec`.
 */
export function applyInjuries(spec: ExerciseSpec, injuries: readonly Injury[]): EffectiveSpec {
  const applied = INJURY_ORDER.filter((injury) => injuries.includes(injury));
  const overrides: Partial<InjuryOverride>[] = applied.map((injury) => spec.injury_overrides[injury] ?? {});
  const { phases, rules } = patchSpec(spec, mergeOverrides(spec, overrides));
  return {
    ...spec,
    phases,
    rules,
    injuries: applied,
    extra_notes: overrides.map((o) => o.extra_note).filter((note): note is string => note !== undefined),
  };
}
