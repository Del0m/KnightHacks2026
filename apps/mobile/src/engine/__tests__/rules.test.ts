import { JOINT_NAMES } from '../../pose/types';
import {
  createSetRules,
  evaluateRep,
  evaluateRule,
  fillRestNote,
  formatValue,
  phaseDuration,
  restNote,
  summarizeSet,
} from '../rules';
import type {
  CompareOp,
  EffectiveSpec,
  EngineEvent,
  EngineFrame,
  ExerciseSpec,
  Metrics,
  Reduce,
  RepRecord,
  Rule,
  RuleAggregate,
} from '../types';

const rule = (id: string, over: Omit<Partial<Rule>, 'check'> & { check?: Partial<Rule['check']> } = {}): Rule => ({
  id,
  phase: 'peak',
  view: 'any',
  severity: 'form',
  priority: 1,
  label: id,
  joints: [],
  rest_note: `${id} note`,
  ...over,
  check: { metric: 'knee', reduce: 'min', op: '<=', value: 'target', ...over.check },
});

const makeSpec = (rules: Rule[]): ExerciseSpec => ({
  spec_version: 1,
  id: 'test',
  name: 'Test',
  recommended_view: 'side',
  angles: {
    knee: { type: 'joint_angle', joints: ['hip', 'knee', 'ankle'] },
    trunk: { type: 'segment_tilt', from: 'mid_hip', to: 'mid_shoulder' },
    width: { type: 'width_ratio', numerator: ['left_knee', 'right_knee'], denominator: ['left_ankle', 'right_ankle'] },
  },
  primary_angle: { name: 'knee', direction: 'decreasing' },
  phases: { start_exit: 160, count_min: 135, target: 95, start_enter: 165, reverse_deg: 5, min_state_ms: 150, set_end_still_ms: 8000 },
  rules,
  injury_overrides: { knee: { extra_note: 'k' }, shoulder: { extra_note: 's' }, lower_back: { extra_note: 'b' } },
});

/** Side-on joints: left and right overlap, shoulders above hips. `drop` removes joints. */
const sideJoints = (drop: string[] = []) =>
  JOINT_NAMES.map((n) =>
    drop.includes(n) ? null : { x: 0.5, y: n.endsWith('shoulder') ? 0.3 : n.endsWith('hip') ? 0.6 : 0.5, c: 0.9 },
  );

/** Square-on joints: shoulders and hips spread across the image. */
const frontJoints = () =>
  JOINT_NAMES.map((n) => {
    const s = n.startsWith('left_') ? 1 : n.startsWith('right_') ? -1 : 0;
    return { x: 0.5 + s * 0.15, y: n.endsWith('shoulder') ? 0.3 : n.endsWith('hip') ? 0.6 : 0.5, c: 0.9 };
  });

interface Sample {
  t: number;
  phase: 'outbound' | 'peak' | 'return';
  m: Metrics;
  drop?: string[];
  front?: boolean;
}

const toFrame = (s: Sample): EngineFrame => ({
  t: s.t,
  metrics: s.m,
  sides: {},
  joints: s.front ? frontJoints() : sideJoints(s.drop),
});

/** A rep from samples in time order. `extreme` is the lowest knee; timing defaults to the first and last frame. */
function makeRep(samples: Sample[], over: Partial<RepRecord> = {}): RepRecord {
  const frames = samples.map(toFrame);
  const of = (p: Sample['phase']) => frames.filter((_, i) => samples[i].phase === p);
  const knees = samples.flatMap((s) => (s.m.knee == null ? [] : [s.m.knee]));
  const t0 = samples[0]?.t ?? 0;
  const t1 = samples.at(-1)?.t ?? 0;
  return {
    index: 1,
    startedAt: t0,
    peakAt: t0,
    returnAt: t0,
    countedAt: t1,
    closedAt: t1,
    extreme: knees.length ? Math.min(...knees) : 0,
    durations: { outbound: 11, peak: 22, return: 33, rep: t1 - t0 },
    windows: { outbound: of('outbound'), peak: of('peak'), return: of('return'), rep: frames },
    side: 'left',
    imageAspect: 1,
    ...over,
  };
}

/** A rep whose peak window holds these metric values, one frame each. */
const peakRep = (values: (Metrics | number)[], over: Partial<RepRecord> = {}) =>
  makeRep(
    values.map((v, i) => ({ t: i * 100, phase: 'peak', m: typeof v === 'number' ? { knee: v } : v })),
    over,
  );

