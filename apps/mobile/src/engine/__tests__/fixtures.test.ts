/// <reference types="node" />
// Synthetic fixtures: committed JSON matches the generator, every clip is well formed, the
// clean (noise-free) trajectories really contain the intended reps and partials, the form
// rules flag exactly the listed reps, and the press rest clips need the primary gate.
// `UPDATE_FIXTURES=1 npx jest src/engine/__tests__/fixtures.test.ts` rewrites the JSON.

import fs from 'fs';
import path from 'path';

import { JOINT_NAMES, isPoseResult, type PoseResult } from '../../pose/types';
import { FIXTURES_DIR, loadFixtures } from '../__fixtures__/load';
import { runClip, runClipRules } from '../__fixtures__/run';
import { CLIP_DEFS, generateAll, generateClip, serializeClip, sortFlags } from '../__fixtures__/synth';
import { applyInjuries } from '../overrides';
import { isAbsentFrame, type Clip } from '../recording';
import { STILL_BAND_DEG } from '../repCounter';
import { getSpec } from '../specs';
import type { ExerciseSpec, JointAngleSpec, PrimaryGate, SegmentTiltSpec } from '../types';

const fileFor = (name: string) => path.join(FIXTURES_DIR, `${name}.json`);

if (process.env.UPDATE_FIXTURES === '1') {
  for (const clip of generateAll()) fs.writeFileSync(fileFor(clip.name), serializeClip(clip));
}

