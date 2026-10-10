/// <reference types="node" />
// Synthetic fixtures: committed JSON matches the generator, every clip is well formed, and the
// clean (noise-free) trajectories really contain the intended reps and partials.
// `UPDATE_FIXTURES=1 npx jest src/engine/__tests__/fixtures.test.ts` rewrites the JSON.

import fs from 'fs';
import path from 'path';

import { JOINT_NAMES, isPoseResult, type PoseResult } from '../../pose/types';
import { FIXTURES_DIR, loadFixtures } from '../__fixtures__/load';
import { CLIP_DEFS, generateAll, generateClip, serializeClip } from '../__fixtures__/synth';
import { isAbsentFrame, type Clip } from '../recording';
import { getSpec } from '../specs';
import type { ExerciseSpec, JointAngleSpec } from '../types';

const fileFor = (name: string) => path.join(FIXTURES_DIR, `${name}.json`);

if (process.env.UPDATE_FIXTURES === '1') {
  for (const clip of generateAll()) fs.writeFileSync(fileFor(clip.name), serializeClip(clip));
}

describe('synthetic fixtures are up to date', () => {
  it('has the ten listed clips', () => {
    expect(CLIP_DEFS.map((d) => d.name).sort()).toEqual([
      'bicep_curl_clean', 'lunge_alternating', 'push_up_lockout', 'shoulder_press_clean',
      'shoulder_press_cloud', 'squat_absent_end', 'squat_bounce_pause', 'squat_clean', 'squat_noisy',
      'squat_threshold_hover',
    ]);
  });

  it.each(CLIP_DEFS.map((d) => [d.name, d] as const))('%s matches the generator', (name, def) => {
    const file = fileFor(name);
    expect(fs.existsSync(file)).toBe(true);
    const committed = fs.readFileSync(file, 'utf8');
    const same = committed === serializeClip(generateClip(def));
    if (!same) throw new Error(`${name}.json is stale; run UPDATE_FIXTURES=1 npx jest ${path.basename(__filename)}`);
  });

  it('has no synthetic clip on disk without a generator entry', () => {
    const names = new Set(CLIP_DEFS.map((d) => d.name));
    for (const f of loadFixtures().filter((c) => c.source === 'synthetic')) expect(names.has(f.name)).toBe(true);
  });

  it('is deterministic', () => {
    const def = CLIP_DEFS[1];
    expect(serializeClip(generateClip(def))).toBe(serializeClip(generateClip(def)));
  });
});

