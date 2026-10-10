/// <reference types="node" />
// Injury overrides. The parity block runs specs/validate.mjs (the reference merge) in a child
// `node` process and checks the TS port gives the same JSON for every bundled spec.

import { execFileSync } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';

import { applyInjuries, applyOverride, INJURY_ORDER } from '../overrides';
import { EXERCISE_SPECS, getSpec } from '../specs';
import type { CompareOp, ExerciseSpec, Injury, InjuryOverride } from '../types';

const VALIDATE_URL = pathToFileURL(path.resolve(__dirname, '../../../../../specs/validate.mjs')).href;

/** Every non-empty subset of INJURY_ORDER. */
const SUBSETS: Injury[][] = [1, 2, 3, 4, 5, 6, 7].map((mask) => INJURY_ORDER.filter((_, i) => mask & (1 << i)));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rule = (spec: ExerciseSpec, id: string) => {
  const r = spec.rules.find((x) => x.id === id);
  if (!r) throw new Error(`missing rule ${id}`);
  return r;
};

/** The squat with its overrides replaced, so each case sets only what it tests. */
function withOverrides(o: Partial<Record<Injury, Partial<InjuryOverride>>>): ExerciseSpec {
  const spec = clone(getSpec('squat')!);
  spec.injury_overrides = {
    knee: { extra_note: 'knee note', ...o.knee },
    shoulder: { extra_note: 'shoulder note', ...o.shoulder },
    lower_back: { extra_note: 'back note', ...o.lower_back },
  };
  return spec;
}

describe('applyOverride', () => {
  it('merges phases, patches rules and drops nothing it was not asked to', () => {
    const squat = getSpec('squat')!;
    const knee = applyOverride(squat, 'knee');
    expect(knee.phases).toEqual({ ...squat.phases, target: 110 });
    expect(rule(knee, 'tempo').check.value).toBe(1500);
    expect(rule(knee, 'tempo').rest_note).toMatch(/recovering knee/);
    expect(knee.rules.map((r) => r.id)).toEqual(squat.rules.map((r) => r.id));
  });

  it('removes disabled rules', () => {
    const spec = withOverrides({ lower_back: { disable_rules: ['tempo', 'depth'] } });
    expect(applyOverride(spec, 'lower_back').rules.map((r) => r.id)).toEqual(['knee_tracking', 'trunk_lean']);
  });
});