describe('phaseDuration', () => {
  const spec = makeSpec([]);
  // Down to 90°, a pause there (within 1°), back up, counted at 900, then a settle frame.
  const knees: [number, Sample['phase'], number][] = [
    [0, 'outbound', 160], [100, 'outbound', 140], [200, 'outbound', 120], [300, 'peak', 100],
    [400, 'peak', 90], [500, 'peak', 90.8], [600, 'peak', 90.5], [700, 'return', 110],
    [800, 'return', 140], [900, 'return', 166], [1000, 'return', 90.5],
  ];
  const rep = makeRep(knees.map(([t, phase, knee]) => ({ t, phase, m: { knee } })), { countedAt: 900 });

  it('splits the rep at the first and last frame near the extreme', () => {
    expect(phaseDuration(spec, rep, 'outbound')).toBe(400);
    expect(phaseDuration(spec, rep, 'peak')).toBe(200);
    expect(phaseDuration(spec, rep, 'return')).toBe(300);
    expect(phaseDuration(spec, rep, 'rep')).toBe(900);
  });

  it('adds up to the rep, with a bottom pause counted as peak', () => {
    const sum = (['outbound', 'peak', 'return'] as const).reduce((s, p) => s + phaseDuration(spec, rep, p), 0);
    expect(sum).toBe(phaseDuration(spec, rep, 'rep'));
  });

  it('falls back to the engine durations when no frame is near the extreme', () => {
    const odd = { ...rep, extreme: 50 };
    expect(phaseDuration(spec, odd, 'outbound')).toBe(11);
    expect(phaseDuration(spec, odd, 'peak')).toBe(22);
    expect(phaseDuration(spec, odd, 'return')).toBe(33);
    expect(phaseDuration(spec, odd, 'rep')).toBe(900);
  });

  it('feeds duration_ms rules for every phase', () => {
    for (const [phase, ms] of [['outbound', 400], ['peak', 200], ['return', 300], ['rep', 900]] as const) {
      const r = rule('tempo', { phase, check: { metric: 'duration_ms', reduce: undefined, op: '>=', value: 800 } });
      expect(evaluateRule(spec, r, rep, 'side')).toEqual({ rule_id: 'tempo', status: ms >= 800 ? 'pass' : 'flag', value: ms, threshold: 800 });
    }
  });
});

