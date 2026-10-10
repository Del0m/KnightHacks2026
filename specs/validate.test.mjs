// Run with: node --test specs/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOverride,
  checkNote,
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
