// Run with: node --test specs/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInjuries,
  applyOverride,
  checkNote,
  injurySubsets,
  loadBanned,
  loadSchema,
  loadSpecs,
  validateSchema,
  validateSpec,
} from './validate.mjs';

const schema = loadSchema();
const banned = loadBanned();

const MVP_IDS = ['bicep_curl', 'lunge', 'push_up', 'shoulder_press', 'squat'];

// Small valid spec used as the base for negative cases, so these tests don't depend on the real specs.
function fixture() {
  return {
    $schema: './schema.json',
    spec_version: 1,
    id: 'fixture',
    name: 'Fixture',
    recommended_view: 'side',
    angles: {
      knee: { type: 'joint_angle', joints: ['hip', 'knee', 'ankle'], side: 'most_visible' },
      trunk: { type: 'segment_tilt', from: 'mid_hip', to: 'mid_shoulder' },
      knee_width_ratio: {
        type: 'width_ratio',
        numerator: ['left_knee', 'right_knee'],
        denominator: ['left_ankle', 'right_ankle'],
      },
    },
    primary_angle: { name: 'knee', direction: 'decreasing' },
    phases: {
      start_exit: 160,
      count_min: 135,
      target: 95,
      start_enter: 165,
      reverse_deg: 5,
      min_state_ms: 150,
      set_end_still_ms: 8000,
    },
    rules: [
      {
        id: 'depth',
        phase: 'peak',
        view: 'any',
        check: { metric: 'knee', reduce: 'min', op: '<=', value: 'target' },
        severity: 'form',
        priority: 1,
        label: 'partial_range',
        joints: ['left_knee', 'right_knee'],
        rest_note: 'Next set, try lowering until your hips are level with your knees.',
      },
      {
        id: 'tempo',
        phase: 'outbound',
        view: 'any',
        check: { metric: 'duration_ms', op: '>=', value: 800 },
        severity: 'form',
        priority: 2,
        label: 'fast_lowering',
        joints: ['left_hip', 'right_hip'],
        rest_note: 'Your reps took about {t} s on the way down. Around 2 s gives you more control.',
      },
    ],
    injury_overrides: {
      knee: {
        phases: { target: 110 },
        rules: { tempo: { value: 1200 } },
        extra_note: "The range here is set shorter to suit a knee that's still recovering.",
      },
      shoulder: { extra_note: 'This movement puts little load on the shoulders.' },
      lower_back: {
        rules: { depth: { severity: 'safety' } },
        disable_rules: ['tempo'],
        extra_note: 'Any pain here is worth raising with your physio or a doctor.',
      },
    },
  };
}

function errorsFor(mutate, fileId = 'fixture') {
  const spec = fixture();
  mutate(spec);
  return validateSpec(spec, { schema, banned, fileId });
}

function assertError(errors, pattern) {
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `expected an error matching ${pattern}, got:\n${errors.join('\n') || '(none)'}`,
  );
}

describe('MVP exercise specs', () => {
  const specs = loadSpecs();

  test('all five MVP exercises exist', () => {
    assert.deepEqual(specs.map((s) => s.fileId).sort(), MVP_IDS);
  });

  for (const { fileId, spec } of specs) {
    test(`${fileId}.json is valid`, () => {
      assert.deepEqual(validateSpec(spec, { schema, banned, fileId }), []);
    });
  }
});

describe('fixture', () => {
  test('is valid', () => {
    assert.deepEqual(errorsFor(() => {}), []);
  });
});