describe('evaluateRule', () => {
  const spec = makeSpec([]);

  it('gates on the view; unknown runs only "any" rules', () => {
    const rep = peakRep([90, 91, 92]);
    for (const view of ['front', 'side', 'unknown'] as const) {
      for (const rv of ['front', 'side', 'any'] as const) {
        const out = evaluateRule(spec, rule('r', { view: rv }), rep, view);
        const runs = rv === 'any' || rv === view;
        expect(out.status).toBe(runs ? 'pass' : 'skipped_view');
        expect(out.value).toBe(runs ? 90 : null);
        expect(out.threshold).toBe(95);
      }
    }
  });

  it('resolves threshold names from the spec phases', () => {
    const rep = peakRep([100]);
    const names = { start_exit: 160, count_min: 135, target: 95, start_enter: 165 } as const;
    for (const [name, v] of Object.entries(names)) {
      expect(evaluateRule(spec, rule('r', { check: { value: name as keyof typeof names } }), rep, 'side').threshold).toBe(v);
    }
    // Overrides land in `phases`, so an effective spec's target is what counts.
    const eased = { ...spec, phases: { ...spec.phases, target: 105 } };
    expect(evaluateRule(spec, rule('r'), rep, 'side').status).toBe('flag');
    expect(evaluateRule(eased, rule('r'), rep, 'side')).toMatchObject({ status: 'pass', threshold: 105 });
  });

  it('applies every op with no tolerance', () => {
    const rep = peakRep([95]);
    const at = (op: CompareOp, value: number) => evaluateRule(spec, rule('r', { check: { op, value } }), rep, 'side').status;
    expect([at('<=', 95), at('<', 95), at('>=', 95), at('>', 95)]).toEqual(['pass', 'flag', 'pass', 'flag']);
    expect([at('<=', 94.9), at('<', 95.1), at('>=', 95.1), at('>', 94.9)]).toEqual(['flag', 'pass', 'flag', 'pass']);
  });

  it('reduces the window in time order', () => {
    const rep = peakRep([130, 110, 120]);
    const value = (reduce: Reduce | undefined) =>
      evaluateRule(spec, rule('r', { check: { reduce } }), rep, 'side').value;
    expect([value('min'), value('max'), value('mean'), value('first'), value('last')]).toEqual([110, 130, 120, 130, 120]);
    expect(value(undefined)).toBe(120);
  });

  it('reads the rule phase window', () => {
    const rep = makeRep([
      { t: 0, phase: 'outbound', m: { knee: 150 } },
      { t: 100, phase: 'peak', m: { knee: 90 } },
      { t: 200, phase: 'return', m: { knee: 140 } },
    ]);
    const min = (phase: Rule['phase']) => evaluateRule(spec, rule('r', { phase }), rep, 'side').value;
    expect([min('outbound'), min('peak'), min('return'), min('rep')]).toEqual([150, 90, 140, 90]);
  });

  it('is unmeasured below half coverage', () => {
    const r = rule('r', { check: { metric: 'width', reduce: 'min', op: '>=', value: 0.9 } });
    const half = peakRep([{ knee: 90, width: 0.8 }, { knee: 90, width: 1 }, { knee: 90, width: null }, { knee: 90, width: null }]);
    expect(evaluateRule(spec, r, half, 'side')).toMatchObject({ status: 'flag', value: 0.8 });
    const thin = peakRep([{ knee: 90, width: 0.8 }, { knee: 90, width: null }, { knee: 90, width: null }]);
    expect(evaluateRule(spec, r, thin, 'side')).toEqual({ rule_id: 'r', status: 'unmeasured', value: null, threshold: 0.9 });
    const none = peakRep([{ knee: 90, width: null }]);
    expect(evaluateRule(spec, r, none, 'side').status).toBe('unmeasured');
    expect(evaluateRule(spec, r, peakRep([]), 'side').status).toBe('unmeasured');
  });

  describe('mid_ basis', () => {
    const lean = rule('lean', { check: { metric: 'trunk', reduce: 'max', op: '<=', value: 30 } });
    const two = (trunk: number, t: number): Sample => ({ t, phase: 'peak', m: { knee: 90, trunk } });
    const one = (trunk: number, t: number): Sample => ({ t, phase: 'peak', m: { knee: 90, trunk }, drop: ['right_hip'] });

    it('ignores a one-sided minority after a mid-rep switch', () => {
      const rep = makeRep([two(10, 0), two(12, 100), two(11, 200), one(40, 300), one(45, 400)]);
      expect(evaluateRule(spec, lean, rep, 'side')).toMatchObject({ status: 'pass', value: 12 });
    });

    it('keeps the two-sided frames on a tie', () => {
      const rep = makeRep([two(10, 0), two(12, 100), one(40, 200), one(45, 300)]);
      expect(evaluateRule(spec, lean, rep, 'side').value).toBe(12);
    });

    it('uses the one-sided frames when they are the majority', () => {
      const rep = makeRep([two(50, 0), one(20, 100), one(25, 200), one(22, 300)]);
      expect(evaluateRule(spec, lean, rep, 'side')).toMatchObject({ status: 'pass', value: 25 });
    });

    it('leaves metrics without mid_ points alone', () => {
      const rep = makeRep([
        { t: 0, phase: 'peak', m: { knee: 100 } },
        { t: 100, phase: 'peak', m: { knee: 80 }, drop: ['right_hip'] },
      ]);
      expect(evaluateRule(spec, rule('r'), rep, 'side').value).toBe(80);
    });
  });
});