describe('synthetic fixtures are up to date', () => {
  it('has the sixteen listed clips', () => {
    expect(CLIP_DEFS.map((d) => d.name).sort()).toEqual([
      'bicep_curl_clean', 'lunge_alternating', 'push_up_hip_sag', 'push_up_lockout', 'shoulder_press_clean',
      'shoulder_press_cloud', 'shoulder_press_cropped_wrists', 'shoulder_press_rest_positions', 'squat_absent_end',
      'squat_bounce_pause', 'squat_clean', 'squat_front_knees_in', 'squat_noisy', 'squat_off_form',
      'squat_still_mid', 'squat_threshold_hover',
    ]);
  });

  it('lists the expected flags for every synthetic clip', () => {
    for (const d of CLIP_DEFS) expect(d.expected.flags).toBeDefined();
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
    expect([null, 'still', 'absent', 'lost']).toContain(clip.expected!.set_end);
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
/** Below this raw confidence the primary angle can't be read (the engine's default `minConfidence`). */
const MIN_CONFIDENCE = 0.3;

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

const DEG = 180 / Math.PI;

function sideAngle(r: PoseResult, spec: JointAngleSpec | SegmentTiltSpec, side: 'left' | 'right', aspect: number) {
  const names = spec.type === 'joint_angle' ? spec.joints : [spec.from, spec.to];
  const pts = names.map((n) => point(r, n, side, aspect));
  let angle: number;
  if (spec.type === 'joint_angle') {
    const [a, v, c] = pts;
    const u = [a.X - v.X, a.Y - v.Y];
    const w = [c.X - v.X, c.Y - v.Y];
    const cos = (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]));
    angle = Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
  } else {
    const [from, to] = pts;
    angle = Math.atan2(Math.abs(to.X - from.X), from.Y - to.Y) * DEG; // from image-up
  }
  return {
    angle,
    visibility: pts.reduce((sum, p) => sum + p.c, 0) / pts.length,
    minC: Math.min(...pts.map((p) => p.c)),
  };
}

/**
 * A per-side angle metric with the spec's side mode. The primary angle is NaN when a point it uses is
 * below `MIN_CONFIDENCE`.
 */
function metric(r: PoseResult, spec: ExerciseSpec, name: string, aspect: number): number {
  const m = spec.angles[name] as JointAngleSpec | SegmentTiltSpec;
  const L = sideAngle(r, m, 'left', aspect);
  const R = sideAngle(r, m, 'right', aspect);
  let used: (typeof L)[];
  let value: number;
  switch (m.side ?? 'most_visible') {
    case 'left': [used, value] = [[L], L.angle]; break;
    case 'right': [used, value] = [[R], R.angle]; break;
    case 'min': [used, value] = L.angle <= R.angle ? [[L], L.angle] : [[R], R.angle]; break;
    case 'max': [used, value] = L.angle >= R.angle ? [[L], L.angle] : [[R], R.angle]; break;
    case 'both_avg': [used, value] = [[L, R], (L.angle + R.angle) / 2]; break;
    case 'most_visible': [used, value] = R.visibility > L.visibility ? [[R], R.angle] : [[L], L.angle]; break;
  }
  const primary = name === spec.primary_angle.name;
  return primary && used.some((u) => u.minC < MIN_CONFIDENCE) ? NaN : value;
}

/** How far the frame is past the primary gate's threshold: positive passes. +Infinity with no gate. */
function gateMargin(r: PoseResult, gate: PrimaryGate | undefined, spec: ExerciseSpec, aspect: number): number {
  if (!gate) return Infinity;
  const v = metric(r, spec, gate.metric, aspect);
  return gate.op === '<=' || gate.op === '<' ? gate.value - v : v - gate.value;
}

interface Attempt {
  extreme: number;
  counted: boolean;
  topAfter: number;
  /** Best gate margin on a frame within 5° of count_min or past it; -Infinity if it never got there. */
  gate: number;
}

/**
 * Plain hysteresis count over the clean trajectory, with the deepest value of each attempt. Like the
 * engine, an attempt counts only once it is past count_min on a frame that passes the gate.
 */
function countAttempts(values: { t: number; v: number; gate: number }[], spec: ExerciseSpec) {
  const s = spec.primary_angle.direction === 'decreasing' ? 1 : -1;
  const p = spec.phases;
  const deeper = (v: number, x: number) => s * (x - v) > 0;
  const shallower = (v: number, x: number) => s * (v - x) > 0;
  const attempts: Attempt[] = [];
  let open: Attempt | null = null;
  for (const { v, gate } of values) {
    if (!open) {
      const last = attempts[attempts.length - 1];
      if (last && s * (last.topAfter - v) < 0) last.topAfter = v;
      if (deeper(v, p.start_exit)) open = { extreme: v, counted: false, topAfter: v, gate: -Infinity };
      continue;
    }
    if (deeper(v, open.extreme)) open.extreme = v;
    if (s * (p.count_min - v) > -5) open.gate = Math.max(open.gate, gate);
    if (deeper(open.extreme, p.count_min) && gate > 0) open.counted = true;
    if (shallower(v, p.start_enter)) {
      open.topAfter = v;
      attempts.push(open);
      open = null;
    }
  }
  return { attempts, unfinished: open };
}

describe('clean trajectories contain the intended reps', () => {
  it.each(CLIP_DEFS.map((d) => [d.name, d] as const))('%s', (_name, def) => {
    const clip: Clip = generateClip(def, { clean: true });
    const spec = getSpec(clip.exercise)!;
    const aspect = clip.image.width / clip.image.height;
    const s = spec.primary_angle.direction === 'decreasing' ? 1 : -1;
    const p = spec.phases;
    const primary = (f: PoseResult) => metric(f, spec, spec.primary_angle.name, aspect);
    const values = clip.frames
      .filter((f): f is PoseResult => !isAbsentFrame(f))
      .map((f) => ({ t: f.timestamp_ms, v: primary(f), gate: gateMargin(f, spec.primary_angle.gate, spec, aspect) }));

    const { attempts, unfinished } = countAttempts(values.filter((x) => Number.isFinite(x.v)), spec);
    // An attempt still open when the set ends becomes a partial; otherwise every attempt finishes.
    if (clip.expected!.set_end === null) expect(unfinished).toBeNull();
    const reps = attempts.filter((a) => a.counted);
    const partials = [...attempts.filter((a) => !a.counted), ...(unfinished ? [unfinished] : [])];
    expect(reps.length).toBe(clip.expected!.reps);
    expect(partials.length).toBe(clip.expected!.partials);
    for (const a of reps) {
      expect(s * (p.count_min - a.extreme)).toBeGreaterThanOrEqual(5); // well past count_min
      expect(a.gate).toBeGreaterThanOrEqual(5); // well inside the gate
      expect(s * (a.topAfter - p.start_enter)).toBeGreaterThanOrEqual(1); // back past start_enter
    }
    // Each partial stays 5° short of count_min, or fails the gate by 5° wherever it gets that close.
    for (const a of partials) expect(a.gate).toBeLessThanOrEqual(-5);

    // Set end: a long enough still or unreadable tail exactly when `expected.set_end` says so. An
    // unreadable tail is `lost` when most of it had a person (frames without the primary angle),
    // otherwise `absent`.
    const endT = clip.frames[clip.frames.length - 1].timestamp_ms;
    const tailMs = p.set_end_still_ms + 1000;
    const tail = clip.frames.filter((f) => f.timestamp_ms >= endT - tailMs);
    const tailValues = values.filter((x) => x.t >= endT - tailMs);
    const unreadable = tail.filter((f) => isAbsentFrame(f) || !Number.isFinite(primary(f)));
    const allUnreadable = unreadable.length === tail.length;
    const withPerson = unreadable.filter((f) => !isAbsentFrame(f)).length;
    // Still in any state: the whole tail inside the still band.
    const still =
      tail.every((f) => !isAbsentFrame(f)) &&
      tailValues.every((x) => Number.isFinite(x.v)) &&
      Math.max(...tailValues.map((x) => x.v)) - Math.min(...tailValues.map((x) => x.v)) <= STILL_BAND_DEG;
    const setEnd = allUnreadable ? (withPerson * 2 > tail.length ? 'lost' : 'absent') : still ? 'still' : null;
    expect(clip.expected!.set_end).toBe(setEnd);
  });
});

// ---------------------------------------------------------------------------
// Form rules over the committed clips (base spec, no injuries, view detected).

describe('form rules flag the listed reps', () => {
  const withFlags = loadFixtures().filter((c) => c.expected?.flags !== undefined);

  it.each(withFlags.map((c) => [c.name, c] as const))('%s', (_name, clip) => {
    const { reps, set } = runClipRules(clip);
    // The set's held flags when it ended, otherwise every evaluated rep's.
    const flags = set ? set.flags : reps.flatMap((r) => r.flags);
    if (set) expect(set.flags).toEqual(reps.flatMap((r) => r.flags));
    expect(reps).toHaveLength(clip.expected!.reps);
    expect(sortFlags(flags)).toEqual(sortFlags(clip.expected!.flags!));
  });

  it('a lower back injury tightens trunk_lean on squat_clean to a safety flag', () => {
    const clip = loadFixtures().find((c) => c.name === 'squat_clean')!;
    const base = runClipRules(clip);
    const injured = runClipRules(clip, applyInjuries(getSpec('squat')!, ['lower_back']));
    expect(base.set).not.toBeNull();
    expect(injured.set).not.toBeNull();
    const lean = base.reps.map((r) => r.outcomes.find((o) => o.rule_id === 'trunk_lean')!);
    // Every clean rep leans between the injured limit (35) and the base limit (45).
    expect(lean.every((o) => o.status === 'pass')).toBe(true);
    const over = lean.flatMap((o, i) => (o.value! > 35 ? [i] : []));
    expect(over.length).toBeGreaterThan(0);
    expect(over.length).toBeLessThan(lean.length);

    const safety = injured.set!.flags.filter((f) => f.rule_id === 'trunk_lean');
    expect(safety.map((f) => f.rep_index)).toEqual(over);
    expect(safety.every((f) => f.severity === 'safety')).toBe(true);
    expect(base.set!.flags.some((f) => f.severity === 'safety')).toBe(false);
    const agg = injured.set!.rules.find((a) => a.rule_id === 'trunk_lean')!;
    expect(agg).toMatchObject({ severity: 'safety', n: over.length });
  });
});

// ---------------------------------------------------------------------------
// The rest clips reproduce device false reps: without the primary gate, rests count.

describe('the press rest clips need the primary gate', () => {
  const spec = getSpec('shoulder_press')!;
  const { name, direction } = spec.primary_angle;
  const ungated: ExerciseSpec = { ...spec, primary_angle: { name, direction } };

  it.each(['shoulder_press_rest_positions', 'shoulder_press_cropped_wrists'])('%s', (clipName) => {
    const clip = loadFixtures().find((c) => c.name === clipName)!;
    expect(spec.primary_angle.gate).toBeDefined();
    expect(runClip(clip).counted).toHaveLength(clip.expected!.reps);
    expect(runClip(clip, {}, ungated).counted.length).toBeGreaterThan(clip.expected!.reps);
  });
});
