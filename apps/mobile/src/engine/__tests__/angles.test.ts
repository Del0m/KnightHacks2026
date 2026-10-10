import { JOINT_NAMES, type Joint } from '../../pose/types';
import { createMetricComputer, jointAngle, resolvePoint, segmentTilt, widthRatio } from '../angles';
import { EXERCISE_SPECS } from '../specs';
import type { AngleSpec, ExerciseSpec, SideMode, SmoothedJoints } from '../types';

const joints = (named: Record<string, Joint>): SmoothedJoints =>
  JOINT_NAMES.map((name) => named[name] ?? null);

const specWith = (angles: Record<string, AngleSpec>): ExerciseSpec =>
  ({ ...EXERCISE_SPECS[0], angles, primary_angle: { name: Object.keys(angles)[0], direction: 'decreasing' } });

/** A left or right arm with the elbow at `angle` degrees, all joints at confidence `c`. */
const arm = (side: 'left' | 'right', angle: number, c = 0.9): Record<string, Joint> => {
  const rad = (angle * Math.PI) / 180;
  return {
    [`${side}_shoulder`]: { x: 0.5, y: 0.3, c },
    [`${side}_elbow`]: { x: 0.5, y: 0.5, c },
    [`${side}_wrist`]: { x: 0.5 + 0.1 * Math.sin(rad) / (9 / 16), y: 0.5 - 0.1 * Math.cos(rad), c },
  };
};

const elbowSpec = (side: SideMode): ExerciseSpec =>
  specWith({ elbow: { type: 'joint_angle', joints: ['shoulder', 'elbow', 'wrist'], side } });

