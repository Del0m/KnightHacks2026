import { JOINT_NAMES } from '../../pose/types';
import { loadFixtures } from '../__fixtures__/load';
import { runClip } from '../__fixtures__/run';
import type { EngineFrame } from '../types';
import { detectView, FRONT_MIN_RATIO, SIDE_MAX_RATIO, viewRatio } from '../view';

/** A frame with only the given joints present, at `[x, y]`. */
const frame = (joints: Record<string, [number, number]>, t = 0): EngineFrame => ({
  t,
  metrics: {},
  sides: {},
  joints: JOINT_NAMES.map((n) => (joints[n] ? { x: joints[n][0], y: joints[n][1], c: 0.9 } : null)),
});

/** Shoulders `sw` apart at y 0.3, hips `hw` apart at y 0.6, centred on x 0.5. */
const torso = (sw: number, hw: number) =>
  frame({
    left_shoulder: [0.5 + sw / 2, 0.3],
    right_shoulder: [0.5 - sw / 2, 0.3],
    left_hip: [0.5 + hw / 2, 0.6],
    right_hip: [0.5 - hw / 2, 0.6],
  });

describe('viewRatio', () => {
  it('compares the torso width with its height', () => {
    expect(viewRatio(torso(0.2, 0.16), 1)).toBeCloseTo((0.2 + 0.16) / (2 * 0.3));
  });

  it('scales x by the image aspect', () => {
    expect(viewRatio(torso(0.2, 0.16), 0.5)).toBeCloseTo((0.1 + 0.08) / (2 * 0.3));
  });

  it('reads 0 when only one side is visible', () => {
    expect(viewRatio(frame({ left_shoulder: [0.5, 0.3], left_hip: [0.5, 0.6] }), 1)).toBe(0);
    expect(viewRatio(frame({ right_shoulder: [0.5, 0.3], right_hip: [0.5, 0.6] }), 1)).toBe(0);
  });

  it('is null when it cannot be read', () => {
    expect(viewRatio(frame({ left_shoulder: [0.5, 0.3], right_hip: [0.5, 0.6] }), 1)).toBeNull();
    expect(viewRatio(frame({ left_shoulder: [0.5, 0.3], left_hip: [0.5, 0.6], right_hip: [0.5, 0.6] }), 1)).toBeNull();
    expect(viewRatio(frame({}), 1)).toBeNull();
    const flat = frame({
      left_shoulder: [0.6, 0.5], right_shoulder: [0.4, 0.5], left_hip: [0.6, 0.5], right_hip: [0.4, 0.5],
    });
    expect(viewRatio(flat, 1)).toBeNull();
  });
});

describe('detectView', () => {
  const front = torso(0.3, 0.2);
  const side = torso(0.02, 0.02);
  const between = torso(0.2, 0.0);

  it('takes the median over the rep', () => {
    expect(viewRatio(front, 1)).toBeGreaterThanOrEqual(FRONT_MIN_RATIO);
    expect(viewRatio(side, 1)).toBeLessThanOrEqual(SIDE_MAX_RATIO);
    expect(detectView([front, front, side], 1)).toBe('front');
    expect(detectView([side, front, side], 1)).toBe('side');
  });

  it('is unknown between the thresholds', () => {
    const r = viewRatio(between, 1)!;
    expect(r).toBeGreaterThan(SIDE_MAX_RATIO);
    expect(r).toBeLessThan(FRONT_MIN_RATIO);
    expect(detectView([between, between, between], 1)).toBe('unknown');
  });

  it('is unknown with fewer than 3 readable frames', () => {
    expect(detectView([front, front], 1)).toBe('unknown');
    expect(detectView([front, front, frame({})], 1)).toBe('unknown');
    expect(detectView([], 1)).toBe('unknown');
  });

  it('detects each fixture view per rep', () => {
    const expected: Record<string, 'front' | 'side'> = {
      squat: 'side', push_up: 'side', bicep_curl: 'side', lunge: 'side', shoulder_press: 'front',
    };
    // Filmed from a three-quarter front angle.
    const byClip: Record<string, 'front' | 'side'> = { squat_front_knees_in: 'front' };
    for (const clip of loadFixtures()) {
      const reps = runClip(clip).reps;
      expect(reps.length).toBeGreaterThan(0);
      for (const rep of reps) expect([clip.name, detectView(rep.windows.rep, rep.imageAspect)]).toEqual([clip.name, byClip[clip.name] ?? expected[clip.exercise]]);
    }
  });
});