describe('schema subset validator', () => {
  test('missing required property', () => {
    assertError(errorsFor((s) => delete s.phases), /phases.*required/);
  });

  test('additional property', () => {
    assertError(errorsFor((s) => (s.extra = 1)), /extra.*not allowed/);
  });

  test('enum', () => {
    assertError(errorsFor((s) => (s.rules[0].view = 'top')), /rules\/0\/view/);
  });

  test('oneOf angle type', () => {
    assertError(errorsFor((s) => (s.angles.trunk.type = 'twist')), /angles\/trunk/);
  });

  test('every injury must be present', () => {
    assertError(errorsFor((s) => delete s.injury_overrides.lower_back), /lower_back.*required/);
  });

  test('joints to tint must be COCO names', () => {
    assertError(errorsFor((s) => (s.rules[0].joints = ['knee'])), /rules\/0\/joints\/0/);
  });

  test('pattern and type', () => {
    assert.deepEqual(validateSchema('Bad-Id', schema.$defs.snakeId, schema).length, 1);
    assert.deepEqual(validateSchema(3, schema.$defs.snakeId, schema).length, 1);
  });
});

describe('semantic checks', () => {
  test('id must match the filename', () => {
    assertError(errorsFor(() => {}, 'squat'), /id "fixture" does not match file squat\.json/);
  });

  test('rule ids are unique', () => {
    assertError(errorsFor((s) => (s.rules[1].id = 'depth')), /duplicate rule id "depth"/);
  });

  test('priorities are unique', () => {
    assertError(errorsFor((s) => (s.rules[1].priority = 1)), /duplicate priority 1/);
  });

  test('primary angle must be a joint_angle in angles', () => {
    assertError(errorsFor((s) => (s.primary_angle.name = 'trunk')), /primary_angle.*joint_angle/);
    assertError(errorsFor((s) => (s.primary_angle.name = 'hip')), /primary_angle.*not defined/);
  });

  describe('primary gate', () => {
    const gated = (gate) => (s) => (s.primary_angle.gate = gate);

    test('an angle other than the primary is valid', () => {
      assert.deepEqual(errorsFor(gated({ metric: 'trunk', op: '<=', value: 60 })), []);
    });

    test('metric must be an angle in angles', () => {
      assertError(
        errorsFor(gated({ metric: 'elbow', op: '<=', value: 60 })),
        /primary_angle\.gate: unknown metric "elbow"/,
      );
    });

    test('metric cannot be duration_ms', () => {
      assertError(
        errorsFor(gated({ metric: 'duration_ms', op: '>=', value: 800 })),
        /primary_angle\.gate.*not duration_ms/,
      );
    });

    test('metric cannot be the primary angle', () => {
      assertError(
        errorsFor(gated({ metric: 'knee', op: '<=', value: 120 })),
        /primary_angle\.gate.*"knee" is the primary angle itself/,
      );
    });

    test('op must be a comparison', () => {
      assertError(errorsFor(gated({ metric: 'trunk', op: '==', value: 60 })), /primary_angle\/gate\/op/);
    });

    test('value must be a number', () => {
      assertError(
        errorsFor(gated({ metric: 'trunk', op: '<=', value: 'target' })),
        /primary_angle\/gate\/value: must be number/,
      );
    });

    test('carries through injury overrides unchanged', () => {
      const spec = fixture();
      spec.primary_angle.gate = { metric: 'trunk', op: '<=', value: 60 };
      assert.deepEqual(applyOverride(spec, 'knee').primary_angle, spec.primary_angle);
      assert.deepEqual(applyInjuries(spec, ['knee', 'lower_back']).primary_angle, spec.primary_angle);
    });
  });

  test('unsided point needs a side', () => {
    assertError(errorsFor((s) => delete s.angles.knee.side), /angles\.knee.*needs a side/);
  });

  test('rule metric must exist', () => {
    assertError(errorsFor((s) => (s.rules[0].check.metric = 'elbow')), /depth.*unknown metric "elbow"/);
  });

  test('angle metrics need reduce, duration_ms must not have one', () => {
    assertError(errorsFor((s) => delete s.rules[0].check.reduce), /depth.*needs reduce/);
    assertError(errorsFor((s) => (s.rules[1].check.reduce = 'max')), /tempo.*duration_ms.*no reduce/);
  });

  test('decreasing threshold order', () => {
    assertError(errorsFor((s) => (s.phases.start_enter = 150)), /phases.*decreasing/);
    assertError(errorsFor((s) => (s.phases.target = 140)), /phases.*decreasing/);
  });

  test('increasing threshold order', () => {
    const ok = errorsFor((s) => {
      s.primary_angle.direction = 'increasing';
      Object.assign(s.phases, { start_enter: 95, start_exit: 100, count_min: 135, target: 160 });
      s.injury_overrides.knee.phases = { target: 150 };
    });
    assert.deepEqual(ok, []);
    assertError(
      errorsFor((s) => (s.primary_angle.direction = 'increasing')),
      /phases.*increasing/,
    );
  });

  test('ordering is checked after each override too', () => {
    assertError(
      errorsFor((s) => (s.injury_overrides.knee.phases.target = 140)),
      /injury_overrides\.knee.*decreasing/,
    );
  });

  test('ordering is checked for every injury combination', () => {
    // Each override is fine alone; together the target ends up below count_min.
    const errors = errorsFor((s) => {
      s.injury_overrides.knee.phases.target = 130;
      s.injury_overrides.shoulder.phases = { count_min: 125 };
    });
    assert.ok(!errors.some((e) => /injury_overrides\.(knee|shoulder):/.test(e)), errors.join('\n'));
    assertError(errors, /^injury_overrides\.knee\+shoulder: .*decreasing \(got 130, 125,/);
    assertError(errors, /^injury_overrides\.knee\+shoulder\+lower_back: .*decreasing/);
    assert.ok(!errors.some((e) => /injury_overrides\.knee\+lower_back:/.test(e)), errors.join('\n'));
  });

  test('override rule references must exist', () => {
    assertError(
      errorsFor((s) => (s.injury_overrides.knee.rules = { nope: { value: 1 } })),
      /injury_overrides\.knee.*unknown rule "nope"/,
    );
    assertError(
      errorsFor((s) => (s.injury_overrides.lower_back.disable_rules = ['nope'])),
      /injury_overrides\.lower_back.*unknown rule "nope"/,
    );
  });

  test('override cannot disable a rule and patch it at once', () => {
    assertError(
      errorsFor((s) => (s.injury_overrides.lower_back.disable_rules = ['depth'])),
      /injury_overrides\.lower_back.*both patches and disables "depth"/,
    );
  });

  test('override notes follow the tone rules', () => {
    assertError(
      errorsFor((s) => (s.injury_overrides.knee.extra_note = 'Stop the range wherever you feel discomfort.')),
      /injury_overrides\.knee\.extra_note/,
    );
    assertError(
      errorsFor((s) => (s.injury_overrides.knee.rules.tempo.rest_note = 'Slow down on the way down.')),
      /injury_overrides\.knee\.rules\.tempo\.rest_note/,
    );
  });

  test('extra_note has no placeholders', () => {
    assertError(
      errorsFor((s) => (s.injury_overrides.knee.extra_note = 'Range was {value} degrees.')),
      /extra_note.*placeholder \{value\}/,
    );
  });

  test('{t} only on duration rules', () => {
    assertError(
      errorsFor((s) => (s.rules[0].rest_note = 'Depth took {t} s.')),
      /rules\.depth\.rest_note.*placeholder \{t\}/,
    );
  });

  test('unknown placeholder', () => {
    assertError(
      errorsFor((s) => (s.rules[0].rest_note = 'Depth on {reps} reps.')),
      /placeholder \{reps\}/,
    );
  });
});

describe('checkNote', () => {
  const ok = (text) => assert.deepEqual(checkNote(text, banned), [], text);
  const bad = (text) => assert.ok(checkNote(text, banned).length > 0, `expected a problem with: ${text}`);

  test('accepts the §7 examples', () => {
    ok('Next set, try lowering until your hips are level with your knees.');
    ok('Your knees drifted inward on {n} reps. Pointing them over your toes keeps them comfortable.', true);
    ok('Keeping your chest a little taller makes this easier on your back.');
    ok('{n} of {total} reps were clean. Nice work.');
  });

  test('reads a word with a Unicode hyphen as one word', () => {
    // Models often write push\u2011ups (non-breaking hyphen) or push\u2010ups (hyphen).
    ok('Push\u2011ups were steady on every rep.');
    ok('Push\u2010ups were steady on every rep.');
  });

  test('rejects banned phrases', () => {
    bad('You should go deeper.');
    bad('Your form was bad on the last rep.');
    bad('That was the wrong depth.');
    bad('Make sure the knees track over the toes.');
  });

  test('normalizes curly apostrophes', () => {
    bad('Don’t let the knees cave in.');
  });

  test('rejects imperative openers in any sentence', () => {
    bad('Keep your chest up.');
    bad('Good depth. Lower more slowly next time.');
    bad('Try lowering further.');
    bad('Please check with your physio.');
  });

  test('rejects exclamation marks', () => {
    bad('Great set!');
  });

  test('matches on word boundaries', () => {
    ok('The stopwatch showed about 2 s on the way down.');
    ok('Badminton players often have strong shoulders.');
  });

  test('a hyphenated opener is one word', () => {
    ok('Push-ups put little load on the knees.');
  });
});

describe('applyOverride', () => {
  test('merges phases, patches rules and drops disabled ones', () => {
    const base = fixture();
    const knee = applyOverride(base, 'knee');
    assert.equal(knee.phases.target, 110);
    assert.equal(knee.phases.count_min, 135);
    assert.equal(knee.rules.find((r) => r.id === 'tempo').check.value, 1200);

    const back = applyOverride(base, 'lower_back');
    assert.deepEqual(back.rules.map((r) => r.id), ['depth']);
    assert.equal(back.rules[0].severity, 'safety');

    assert.equal(base.phases.target, 95, 'base spec is not mutated');
    assert.equal(base.rules.length, 2);
  });
});

describe('applyInjuries', () => {
  const rule = (spec, id) => spec.rules.find((r) => r.id === id);
  // fixture() with the three overrides replaced, so each case sets only what it tests.
  function withOverrides({ knee = {}, shoulder = {}, lower_back = {} }) {
    const spec = fixture();
    spec.injury_overrides = {
      knee: { extra_note: 'knee note', ...knee },
      shoulder: { extra_note: 'shoulder note', ...shoulder },
      lower_back: { extra_note: 'back note', ...lower_back },
    };
    return spec;
  }
  function increasing(overrides) {
    const spec = withOverrides(overrides);
    spec.primary_angle.direction = 'increasing';
    Object.assign(spec.phases, { start_enter: 95, start_exit: 100, count_min: 135, target: 160 });
    return spec;
  }

  test('no injuries is the base spec plus empty lists', () => {
    const base = fixture();
    assert.deepEqual(applyInjuries(base, []), { ...base, injuries: [], extra_notes: [] });
  });

  test('one injury matches applyOverride', () => {
    const base = fixture();
    for (const injury of ['knee', 'shoulder', 'lower_back']) {
      const one = applyInjuries(base, [injury]);
      const ref = applyOverride(base, injury);
      assert.deepEqual(one.phases, ref.phases, injury);
      assert.deepEqual(one.rules, ref.rules, injury);
      assert.deepEqual(one.injuries, [injury]);
      assert.deepEqual(one.extra_notes, [base.injury_overrides[injury].extra_note]);
    }
  });

  test('dedupes and applies in body-part order', () => {
    const spec = withOverrides({ knee: { phases: { min_state_ms: 300 } }, lower_back: { phases: { min_state_ms: 200 } } });
    const eff = applyInjuries(spec, ['lower_back', 'knee', 'lower_back', 'knee']);
    assert.deepEqual(eff.injuries, ['knee', 'lower_back']);
    assert.deepEqual(eff.extra_notes, ['knee note', 'back note']);
    assert.equal(eff.phases.min_state_ms, 200, 'lower_back is applied last whatever the input order');
  });

  test('extra_notes follow every applied override in order', () => {
    const eff = applyInjuries(withOverrides({}), ['lower_back', 'shoulder', 'knee']);
    assert.deepEqual(eff.extra_notes, ['knee note', 'shoulder note', 'back note']);
  });

  test('count_min and target keep less range for decreasing', () => {
    for (const [a, b] of [[110, 105], [105, 110]]) {
      const spec = withOverrides({
        knee: { phases: { target: a, count_min: a + 20 } },
        lower_back: { phases: { target: b, count_min: b + 20 } },
      });
      const eff = applyInjuries(spec, ['knee', 'lower_back']);
      assert.equal(eff.phases.target, 110);
      assert.equal(eff.phases.count_min, 130);
    }
  });

  test('count_min and target keep less range for increasing', () => {
    for (const [a, b] of [[150, 145], [145, 150]]) {
      const spec = increasing({
        knee: { phases: { target: a, count_min: a - 20 } },
        shoulder: { phases: { target: b, count_min: b - 20 } },
      });
      const eff = applyInjuries(spec, ['knee', 'shoulder']);
      assert.equal(eff.phases.target, 145);
      assert.equal(eff.phases.count_min, 125);
    }
  });

  test('one override setting count_min or target is applied as is', () => {
    const spec = withOverrides({ knee: { phases: { target: 90 } }, shoulder: { phases: { count_min: 140 } } });
    const eff = applyInjuries(spec, ['knee', 'shoulder']);
    assert.equal(eff.phases.target, 90);
    assert.equal(eff.phases.count_min, 140);
  });

  test('other phase keys: the later override wins', () => {
    const spec = withOverrides({
      knee: { phases: { start_exit: 150, reverse_deg: 8 } },
      shoulder: { phases: { start_exit: 155, reverse_deg: 3 } },
    });
    const eff = applyInjuries(spec, ['knee', 'shoulder']);
    assert.equal(eff.phases.start_exit, 155);
    assert.equal(eff.phases.reverse_deg, 3);
  });

  test('numeric values keep the stricter bound for the op', () => {
    const cases = [
      ['>=', 1200], ['>', 1200],
      ['<=', 1000], ['<', 1000],
    ];
    for (const [op, expected] of cases) {
      for (const [a, b] of [[1000, 1200], [1200, 1000]]) {
        const spec = withOverrides({ knee: { rules: { tempo: { value: a } } }, shoulder: { rules: { tempo: { value: b } } } });
        rule(spec, 'tempo').check.op = op;
        const eff = applyInjuries(spec, ['knee', 'shoulder']);
        assert.equal(rule(eff, 'tempo').check.value, expected, `${op} ${a} then ${b}`);
        assert.equal(rule(eff, 'tempo').check.op, op);
      }
    }
  });

  test('a threshold name on either side: the later override wins', () => {
    let spec = withOverrides({ knee: { rules: { depth: { value: 100 } } }, lower_back: { rules: { depth: { value: 'count_min' } } } });
    assert.equal(rule(applyInjuries(spec, ['knee', 'lower_back']), 'depth').check.value, 'count_min');
    spec = withOverrides({ knee: { rules: { depth: { value: 'count_min' } } }, lower_back: { rules: { depth: { value: 100 } } } });
    assert.equal(rule(applyInjuries(spec, ['knee', 'lower_back']), 'depth').check.value, 100);
    spec = withOverrides({ knee: { rules: { depth: { value: 'count_min' } } }, lower_back: { rules: { depth: { value: 'target' } } } });
    assert.equal(rule(applyInjuries(spec, ['knee', 'lower_back']), 'depth').check.value, 'target');
  });

  test('safety wins over form', () => {
    for (const [a, b] of [['safety', 'form'], ['form', 'safety']]) {
      const spec = withOverrides({ knee: { rules: { depth: { severity: a } } }, shoulder: { rules: { depth: { severity: b } } } });
      assert.equal(rule(applyInjuries(spec, ['knee', 'shoulder']), 'depth').severity, 'safety');
    }
    const spec = withOverrides({ knee: { rules: { tempo: { value: 1200 } } }, shoulder: { rules: { tempo: { severity: 'safety' } } } });
    const tempo = rule(applyInjuries(spec, ['knee', 'shoulder']), 'tempo');
    assert.equal(tempo.severity, 'safety');
    assert.equal(tempo.check.value, 1200, 'a patch without a value leaves the earlier value');
  });

  test('rest_note follows the winning value', () => {
    // tempo is >=, so 1500 is stricter than 1200.
    let spec = withOverrides({
      knee: { rules: { tempo: { value: 1500, rest_note: 'knee tempo' } } },
      shoulder: { rules: { tempo: { value: 1200, rest_note: 'shoulder tempo' } } },
    });
    let tempo = rule(applyInjuries(spec, ['knee', 'shoulder']), 'tempo');
    assert.equal(tempo.check.value, 1500);
    assert.equal(tempo.rest_note, 'knee tempo');

    // The winner has no note: the latest note set.
    spec = withOverrides({
      knee: { rules: { tempo: { value: 1500 } } },
      shoulder: { rules: { tempo: { value: 1200, rest_note: 'shoulder tempo' } } },
    });
    tempo = rule(applyInjuries(spec, ['knee', 'shoulder']), 'tempo');
    assert.equal(tempo.check.value, 1500);
    assert.equal(tempo.rest_note, 'shoulder tempo');

    // No values at all: the latest note set.
    spec = withOverrides({
      knee: { rules: { tempo: { rest_note: 'knee tempo' } } },
      shoulder: { rules: { tempo: { rest_note: 'shoulder tempo' } } },
      lower_back: { rules: { tempo: { severity: 'safety' } } },
    });
    tempo = rule(applyInjuries(spec, ['knee', 'shoulder', 'lower_back']), 'tempo');
    assert.equal(tempo.rest_note, 'shoulder tempo');
    assert.equal(tempo.check.value, 800);
  });

  test('disable_rules is the union', () => {
    const spec = withOverrides({ knee: { disable_rules: ['depth'] }, lower_back: { disable_rules: ['tempo'] } });
    assert.deepEqual(applyInjuries(spec, ['knee']).rules.map((r) => r.id), ['tempo']);
    assert.deepEqual(applyInjuries(spec, ['knee', 'lower_back']).rules, []);
  });

  test('squat with knee and lower_back keeps the shallower target', () => {
    const squat = loadSpecs().find((s) => s.fileId === 'squat').spec;
    const eff = applyInjuries(squat, ['knee', 'lower_back']);
    assert.equal(eff.phases.target, 110);
    assert.equal(rule(eff, 'tempo').check.value, 1500);
    assert.equal(rule(eff, 'trunk_lean').check.value, 35);
    assert.equal(rule(eff, 'trunk_lean').severity, 'safety');
  });

  test('does not mutate the spec', () => {
    const spec = withOverrides({ knee: { phases: { target: 110 }, rules: { tempo: { value: 1200 } } } });
    const before = JSON.parse(JSON.stringify(spec));
    applyInjuries(spec, ['knee', 'shoulder', 'lower_back']);
    assert.deepEqual(spec, before);
  });

  test('injurySubsets lists the 7 combinations, singles first', () => {
    assert.deepEqual(injurySubsets(), [
      ['knee'], ['shoulder'], ['lower_back'],
      ['knee', 'shoulder'], ['knee', 'lower_back'], ['shoulder', 'lower_back'],
      ['knee', 'shoulder', 'lower_back'],
    ]);
  });
});