describe('geometry', () => {
  it('measures joint angles', () => {
    expect(jointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(jointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180);
    expect(jointAngle({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeCloseTo(0);
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45);
  });

  it('is null for a zero-length segment', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(segmentTilt({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 })).toBeNull();
  });

  it('measures tilt from image-up', () => {
    expect(segmentTilt({ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.4 })).toBeCloseTo(0);
    expect(segmentTilt({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 })).toBeCloseTo(90);
    expect(segmentTilt({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.5 })).toBeCloseTo(90);
    expect(segmentTilt({ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 })).toBeCloseTo(180);
    expect(segmentTilt({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 })).toBeCloseTo(45);
  });

  it('divides x-distances and rejects a tiny denominator', () => {
    expect(widthRatio({ x: 0.4, y: 0 }, { x: 0.6, y: 0 }, { x: 0.3, y: 1 }, { x: 0.7, y: 1 }, 0.02)).toBeCloseTo(0.5);
    expect(widthRatio({ x: 0.4, y: 0 }, { x: 0.6, y: 0 }, { x: 0.5, y: 1 }, { x: 0.51, y: 1 }, 0.02)).toBeNull();
    expect(widthRatio({ x: 0.4, y: 0 }, { x: 0.6, y: 0 }, { x: 0.5, y: 1 }, { x: 0.5, y: 1 }, 0)).toBeNull();
  });
});

describe('resolvePoint', () => {
  const j = joints({
    nose: { x: 0.5, y: 0.1, c: 0.9 },
    left_knee: { x: 0.4, y: 0.7, c: 0.8 },
    right_knee: { x: 0.6, y: 0.7, c: 0.6 },
    left_hip: { x: 0.45, y: 0.5, c: 0.7 },
  });

  it('resolves COCO names, unsided bases and nose', () => {
    expect(resolvePoint('left_knee', 'right', j)).toEqual(j[13]);
    expect(resolvePoint('knee', 'left', j)).toEqual(j[13]);
    expect(resolvePoint('knee', 'right', j)).toEqual(j[14]);
    expect(resolvePoint('nose', 'right', j)).toEqual(j[0]);
    expect(resolvePoint('hip', 'right', j)).toBeNull();
    expect(resolvePoint('elbow_tip', 'left', j)).toBeNull();
  });

  it('averages mid_ points and falls back to the side present', () => {
    const mid = resolvePoint('mid_knee', 'left', j)!;
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(0.7);
    expect(mid.c).toBeCloseTo(0.7);
    expect(resolvePoint('mid_hip', 'right', j)).toEqual(j[11]);
    expect(resolvePoint('mid_ankle', 'left', j)).toBeNull();
  });
});

describe('aspect correction', () => {
  // A true 90° in pixels of a 1080 × 1920 frame: arms 300 px along each diagonal.
  const px = (x: number, y: number, c = 0.9): Joint => ({ x: x / 1080, y: y / 1920, c });
  const frame = joints({
    left_shoulder: px(840, 660),
    left_elbow: px(540, 960),
    left_wrist: px(840, 1260),
  });
  const spec = elbowSpec('left');

  it('measures 90° with the default 9/16', () => {
    expect(createMetricComputer(spec).compute(frame).metrics.elbow).toBeCloseTo(90);
    expect(createMetricComputer(spec, { imageAspect: 9 / 16 }).compute(frame).metrics.elbow).toBeCloseTo(90);
  });

  it('measures something else without it', () => {
    const raw = createMetricComputer(spec, { imageAspect: 1 }).compute(frame).metrics.elbow!;
    expect(Math.abs(raw - 90)).toBeGreaterThan(20);
  });

  it('applies to tilts', () => {
    const tilt = specWith({ t: { type: 'segment_tilt', from: 'left_hip', to: 'left_shoulder' } });
    const f = joints({ left_hip: px(540, 960), left_shoulder: px(840, 660) });
    expect(createMetricComputer(tilt).compute(f).metrics.t).toBeCloseTo(45);
  });

  it('applies the ratio threshold in corrected units', () => {
    const ratio = specWith({
      r: { type: 'width_ratio', numerator: ['left_knee', 'right_knee'], denominator: ['left_ankle', 'right_ankle'] },
    });
    // Denominator 0.03 normalized is 0.0169 corrected: below the 0.02 default.
    const f = joints({
      left_knee: { x: 0.48, y: 0.7, c: 0.9 },
      right_knee: { x: 0.52, y: 0.7, c: 0.9 },
      left_ankle: { x: 0.485, y: 0.9, c: 0.9 },
      right_ankle: { x: 0.515, y: 0.9, c: 0.9 },
    });
    expect(createMetricComputer(ratio).compute(f).metrics.r).toBeNull();
    expect(createMetricComputer(ratio, { imageAspect: 1 }).compute(f).metrics.r).toBeCloseTo(4 / 3);
    expect(createMetricComputer(ratio, { minRatioDenominator: 0.01 }).compute(f).metrics.r).toBeCloseTo(4 / 3);
  });
});

describe('side modes', () => {
  const both = joints({ ...arm('left', 90, 0.9), ...arm('right', 120, 0.8) });
  const leftOnly = joints(arm('left', 90));
  const none = joints({});

  it.each([
    ['left', 90, 'left'],
    ['right', 120, 'right'],
    ['both_avg', 105, 'both'],
    ['min', 90, 'left'],
    ['max', 120, 'right'],
    ['most_visible', 90, 'left'],
  ] as const)('%s with both sides', (mode, value, side) => {
    const r = createMetricComputer(elbowSpec(mode)).compute(both);
    expect(r.metrics.elbow).toBeCloseTo(value);
    expect(r.sides.elbow).toBe(side);
  });

  it.each([
    ['left', 90, 'left'],
    ['right', null, null],
    ['both_avg', 90, 'left'],
    ['min', 90, 'left'],
    ['max', 90, 'left'],
    ['most_visible', 90, 'left'],
  ] as const)('%s with only the left side', (mode, value, side) => {
    const r = createMetricComputer(elbowSpec(mode)).compute(leftOnly);
    if (value === null) expect(r.metrics.elbow).toBeNull();
    else expect(r.metrics.elbow).toBeCloseTo(value);
    expect(r.sides.elbow).toBe(side);
  });

  it.each(['left', 'right', 'both_avg', 'min', 'max', 'most_visible'] as const)(
    '%s is null with no points',
    (mode) => {
      expect(createMetricComputer(elbowSpec(mode)).compute(none)).toEqual({
        metrics: { elbow: null },
        sides: { elbow: null },
      });
    },
  );

  it('defaults to most_visible', () => {
    const spec = specWith({ elbow: { type: 'joint_angle', joints: ['shoulder', 'elbow', 'wrist'] } });
    const r = createMetricComputer(spec).compute(joints({ ...arm('left', 90, 0.4), ...arm('right', 120, 0.9) }));
    expect(r.metrics.elbow).toBeCloseTo(120);
    expect(r.sides.elbow).toBe('right');
  });

  it("reports 'both' for metrics without a side choice", () => {
    const spec = specWith({
      trunk: { type: 'segment_tilt', from: 'mid_hip', to: 'mid_shoulder' },
      fixed: { type: 'joint_angle', joints: ['left_shoulder', 'left_elbow', 'left_wrist'], side: 'right' },
      ratio: { type: 'width_ratio', numerator: ['left_elbow', 'right_elbow'], denominator: ['left_wrist', 'right_wrist'] },
    });
    const f = joints({
      ...arm('left', 90),
      right_shoulder: { x: 0.7, y: 0.3, c: 0.9 },
      right_elbow: { x: 0.7, y: 0.5, c: 0.9 },
      right_wrist: { x: 0.9, y: 0.5, c: 0.9 },
      left_hip: { x: 0.5, y: 0.6, c: 0.9 },
      right_hip: { x: 0.7, y: 0.6, c: 0.9 },
    });
    const r = createMetricComputer(spec).compute(f);
    expect(r.metrics.trunk).toBeCloseTo(0);
    expect(r.metrics.fixed).toBeCloseTo(90);
    expect(r.sides).toEqual({ trunk: 'both', fixed: 'both', ratio: 'both' });
  });

  it('uses the one side present for a mid_ point', () => {
    const spec = specWith({ trunk: { type: 'segment_tilt', from: 'mid_hip', to: 'mid_shoulder' } });
    const f = joints({ left_hip: { x: 0.5, y: 0.6, c: 0.9 }, right_shoulder: { x: 0.5, y: 0.3, c: 0.9 } });
    expect(createMetricComputer(spec).compute(f).metrics.trunk).toBeCloseTo(0);
  });
});

describe('most_visible stickiness', () => {
  const frameWith = (cl: number, cr: number) => joints({ ...arm('left', 90, cl), ...arm('right', 120, cr) });
  const sideOf = (m: ReturnType<typeof createMetricComputer>, cl: number, cr: number) =>
    m.compute(frameWith(cl, cr)).sides.elbow;

  it('first picks the more visible side, ties going left', () => {
    expect(sideOf(createMetricComputer(elbowSpec('most_visible')), 0.5, 0.6)).toBe('right');
    expect(sideOf(createMetricComputer(elbowSpec('most_visible')), 0.7, 0.7)).toBe('left');
  });

  it('switches only past sideMargin', () => {
    const m = createMetricComputer(elbowSpec('most_visible'));
    expect(sideOf(m, 0.6, 0.5)).toBe('left');
    expect(sideOf(m, 0.5, 0.59)).toBe('left');
    expect(sideOf(m, 0.5, 0.6)).toBe('right');
    expect(sideOf(m, 0.65, 0.6)).toBe('right');
    expect(sideOf(m, 0.7, 0.6)).toBe('left');
  });

  it('honours a custom margin', () => {
    const m = createMetricComputer(elbowSpec('most_visible'), { sideMargin: 0.3 });
    expect(sideOf(m, 0.6, 0.5)).toBe('left');
    expect(sideOf(m, 0.4, 0.65)).toBe('left');
    expect(sideOf(m, 0.4, 0.7)).toBe('right');
  });

  it('keeps the side while locked and re-evaluates after unlock', () => {
    const m = createMetricComputer(elbowSpec('most_visible'));
    expect(sideOf(m, 0.9, 0.5)).toBe('left');
    m.setLocked(true);
    expect(sideOf(m, 0.4, 0.9)).toBe('left');
    m.setLocked(false);
    expect(sideOf(m, 0.4, 0.9)).toBe('right');
  });

  it('falls back to the other side when the chosen value is null, even locked', () => {
    const m = createMetricComputer(elbowSpec('most_visible'));
    expect(sideOf(m, 0.9, 0.5)).toBe('left');
    m.setLocked(true);
    const r = m.compute(joints(arm('right', 120)));
    expect(r.metrics.elbow).toBeCloseTo(120);
    expect(r.sides.elbow).toBe('right');
    // Sticky on the new side while locked.
    expect(sideOf(m, 0.9, 0.5)).toBe('right');
  });

  it('counts a missing point as zero visibility', () => {
    const m = createMetricComputer(elbowSpec('most_visible'));
    const { left_wrist: _, ...leftPartial } = arm('left', 90, 0.9);
    // Left mean (0.9 + 0.9 + 0) / 3 = 0.6 < right 0.7: right wins the first choice.
    const r = m.compute(joints({ ...leftPartial, ...arm('right', 120, 0.7) }));
    expect(r.sides.elbow).toBe('right');
  });

  it('tracks each metric separately', () => {
    const spec = specWith({
      elbow: { type: 'joint_angle', joints: ['shoulder', 'elbow', 'wrist'] },
      knee: { type: 'joint_angle', joints: ['hip', 'knee', 'ankle'] },
    });
    const leg = (side: 'left' | 'right', c: number): Record<string, Joint> => ({
      [`${side}_hip`]: { x: 0.5, y: 0.5, c },
      [`${side}_knee`]: { x: 0.5, y: 0.7, c },
      [`${side}_ankle`]: { x: 0.5, y: 0.9, c },
    });
    const r = createMetricComputer(spec).compute(
      joints({ ...arm('left', 90, 0.9), ...arm('right', 90, 0.3), ...leg('left', 0.3), ...leg('right', 0.9) }),
    );
    expect(r.sides).toEqual({ elbow: 'left', knee: 'right' });
  });

  it('clears the choice and the lock on reset', () => {
    const m = createMetricComputer(elbowSpec('most_visible'));
    expect(sideOf(m, 0.6, 0.55)).toBe('left');
    m.setLocked(true);
    m.reset();
    expect(sideOf(m, 0.55, 0.6)).toBe('right');
    expect(sideOf(m, 0.9, 0.6)).toBe('left');
  });
});

describe('bundled specs', () => {
  const full = joints(
    Object.fromEntries(
      JOINT_NAMES.map((name, i) => [name, { x: 0.3 + (name.startsWith('left') ? 0 : 0.1) + i * 0.005, y: 0.05 * i, c: 0.9 }]),
    ),
  );

  it.each(EXERCISE_SPECS.map((s) => [s.id, s] as const))('%s computes every metric', (_, spec) => {
    const m = createMetricComputer(spec);
    const { metrics, sides } = m.compute(full);
    expect(Object.keys(metrics).sort()).toEqual(Object.keys(spec.angles).sort());
    for (const name of Object.keys(spec.angles)) {
      expect(typeof metrics[name]).toBe('number');
      expect(sides[name]).not.toBeNull();
    }
    expect(Object.values(m.compute(joints({})).metrics).every((v) => v === null)).toBe(true);
  });
});