describe('evaluateRep', () => {
  const depth = rule('depth', { priority: 2, joints: ['left_hip', 'left_knee'] });
  const lean = rule('lean', {
    priority: 1, view: 'side', severity: 'safety', joints: ['left_knee', 'left_shoulder'],
    check: { metric: 'trunk', reduce: 'max', op: '<=', value: 30 },
  });
  const knees = rule('knees', { priority: 3, view: 'front', joints: ['right_knee'], check: { metric: 'knee', reduce: 'min', op: '>=', value: 0 } });
  const spec = makeSpec([depth, lean, knees]);
  const samples = (front: boolean): Sample[] =>
    [100, 98, 99].map((knee, i) => ({ t: i * 100, phase: 'peak', m: { knee, trunk: 40 }, front }));

  it('detects the view from the rep and flags in rule order', () => {
    const result = evaluateRep(spec, makeRep(samples(false), { index: 3 }));
    expect(result).toMatchObject({ rep_index: 2, view: 'side', view_source: 'detected' });
    expect(result.outcomes.map((o) => [o.rule_id, o.status])).toEqual([
      ['depth', 'flag'], ['lean', 'flag'], ['knees', 'skipped_view'],
    ]);
    expect(result.flags).toEqual([
      { rule_id: 'depth', severity: 'form', rep_index: 2 },
      { rule_id: 'lean', severity: 'safety', rep_index: 2 },
    ]);
    expect(result.tint_joints).toEqual(['left_hip', 'left_knee', 'left_shoulder']);
  });

  it('detects a front view', () => {
    const result = evaluateRep(spec, makeRep(samples(true)));
    expect(result.view).toBe('front');
    expect(result.outcomes.map((o) => o.status)).toEqual(['flag', 'skipped_view', 'pass']);
  });

  it('lets the caller view win', () => {
    const result = evaluateRep(spec, makeRep(samples(true)), { view: 'side' });
    expect(result).toMatchObject({ view: 'side', view_source: 'caller' });
    expect(result.outcomes.map((o) => o.status)).toEqual(['flag', 'flag', 'skipped_view']);
  });

  it('runs only "any" rules when the view is unknown', () => {
    const result = evaluateRep(spec, makeRep(samples(false).slice(0, 2)));
    expect(result.view).toBe('unknown');
    expect(result.outcomes.map((o) => o.status)).toEqual(['flag', 'skipped_view', 'skipped_view']);
  });

  it('evaluates a generated rule like any other', () => {
    const physio = rule('physio_limit', { priority: 0, joints: ['left_knee'], check: { metric: 'knee', reduce: 'min', op: '>=', value: 100 } });
    const result = evaluateRep({ ...spec, rules: [...spec.rules, physio] }, makeRep(samples(false)));
    expect(result.outcomes.at(-1)).toEqual({ rule_id: 'physio_limit', status: 'flag', value: 98, threshold: 100 });
    expect(result.flags.map((f) => f.rule_id)).toEqual(['depth', 'lean', 'physio_limit']);
  });

  it('returns no flags or tint for a clean rep', () => {
    const result = evaluateRep(makeSpec([depth]), peakRep([90]));
    expect(result.flags).toEqual([]);
    expect(result.tint_joints).toEqual([]);
  });
});