describe('applyInjuries', () => {
  it('is the base spec plus empty lists with no injuries', () => {
    const squat = getSpec('squat')!;
    expect(applyInjuries(squat, [])).toEqual({ ...squat, injuries: [], extra_notes: [] });
  });

  it('matches applyOverride for one injury', () => {
    for (const spec of EXERCISE_SPECS) {
      for (const injury of INJURY_ORDER) {
        const eff = applyInjuries(spec, [injury]);
        const ref = applyOverride(spec, injury);
        expect(eff.phases).toEqual(ref.phases);
        expect(eff.rules).toEqual(ref.rules);
        expect(eff.extra_notes).toEqual([spec.injury_overrides[injury].extra_note]);
      }
    }
  });

  it('dedupes and applies in body-part order', () => {
    const spec = withOverrides({ knee: { phases: { min_state_ms: 300 } }, lower_back: { phases: { min_state_ms: 200 } } });
    const eff = applyInjuries(spec, ['lower_back', 'knee', 'lower_back', 'knee']);
    expect(eff.injuries).toEqual(['knee', 'lower_back']);
    expect(eff.extra_notes).toEqual(['knee note', 'back note']);
    expect(eff.phases.min_state_ms).toBe(200);
  });

  it('keeps the shallower squat target for knee and lower_back', () => {
    const eff = applyInjuries(getSpec('squat')!, ['lower_back', 'knee']);
    expect(eff.phases.target).toBe(110);
    expect(rule(eff, 'trunk_lean').check.value).toBe(35);
    expect(rule(eff, 'trunk_lean').severity).toBe('safety');
  });

  it('keeps less range for count_min and target in both directions', () => {
    for (const [a, b] of [[110, 105], [105, 110]]) {
      const dec = withOverrides({ knee: { phases: { target: a, count_min: a + 20 } }, lower_back: { phases: { target: b, count_min: b + 20 } } });
      expect(applyInjuries(dec, ['knee', 'lower_back']).phases).toMatchObject({ target: 110, count_min: 130 });

      const inc = withOverrides({ knee: { phases: { target: a + 40, count_min: a + 20 } }, shoulder: { phases: { target: b + 40, count_min: b + 20 } } });
      inc.primary_angle.direction = 'increasing';
      expect(applyInjuries(inc, ['knee', 'shoulder']).phases).toMatchObject({ target: 145, count_min: 125 });
    }
  });

  it('lets the later override win for other phase keys', () => {
    const spec = withOverrides({ knee: { phases: { start_exit: 150 } }, shoulder: { phases: { start_exit: 155 } } });
    expect(applyInjuries(spec, ['knee', 'shoulder']).phases.start_exit).toBe(155);
  });

  it.each<[CompareOp, number]>([['>=', 1200], ['>', 1200], ['<=', 1000], ['<', 1000]])(
    'keeps the stricter numeric value for %s',
    (op, expected) => {
      for (const [a, b] of [[1000, 1200], [1200, 1000]]) {
        const spec = withOverrides({ knee: { rules: { tempo: { value: a } } }, shoulder: { rules: { tempo: { value: b } } } });
        rule(spec, 'tempo').check.op = op;
        expect(rule(applyInjuries(spec, ['knee', 'shoulder']), 'tempo').check.value).toBe(expected);
      }
    },
  );

  it('lets the later override win when a value is a threshold name', () => {
    const run = (a: number | 'count_min' | 'target', b: number | 'count_min' | 'target') =>
      rule(
        applyInjuries(withOverrides({ knee: { rules: { depth: { value: a } } }, lower_back: { rules: { depth: { value: b } } } }), ['knee', 'lower_back']),
        'depth',
      ).check.value;
    expect(run(100, 'count_min')).toBe('count_min');
    expect(run('count_min', 100)).toBe(100);
    expect(run('count_min', 'target')).toBe('target');
  });

  it('keeps safety if any override says so', () => {
    for (const [a, b] of [['safety', 'form'], ['form', 'safety']] as const) {
      const spec = withOverrides({ knee: { rules: { depth: { severity: a } } }, shoulder: { rules: { depth: { severity: b } } } });
      expect(rule(applyInjuries(spec, ['knee', 'shoulder']), 'depth').severity).toBe('safety');
    }
  });

  it('takes the rest_note from the winning value, else the latest note', () => {
    const won = withOverrides({
      knee: { rules: { tempo: { value: 1500, rest_note: 'knee tempo' } } },
      shoulder: { rules: { tempo: { value: 1200, rest_note: 'shoulder tempo' } } },
    });
    expect(rule(applyInjuries(won, ['knee', 'shoulder']), 'tempo')).toMatchObject({ rest_note: 'knee tempo', check: { value: 1500 } });

    const noNote = withOverrides({
      knee: { rules: { tempo: { value: 1500 } } },
      shoulder: { rules: { tempo: { value: 1200, rest_note: 'shoulder tempo' } } },
    });
    expect(rule(applyInjuries(noNote, ['knee', 'shoulder']), 'tempo')).toMatchObject({ rest_note: 'shoulder tempo', check: { value: 1500 } });
  });

  it('disables the union of disable_rules', () => {
    const spec = withOverrides({ knee: { disable_rules: ['depth'] }, lower_back: { disable_rules: ['tempo'] } });
    expect(applyInjuries(spec, ['knee', 'lower_back']).rules.map((r) => r.id)).toEqual(['knee_tracking', 'trunk_lean']);
  });

  it('does not mutate the spec', () => {
    const spec = getSpec('squat')!;
    const before = clone(spec);
    applyInjuries(spec, ['knee', 'shoulder', 'lower_back']);
    expect(spec).toEqual(before);
  });
});

describe('parity with specs/validate.mjs', () => {
  const cases = EXERCISE_SPECS.flatMap((spec) => [
    ...SUBSETS.map((injuries) => ({ fn: 'applyInjuries' as const, id: spec.id, injuries })),
    ...INJURY_ORDER.map((injury) => ({ fn: 'applyOverride' as const, id: spec.id, injuries: [injury] })),
  ]);

  // One child process for every case: the bundled specs go in on stdin, results come back as JSON.
  const script = `
    import { readFileSync } from 'node:fs';
    import { applyInjuries, applyOverride } from ${JSON.stringify(VALIDATE_URL)};
    const { specs, cases } = JSON.parse(readFileSync(0, 'utf8'));
    const byId = Object.fromEntries(specs.map((s) => [s.id, s]));
    const out = cases.map((c) =>
      c.fn === 'applyInjuries' ? applyInjuries(byId[c.id], c.injuries) : applyOverride(byId[c.id], c.injuries[0]));
    process.stdout.write(JSON.stringify(out));
  `;
  const reference: unknown[] = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      input: JSON.stringify({ specs: EXERCISE_SPECS, cases }),
      encoding: 'utf8',
    }),
  );

  it('covers 5 specs x (7 subsets + 3 single overrides)', () => {
    expect(EXERCISE_SPECS).toHaveLength(5);
    expect(reference).toHaveLength(50);
  });

  it.each(cases.map((c, i) => [c.fn, c.id, c.injuries.join('+'), i] as const))('%s(%s, %s)', (fn, id, _label, i) => {
    const spec = EXERCISE_SPECS.find((s) => s.id === id)!;
    const ours = fn === 'applyInjuries' ? applyInjuries(spec, cases[i].injuries) : applyOverride(spec, cases[i].injuries[0]);
    expect(clone(ours)).toEqual(reference[i]);
  });
});
