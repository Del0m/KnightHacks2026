import { createFormEngine } from '../engine';
import { applyInjuries } from '../overrides';
import { createSetRules, evaluateRule } from '../rules';
import { EXERCISE_SPECS, getSpec } from '../specs';
import type { ExerciseSpec, Phases, RepRecord } from '../types';
import { assertEvaluationSpec } from '../validation';

const squat = (): ExerciseSpec => JSON.parse(JSON.stringify(getSpec('squat')));

describe('runtime evaluation validation', () => {
  it('accepts every bundled spec and every effective injury combination', () => {
    for (const spec of EXERCISE_SPECS) {
      expect(() => assertEvaluationSpec(spec)).not.toThrow();
      for (let mask = 0; mask < 8; mask++) {
        const injuries = (['knee', 'shoulder', 'lower_back'] as const).filter((_, i) => mask & (1 << i));
        expect(() => assertEvaluationSpec(applyInjuries(spec, injuries))).not.toThrow();
      }
    }
  });

  it.each([createFormEngine, createSetRules])('rejects a missing target before starting evaluation (%#)', (create) => {
    const spec = squat();
    delete (spec.phases as Partial<Phases>).target;
    expect(() => create(spec)).toThrow(/Invalid exercise spec: phases.target/);
  });

  it.each([undefined, null, '95', NaN, Infinity, -Infinity])('rejects a non-finite phase threshold: %s', (target) => {
    const spec = squat();
    Object.assign(spec.phases, { target });
    expect(() => assertEvaluationSpec(spec)).toThrow(/phases.target/);
  });

  it('rejects invalid effective threshold order', () => {
    const spec = squat();
    spec.phases.target = 150;
    expect(() => createFormEngine(spec)).toThrow(/threshold order/);
  });

  it('accepts the schema-supported zero minimum state time', () => {
    const spec = squat();
    spec.phases.min_state_ms = 0;
    expect(() => assertEvaluationSpec(spec)).not.toThrow();
  });

  it.each([
    ['unknown metric', (s: ExerciseSpec) => { s.rules[0].check.metric = 'missing'; }, /check.metric/],
    ['unknown threshold', (s: ExerciseSpec) => { Object.assign(s.rules[0].check, { value: 'missing' }); }, /check.value/],
    ['non-finite literal', (s: ExerciseSpec) => { s.rules[0].check.value = NaN; }, /check.value/],
    ['unknown comparison', (s: ExerciseSpec) => { Object.assign(s.rules[0].check, { op: '==' }); }, /check.op/],
    ['unknown reduction', (s: ExerciseSpec) => { Object.assign(s.rules[0].check, { reduce: 'median' }); }, /check.reduce/],
    ['unknown phase', (s: ExerciseSpec) => { Object.assign(s.rules[0], { phase: 'missing' }); }, /rules.depth.phase/],
    ['missing primary', (s: ExerciseSpec) => { s.primary_angle.name = 'missing'; }, /primary_angle.name/],
    ['unknown gate', (s: ExerciseSpec) => { s.primary_angle.gate = { metric: 'missing', op: '<=', value: 60 }; }, /gate.metric/],
    ['non-finite gate', (s: ExerciseSpec) => { s.primary_angle.gate = { metric: 'trunk', op: '<=', value: Infinity }; }, /gate.value/],
  ] as const)('rejects %s', (_name, change, error) => {
    const spec = squat();
    change(spec);
    expect(() => createSetRules(spec)).toThrow(error);
  });

  it.each(['side', 'front'] as const)('direct evaluation rejects missing target, even in %s view', (view) => {
    const spec = squat();
    delete (spec.phases as Partial<Phases>).target;
    // No frame should be accessed, compared or converted to a flag for an invalid threshold.
    expect(() => evaluateRule(spec, spec.rules[0], {} as RepRecord, view)).toThrow(/phases.target/);
  });

  it('rechecks thresholds when the spec is mutated after rule creation', () => {
    const spec = squat();
    const rules = createSetRules(spec);
    delete (spec.phases as Partial<Phases>).target;
    expect(() => rules.handle({ type: 'rep_closed', t: 0, rep: { index: 1, windows: { rep: [] } } as unknown as RepRecord })).toThrow(/phases.target/);
  });
});