describe('every fixture is well formed', () => {
  const fixtures = loadFixtures();

  it('loads sorted by name', () => {
    const names = fixtures.map((f) => f.name);
    expect(names).toEqual([...names].sort());
    expect(fixtures.length).toBeGreaterThanOrEqual(CLIP_DEFS.length);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, clip) => {
    expect(getSpec(clip.exercise)).toBeDefined();
    expect(['synthetic', 'recorded']).toContain(clip.source);
    expect(clip.image.width).toBeGreaterThan(0);
    expect(clip.image.height).toBeGreaterThan(0);
    expect(clip.expected).toBeDefined();
    expect(clip.expected!.reps).toBeGreaterThanOrEqual(0);
    expect(clip.expected!.partials).toBeGreaterThanOrEqual(0);
    expect([null, 'still', 'absent']).toContain(clip.expected!.set_end);
    expect(clip.frames.length).toBeGreaterThan(0);
    let prev = -Infinity;
    for (const f of clip.frames) {
      if (isAbsentFrame(f)) {
        expect(f.absent).toBe(true);
      } else {
        expect(isPoseResult(f)).toBe(true);
        for (const j of f.joints) {
          for (const v of [j.x, j.y, j.c]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
      expect(f.timestamp_ms).toBeGreaterThan(prev);
      prev = f.timestamp_ms;
    }
  });
});

// ---------------------------------------------------------------------------
// Independent angle math for the sanity check (not the engine's angles.ts).

const IDX = new Map(JOINT_NAMES.map((n, i) => [n, i]));

function point(r: PoseResult, name: string, side: 'left' | 'right', aspect: number) {
  const resolve = (n: string) => {
    const j = r.joints[IDX.get(n)!];
    return { X: j.x * aspect, Y: j.y, c: j.c };
  };
  if (name.startsWith('mid_')) {
    const a = resolve(`left_${name.slice(4)}`);
    const b = resolve(`right_${name.slice(4)}`);
    return { X: (a.X + b.X) / 2, Y: (a.Y + b.Y) / 2, c: (a.c + b.c) / 2 };
  }
  return resolve(IDX.has(name) ? name : `${side}_${name}`);
}

function sideAngle(r: PoseResult, spec: JointAngleSpec, side: 'left' | 'right', aspect: number) {
  const [a, v, c] = spec.joints.map((n) => point(r, n, side, aspect));
  const u = [a.X - v.X, a.Y - v.Y];
  const w = [c.X - v.X, c.Y - v.Y];
  const cos = (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]));
  return {
    angle: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI,
    visibility: (a.c + v.c + c.c) / 3,
  };
}

function primaryAngle(r: PoseResult, spec: ExerciseSpec, aspect: number): number {
  const m = spec.angles[spec.primary_angle.name] as JointAngleSpec;
  const L = sideAngle(r, m, 'left', aspect);
  const R = sideAngle(r, m, 'right', aspect);
  switch (m.side ?? 'most_visible') {
    case 'left': return L.angle;
    case 'right': return R.angle;
    case 'min': return Math.min(L.angle, R.angle);
    case 'max': return Math.max(L.angle, R.angle);
    case 'both_avg': return (L.angle + R.angle) / 2;
    case 'most_visible': return R.visibility > L.visibility ? R.angle : L.angle;
  }
}

/** Plain hysteresis count over the clean trajectory, with the deepest value of each attempt. */
function countAttempts(values: { t: number; v: number }[], spec: ExerciseSpec) {
  const s = spec.primary_angle.direction === 'decreasing' ? 1 : -1;
  const p = spec.phases;
  const deeper = (v: number, x: number) => s * (x - v) > 0;
  const shallower = (v: number, x: number) => s * (v - x) > 0;
  const attempts: { extreme: number; counted: boolean; topAfter: number }[] = [];
  let open: { extreme: number; counted: boolean; topAfter: number } | null = null;
  for (const { v } of values) {
    if (!open) {
      const last = attempts[attempts.length - 1];
      if (last && s * (last.topAfter - v) < 0) last.topAfter = v;
      if (deeper(v, p.start_exit)) open = { extreme: v, counted: false, topAfter: v };
      continue;
    }
    if (deeper(v, open.extreme)) open.extreme = v;
    if (deeper(v, p.count_min)) open.counted = true;
    if (shallower(v, p.start_enter)) {
      open.topAfter = v;
      attempts.push(open);
      open = null;
    }
  }
  return { attempts, unfinished: open !== null };
}

describe('clean trajectories contain the intended reps', () => {
  it.each(CLIP_DEFS.map((d) => [d.name, d] as const))('%s', (_name, def) => {
    const clip: Clip = generateClip(def, { clean: true });
    const spec = getSpec(clip.exercise)!;
    const aspect = clip.image.width / clip.image.height;
    const s = spec.primary_angle.direction === 'decreasing' ? 1 : -1;
    const p = spec.phases;
    const values = clip.frames
      .filter((f): f is PoseResult => !isAbsentFrame(f))
      .map((f) => ({ t: f.timestamp_ms, v: primaryAngle(f, spec, aspect) }));

    const { attempts, unfinished } = countAttempts(values, spec);
    expect(unfinished).toBe(false);
    const reps = attempts.filter((a) => a.counted);
    const partials = attempts.filter((a) => !a.counted);
    expect(reps.length).toBe(clip.expected!.reps);
    expect(partials.length).toBe(clip.expected!.partials);
    for (const a of reps) {
      expect(s * (p.count_min - a.extreme)).toBeGreaterThanOrEqual(5); // well past count_min
      expect(s * (a.topAfter - p.start_enter)).toBeGreaterThanOrEqual(1); // back past start_enter
    }
    for (const a of partials) expect(s * (p.count_min - a.extreme)).toBeLessThanOrEqual(-5); // short of count_min

    // Set end: a long enough still or absent tail exactly when `expected.set_end` says so.
    const endT = clip.frames[clip.frames.length - 1].timestamp_ms;
    const tailMs = p.set_end_still_ms + 1000;
    const tail = clip.frames.filter((f) => f.timestamp_ms >= endT - tailMs);
    const allAbsent = tail.every(isAbsentFrame);
    const tailValues = values.filter((x) => x.t >= endT - tailMs);
    const still =
      !allAbsent &&
      tail.every((f) => !isAbsentFrame(f)) &&
      Math.max(...tailValues.map((x) => x.v)) - Math.min(...tailValues.map((x) => x.v)) <= p.reverse_deg &&
      tailValues.every((x) => s * (x.v - p.start_enter) > 0);
    expect(clip.expected!.set_end).toBe(allAbsent ? 'absent' : still ? 'still' : null);
  });
});