describe('the set', () => {
  const depth = rule('depth', { priority: 2, rest_note: 'Depth on {n} of {total} reps, min {value}.' });
  const tempo = rule('tempo', {
    priority: 1, phase: 'rep', rest_note: 'About {t} s per rep.',
    check: { metric: 'duration_ms', reduce: undefined, op: '>=', value: 1000 },
  });
  const width = rule('width', { priority: 3, check: { metric: 'width', reduce: 'min', op: '>=', value: 0.9 } });
  const spec = makeSpec([depth, tempo, width]);
  // Rep 1: clean. Rep 2: shallow (100) and quick (800 ms). Rep 3: shallow (110), width unmeasured.
  const reps = [
    makeRep([{ t: 0, phase: 'peak', m: { knee: 90, width: 1 } }, { t: 1200, phase: 'peak', m: { knee: 91, width: 1 } }], { index: 1 }),
    makeRep([{ t: 0, phase: 'peak', m: { knee: 100, width: 1 } }, { t: 800, phase: 'peak', m: { knee: 101, width: 1 } }], { index: 2 }),
    makeRep([{ t: 0, phase: 'peak', m: { knee: 110, width: null } }, { t: 1500, phase: 'peak', m: { knee: 111, width: null } }], { index: 3 }),
  ];
  const closed = (rep: RepRecord): EngineEvent => ({ type: 'rep_closed', t: rep.closedAt, rep });

  it('holds flags until set_ended, then ignores events until reset', () => {
    const rules = createSetRules(spec, { view: 'side' });
    expect(rules.handle({ type: 'rep_started', t: 0 })).toBeNull();
    expect(rules.handle({ type: 'partial', t: 0 })).toBeNull();
    expect(rules.handle({ type: 'rep_counted', t: 0, index: 1 })).toBeNull();
    for (const rep of reps) {
      const out = rules.handle(closed(rep));
      expect(out?.type).toBe('rep_evaluated');
      expect(out?.type === 'rep_evaluated' && out.result.view_source).toBe('caller');
      expect(rules.summary()).toBeNull();
    }
    const end = rules.handle({ type: 'set_ended', t: 5000, reason: 'still' });
    expect(end?.type).toBe('set_flags');
    const set = rules.summary()!;
    expect(end?.type === 'set_flags' && end.set).toBe(set);
    expect(set.total_reps).toBe(3);

    expect(rules.handle(closed(reps[0]))).toBeNull();
    expect(rules.handle({ type: 'set_ended', t: 6000, reason: 'manual' })).toBeNull();
    expect(rules.summary()).toBe(set);

    rules.reset();
    expect(rules.summary()).toBeNull();
    rules.handle(closed(reps[1]));
    expect(rules.handle({ type: 'set_ended', t: 7000, reason: 'manual' })).toMatchObject({
      type: 'set_flags', set: { total_reps: 1, reason: 'manual' },
    });
  });

  it('aggregates per rule and picks the top by priority', () => {
    const set = summarizeSet(spec, reps.map((r) => evaluateRep(spec, r, { view: 'side' })), 'still');
    expect(set).toMatchObject({ exercise_id: 'test', reason: 'still', total_reps: 3, clean_reps: 1, extra_notes: [] });
    expect(set.flags).toEqual([
      { rule_id: 'depth', severity: 'form', rep_index: 1 },
      { rule_id: 'tempo', severity: 'form', rep_index: 1 },
      { rule_id: 'depth', severity: 'form', rep_index: 2 },
    ]);
    expect(set.rules).toEqual([
      { rule_id: 'depth', severity: 'form', priority: 2, n: 2, evaluated: 3, mean_value: 105 },
      { rule_id: 'tempo', severity: 'form', priority: 1, n: 1, evaluated: 3, mean_value: 800 },
      { rule_id: 'width', severity: 'form', priority: 3, n: 0, evaluated: 2, mean_value: null },
    ]);
    expect(set.top).toBe(set.rules[1]);
    expect(restNote(spec, set)).toBe('About 0.8 s per rep.');
  });

  it('carries the injury notes of an effective spec', () => {
    const eff: EffectiveSpec = { ...spec, injuries: ['knee', 'lower_back'], extra_notes: ['Knee note.', 'Back note.'] };
    const set = summarizeSet(eff, [evaluateRep(eff, reps[2], { view: 'side' })], 'manual');
    expect(set.extra_notes).toEqual(['Knee note.', 'Back note.']);
    expect(restNote(eff, set)).toBe('Depth on 1 of 1 reps, min 110. Knee note. Back note.');
  });

  it('has no top and no note when every rep is clean', () => {
    const set = summarizeSet(spec, [evaluateRep(spec, reps[0], { view: 'side' })], 'still');
    expect(set).toMatchObject({ clean_reps: 1, flags: [], top: null });
    expect(restNote(spec, set)).toBeNull();
    expect(summarizeSet(spec, [], 'absent')).toMatchObject({ total_reps: 0, clean_reps: 0, top: null });
  });
});

describe('rest-note placeholders', () => {
  const agg = (mean_value: number | null, n = 2): RuleAggregate => ({
    rule_id: 'r', severity: 'form', priority: 1, n, evaluated: 5, mean_value,
  });

  it('formats values', () => {
    expect([formatValue(12.4), formatValue(10), formatValue(-15.6), formatValue(167.5)]).toEqual(['12', '10', '-16', '168']);
    expect([formatValue(9.876), formatValue(0.5), formatValue(2), formatValue(0.104)]).toEqual(['9.88', '0.5', '2', '0.1']);
  });

  it('fills every placeholder', () => {
    expect(fillRestNote('{n} of {total}: {value}, {t} s; {n} again', agg(0.8456), 6)).toBe('2 of 6: 0.85, 0 s; 2 again');
    expect(fillRestNote('{t} s', agg(800), 6)).toBe('0.8 s');
    expect(fillRestNote('{t} s', agg(1000), 6)).toBe('1 s');
    expect(fillRestNote('{t} s', agg(1240), 6)).toBe('1.2 s');
    expect(fillRestNote('{value}°', agg(92.6), 6)).toBe('93°');
    expect(fillRestNote('No placeholders.', agg(1), 6)).toBe('No placeholders.');
  });
});
