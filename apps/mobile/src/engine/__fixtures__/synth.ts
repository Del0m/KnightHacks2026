// Seeded generator for the synthetic engine fixtures (design §6). Each clip drives the primary joint
// angle along a scripted trajectory and builds a 2D stick figure around it in pixel space
// (1080 × 1920 portrait), so the expected rep counts hold by construction. Pixel space is uniform,
// which is what the engine measures after scaling x by imageAspect.
//
// Regenerate the committed JSON with `UPDATE_FIXTURES=1 npx jest src/engine/__tests__/fixtures.test.ts`.

import { JOINT_NAMES, type Joint, type PoseResult, type PoseSource } from '../../pose/types';
import type { Clip, ClipFrame } from '../recording';

export const IMAGE = { width: 1080, height: 1920 } as const;
const BASE_TIME_MS = 1_760_000_000_000;

// ---------------------------------------------------------------------------
// Random numbers

/** mulberry32: small, fast, deterministic 32-bit PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  uniform(lo = 0, hi = 1): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.uniform(lo, hi + 1));
  }
  /** Standard normal, Box-Muller. */
  gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

// ---------------------------------------------------------------------------
// Trajectory scripts

export type Leg = 'left' | 'right';

export type Segment =
  /**
   * Ease (cosine in-out) from the current angle to `to`. Shoulder press: the upper arm's raise eases
   * alongside, to `raise`, or to `to` when unset (a press arm, where the two match).
   */
  | { kind: 'move'; to: number; ms: number; raise?: number }
  | { kind: 'hold'; ms: number }
  /** Sine wobble of ±`amp` around the current angle, whole cycles so it ends where it began. */
  | { kind: 'wobble'; ms: number; amp: number; cycles: number }
  /** No person in frame; the angle holds underneath. */
  | { kind: 'absent'; ms: number }
  /** Lunge only: which leg leads from here on. Takes no time. */
  | { kind: 'front'; leg: Leg }
  /** Form faults from here on (unset fields are clean). Takes no time. */
  | { kind: 'form'; form: Partial<Form> };

export const move = (to: number, ms: number, raise?: number): Segment => ({ kind: 'move', to, ms, raise });
export const hold = (ms: number): Segment => ({ kind: 'hold', ms });
export const wobble = (ms: number, amp: number, cycles: number): Segment => ({ kind: 'wobble', ms, amp, cycles });
export const absent = (ms: number): Segment => ({ kind: 'absent', ms });
export const front = (leg: Leg): Segment => ({ kind: 'front', leg });
export const form = (f: Partial<Form> = {}): Segment => ({ kind: 'form', form: f });

/** Per-segment knobs for the stick figures: form faults, and which way the press forearm turns. */
export interface Form {
  /** Squat: trunk lean from vertical per degree of knee bend, plus 5°. */
  lean: number;
  /** Push-up: how far the hips drop below the shoulder-ankle line at the bottom, px. */
  sag: number;
  /** Three-quarter squat: how far each knee moves toward the midline at 90° of bend, px. */
  kneesIn: number;
  /**
   * Shoulder press: the forearm turns `up` from the upper arm (pressing) or `down` toward the lap
   * (resting). Both read the same at an elbow angle of 0 or 180, so switch only there.
   */
  forearm: 'up' | 'down';
}

const CLEAN_FORM: Form = { lean: 0.35, sag: 0, kneesIn: 0, forearm: 'up' };

/** One rep out to `deep` and back to `top`. */
export function rep(deep: number, top: number, t: { downMs: number; bottomMs: number; upMs: number; topMs: number }): Segment[] {
  return [move(deep, t.downMs), hold(t.bottomMs), move(top, t.upMs), hold(t.topMs)];
}

interface Sample {
  angle: number;
  /** Shoulder press: the upper arm's angle out from hanging straight down. Holds and wobbles keep it. */
  raise: number;
  absent: boolean;
  front: Leg;
  form: Form;
}

const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);

/** Total script duration in ms. */
export function scriptDuration(script: Segment[]): number {
  return script.reduce((sum, s) => sum + ('ms' in s ? s.ms : 0), 0);
}

/** The scripted angle at `t` ms after the clip start. */
export function sampleScript(script: Segment[], startAngle: number, t: number): Sample {
  let angle = startAngle;
  let raise = startAngle;
  let leg: Leg = 'left';
  let f: Form = CLEAN_FORM;
  let t0 = 0;
  for (const s of script) {
    if (s.kind === 'front') {
      leg = s.leg;
      continue;
    }
    if (s.kind === 'form') {
      f = { ...CLEAN_FORM, ...s.form };
      continue;
    }
    const end = t0 + s.ms;
    if (t < end) {
      const tau = t - t0;
      switch (s.kind) {
        case 'move': {
          const k = ease(tau / s.ms);
          return { angle: angle + (s.to - angle) * k, raise: raise + ((s.raise ?? s.to) - raise) * k, absent: false, front: leg, form: f };
        }
        case 'hold':
          return { angle, raise, absent: false, front: leg, form: f };
        case 'wobble':
          return { angle: angle + s.amp * Math.sin((2 * Math.PI * s.cycles * tau) / s.ms), raise, absent: false, front: leg, form: f };
        case 'absent':
          return { angle, raise, absent: true, front: leg, form: f };
      }
    }
    if (s.kind === 'move') {
      angle = s.to;
      raise = s.raise ?? s.to;
    }
    t0 = end;
  }
  const last = script[script.length - 1];
  return { angle, raise, absent: last?.kind === 'absent', front: leg, form: f };
}

// ---------------------------------------------------------------------------
// Stick figures (pixel space). Builders work facing +x; `facing: -1` mirrors the result.

type P = [number, number];
type Pose = Record<string, P>;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Unit vector `deg` clockwise from image-up (−y). */
const dir = (deg: number): P => [Math.sin(rad(deg)), -Math.cos(rad(deg))];
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const lerp = (a: P, b: P, k: number): P => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const len = (v: P) => Math.hypot(v[0], v[1]);
/** Angle of a vector, clockwise from image-up, in degrees. */
const heading = (v: P) => (Math.atan2(v[0], -v[1]) * 180) / Math.PI;

/** Side-view head: nose ahead of the neck, near eye and ear behind it. */
function sideHead(p: Pose, near: Leg, nose: P) {
  const far: Leg = near === 'left' ? 'right' : 'left';
  p.nose = nose;
  p[`${near}_eye`] = add(nose, [-14, -16]);
  p[`${far}_eye`] = add(nose, [-4, -19]);
  p[`${near}_ear`] = add(nose, [-75, -4]);
  p[`${far}_ear`] = add(nose, [-66, -8]);
}

/** Copies the near-side joints of `names` to the far side, shifted slightly (depth parallax). */
function farFromNear(p: Pose, near: Leg, names: string[], offset: P) {
  const far: Leg = near === 'left' ? 'right' : 'left';
  for (const n of names) p[`${far}_${n}`] = add(p[`${near}_${n}`], offset);
}

const LIMBS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];
const FAR_OFFSET: P = [-12, -5];

/** Squat, side view. `theta` is the knee angle (hip-knee-ankle). Arms crossed at the chest. */
function squatPose(theta: number, near: Leg, f: Form): Pose {
  const p: Pose = {};
  const bend = 180 - theta;
  const ankle: P = [470, 1720];
  const alpha = bend * 0.42; // shin leans forward
  const knee = add(ankle, dir(alpha), 430);
  const hip = add(knee, dir(-(bend - alpha)), 440); // thigh leans back; interior angle = theta
  const lean = bend * f.lean + 5;
  const shoulder = add(hip, dir(lean), 500);
  const elbow = add(shoulder, dir(150), 270);
  const wrist = add(elbow, dir(-10), 250);
  Object.assign(p, {
    [`${near}_ankle`]: ankle, [`${near}_knee`]: knee, [`${near}_hip`]: hip,
    [`${near}_shoulder`]: shoulder, [`${near}_elbow`]: elbow, [`${near}_wrist`]: wrist,
  });
  farFromNear(p, near, LIMBS, FAR_OFFSET);
  sideHead(p, near, add(add(shoulder, dir(lean * 0.5), 150), [40, 10]));
  return p;
}

/** Body yaw for the three-quarter squat: 0 is square to the camera, 90 is a side view. */
const QUARTER_YAW = 30;

/**
 * Squat, three-quarter view from the front (body turned `QUARTER_YAW`°), so the knee angle still reads
 * while the torso is wide enough to detect as `front`. Square-on, hip, knee and ankle line up and the
 * 2D knee angle stays at 180. `theta` is the true knee angle; the projected one is shallower (about
 * 117 at a true 75). Built in 3D (lateral, forward, up) and projected orthographically. `f.kneesIn`
 * pulls both knees toward the midline in proportion to depth.
 */
function squatQuarterPose(theta: number, f: Form): Pose {
  const p: Pose = {};
  const bend = 180 - theta;
  const alpha = bend * 0.42;
  // Sagittal plane: [forward, image y] relative to the ankle.
  const knee = dir(alpha).map((v) => v * 430) as P;
  const hip = add(knee, dir(-(bend - alpha)), 440);
  const shoulder = add(hip, dir(bend * f.lean + 5), 500);
  const cos = Math.cos(rad(QUARTER_YAW));
  const sin = Math.sin(rad(QUARTER_YAW));
  const at = (q: P, lateral: number): P => [540 + lateral * cos + q[0] * sin, 1720 + q[1]];
  const kneeOut = 100 - f.kneesIn * Math.min(1, bend / 90);
  // Unmirrored image of a lifter facing the camera: their left is on the image right.
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    p[`${side}_ankle`] = at([0, 0], 105 * s);
    p[`${side}_knee`] = at(knee, kneeOut * s);
    p[`${side}_hip`] = at(hip, 95 * s);
    p[`${side}_shoulder`] = at(shoulder, 135 * s);
    p[`${side}_elbow`] = at(add(shoulder, [150, 100]), 120 * s); // arms crossed at the chest
    p[`${side}_wrist`] = at(add(shoulder, [200, 20]), 60 * s);
    p[`${side}_eye`] = at(add(shoulder, [60, -150]), 28 * s);
    p[`${side}_ear`] = at(add(shoulder, [20, -140]), 62 * s);
  }
  p.nose = at(add(shoulder, [70, -130]), 0);
  return p;
}

/**
 * Push-up, side view, head toward +x. `phi` is the elbow angle (shoulder-elbow-wrist). `f.sag` drops
 * the hips in proportion to depth, reaching the full amount at 90°.
 */
function pushUpPose(phi: number, near: Leg, f: Form): Pose {
  const p: Pose = {};
  const wrist: P = [720, 1250];
  const delta = (180 - phi) * 0.15; // forearm tips toward the feet
  const elbow = add(wrist, dir(-delta), 140);
  const shoulder = add(elbow, dir(180 - delta - phi), 150);
  const ankle: P = [60, 1262];
  const hip = add(lerp(ankle, shoulder, 0.52), [0, 8 + f.sag * Math.min(1, (180 - phi) / 90)]);
  const knee = add(lerp(ankle, hip, 0.5), [0, 4]);
  Object.assign(p, {
    [`${near}_ankle`]: ankle, [`${near}_knee`]: knee, [`${near}_hip`]: hip,
    [`${near}_shoulder`]: shoulder, [`${near}_elbow`]: elbow, [`${near}_wrist`]: wrist,
  });
  farFromNear(p, near, LIMBS, FAR_OFFSET);
  const body = sub(shoulder, ankle);
  const u: P = [body[0] / len(body), body[1] / len(body)];
  sideHead(p, near, add(add(shoulder, u, 100), [0, -25]));
  return p;
}

/** Bicep curl, side view, standing. `phi` is the elbow angle. */
function curlPose(phi: number, near: Leg): Pose {
  const p: Pose = {};
  const ankle: P = [520, 1720];
  const knee: P = [522, 1290];
  const hip: P = [515, 860];
  const shoulder: P = [522, 362];
  const drift = (180 - phi) * 0.06; // upper arm creeps forward near the top
  const elbow = add(shoulder, dir(180 - drift), 280);
  const wrist = add(elbow, dir(-drift + phi), 260);
  Object.assign(p, {
    [`${near}_ankle`]: ankle, [`${near}_knee`]: knee, [`${near}_hip`]: hip,
    [`${near}_shoulder`]: shoulder, [`${near}_elbow`]: elbow, [`${near}_wrist`]: wrist,
  });
  farFromNear(p, near, LIMBS, FAR_OFFSET);
  sideHead(p, near, add(shoulder, [40, -150]));
  return p;
}

/** How much shorter the resting forearm looks at most, as it points toward the camera. */
const FOREARM_FORESHORTEN = 0.35;

/**
 * Shoulder press, front view. `phi` is the elbow angle on both arms; `raise` is the upper arm's angle
 * out from hanging straight down (0), through level with the shoulder (90), to overhead (180). With
 * `forearm: 'up'` and `raise = phi` the forearms stay vertical (pressing). With `forearm: 'down'` they
 * turn down and in, toward the lap, and look shorter the more they point at the camera; an elbow
 * angle of ~130 rests the hands in the lap, ~60 holds them at chest height.
 */
function pressPose(phi: number, raise: number, forearm: Form['forearm']): Pose {
  const p: Pose = {};
  // Unmirrored image of a lifter facing the camera: their left is on the image right.
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    const shoulder: P = [540 + 135 * s, 720];
    const elbow = add(shoulder, dir(-s * raise), -260);
    // Forearm heading, clockwise from image-up on the image-right arm.
    const heading = forearm === 'up' ? phi - raise : 360 - raise - phi;
    const reach = forearm === 'up' ? 240 : 240 * (1 - FOREARM_FORESHORTEN * Math.sin(rad(phi)));
    p[`${side}_shoulder`] = shoulder;
    p[`${side}_elbow`] = elbow;
    p[`${side}_wrist`] = add(elbow, dir(s * heading), reach);
    p[`${side}_hip`] = [540 + 95 * s, 1150];
    p[`${side}_knee`] = [540 + 100 * s, 1440];
    p[`${side}_ankle`] = [540 + 105 * s, 1730];
    p[`${side}_eye`] = [540 + 28 * s, 535];
    p[`${side}_ear`] = [540 + 62 * s, 550];
  }
  p.nose = [540, 565];
  return p;
}

const LUNGE_FLOOR = 1720;
const THIGH = 440;
const SHIN = 430;

/**
 * Lunge, side view. `theta` is the front knee angle; the back knee bends a little less, so the front
 * knee is always the `min` side. The stride opens with depth, so the feet come together at the top.
 */
function lungePose(theta: number, near: Leg, lead: Leg): Pose {
  const p: Pose = {};
  const back: Leg = lead === 'left' ? 'right' : 'left';
  const bend = 180 - theta;
  const stride = (bend / 90) * 300;
  const fAnkle: P = [600 + 0.6 * stride, LUNGE_FLOOR];
  const alpha = bend * 0.2;
  const fKnee = add(fAnkle, dir(alpha), SHIN);
  const hip = add(fKnee, dir(-(bend - alpha)), THIGH);
  // Back leg: two-link IK with its foot on the floor (heel lifts once the hip is too high).
  const thetaB = 180 - bend * 0.85;
  const reach = Math.sqrt(THIGH ** 2 + SHIN ** 2 - 2 * THIGH * SHIN * Math.cos(rad(thetaB)));
  const dy = Math.min(reach, LUNGE_FLOOR - hip[1]);
  const bAnkle = add(hip, [-Math.sqrt(Math.max(0, reach ** 2 - dy ** 2)), dy]);
  const psi = (Math.acos(Math.min(1, (THIGH ** 2 + reach ** 2 - SHIN ** 2) / (2 * THIGH * reach))) * 180) / Math.PI;
  const bKnee = add(hip, dir(heading(sub(bAnkle, hip)) - psi), THIGH);
  const shoulder = add(hip, dir(4), 500);
  const elbow = add(shoulder, dir(172), 270);
  const wrist = add(elbow, dir(170), 250);

  const legs: Record<Leg, { hip: P; knee: P; ankle: P }> = {
    left: { hip, knee: fKnee, ankle: fAnkle },
    right: { hip, knee: fKnee, ankle: fAnkle },
  };
  legs[back] = { hip, knee: bKnee, ankle: bAnkle };
  const far: Leg = near === 'left' ? 'right' : 'left';
  for (const side of ['left', 'right'] as const) {
    const o: P = side === far ? FAR_OFFSET : [0, 0];
    p[`${side}_hip`] = add(legs[side].hip, o);
    p[`${side}_knee`] = add(legs[side].knee, o);
    p[`${side}_ankle`] = add(legs[side].ankle, o);
    p[`${side}_shoulder`] = add(shoulder, o);
    p[`${side}_elbow`] = add(elbow, o);
    p[`${side}_wrist`] = add(wrist, o);
  }
  sideHead(p, near, add(shoulder, [40, -150]));
  return p;
}

// ---------------------------------------------------------------------------
// Clip definitions

export type ExerciseId = 'squat' | 'push_up' | 'bicep_curl' | 'shoulder_press' | 'lunge';

export interface ExpectedFlag {
  rule_id: string;
  rep_index: number;
}

/** Flags in a canonical order: by rep, then rule id. */
export const sortFlags = (flags: readonly ExpectedFlag[]): ExpectedFlag[] =>
  flags
    .map(({ rule_id, rep_index }) => ({ rule_id, rep_index }))
    .sort((a, b) => a.rep_index - b.rep_index || (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));

/** `{ tempo: [0, 2] }` → the flag list, sorted. */
const flagged = (byRule: Record<string, number[]>): ExpectedFlag[] =>
  sortFlags(Object.entries(byRule).flatMap(([rule_id, reps]) => reps.map((rep_index) => ({ rule_id, rep_index }))));

export interface ClipDef {
  name: string;
  exercise: ExerciseId;
  description: string;
  seed: number;
  /** Fixed rate, or a [lo, hi] range drawn per frame interval. */
  fps: number | [number, number];
  /** Uniform ± timestamp jitter, ms. */
  jitterMs: number;
  /** Gaussian position noise σ, normalized units per axis. */
  noise: number;
  /** One-frame outliers on a single joint. */
  spikes: number;
  /** Runs of 2–5 frames where one joint drops below c 0.3. */
  dips: number;
  view: 'side' | 'front';
  /** Side views: which way the lifter faces in the image. */
  facing: 1 | -1;
  /** Confidence range for far-side joints in side views. */
  farConfidence: [number, number];
  source: PoseSource;
  startAngle: number;
  script: Segment[];
  /** Extra no-person windows `[startMs, durationMs]` laid over the script. */
  absentWindows: [number, number][];
  /** Moves the whole figure down, px, as a lower camera does (the lap near the bottom edge). */
  offsetY: number;
  expected: {
    reps: number;
    partials: number;
    set_end: 'still' | 'absent' | 'lost' | null;
    /** Every rule flag with the base spec, no injuries, view detected (design AI-07 §8). */
    flags?: ExpectedFlag[];
  };
}

const SQUAT_TOP = 172;
const SQUAT_TEMPO = { downMs: 1100, bottomMs: 150, upMs: 1000, topMs: 400 };

const squatReps = (bottoms: number[], tempo = SQUAT_TEMPO, top = SQUAT_TOP) =>
  bottoms.flatMap((b) => rep(b, top, tempo));

const DEFAULTS = {
  fps: 15,
  jitterMs: 0,
  noise: 0.0015,
  spikes: 0,
  dips: 0,
  view: 'side',
  facing: 1,
  farConfidence: [0.5, 0.7],
  source: 'coreml',
  absentWindows: [],
  offsetY: 0,
} as const satisfies Partial<ClipDef>;

const NOISY_TEMPO = { downMs: 1100, bottomMs: 150, upMs: 1000, topMs: 600 };
const NOISY_REP_MS = 2850;
const NOISY_LEAD_MS = 1500;

const HOVER_BASE = 166;
const hoverPartial = (depth: number) => [move(depth, 800), hold(100), move(HOVER_BASE, 800)];
const hoverRep = (b: number) => rep(b, HOVER_BASE, { downMs: 1100, bottomMs: 150, upMs: 1000, topMs: 0 });
const hoverWobble = (cycles: number) => wobble(cycles * 1000, 3, cycles);

const BOUNCE_TEMPO = { downMs: 1100, bottomMs: 1500, upMs: 1000, topMs: 1500 };

const PUSH_UP_TOP = 168;
const pushUpRep = (b: number) => [move(b, 1000), hold(150), move(150, 800), move(PUSH_UP_TOP, 600), hold(500)];

const CURL_TOP = 165;
const curlRep = (b: number) => rep(b, CURL_TOP, { downMs: 900, bottomMs: 200, upMs: 1000, topMs: 300 });

const PRESS_RACK = 85;
const pressRep = (top: number) => rep(top, PRESS_RACK, { downMs: 1000, bottomMs: 250, upMs: 1100, topMs: 400 });
/** Resting arm positions as (elbow angle, upper arm raise); see `pressPose`. */
const PRESS_LAP = { phi: 131, raise: 10 };
const PRESS_SIDES = { phi: 180, raise: 8 };
const PRESS_CHEST = { phi: 60, raise: 25 };
/** Hands in front of the shoulders, elbows down: where the forearm switches between up and down. */
const PRESS_SHOULDERS = { phi: 0, raise: 30 };
const pressTo = (at: { phi: number; raise: number }, ms: number) => move(at.phi, ms, at.raise);
/** From the rack down to rest the hands in the lap for `ms`, then back up to the rack. */
const pressLapRest = (ms: number) => [
  pressTo(PRESS_SHOULDERS, 800), form({ forearm: 'down' }), pressTo(PRESS_LAP, 1100), hold(ms),
  pressTo(PRESS_SHOULDERS, 1100), form(), move(PRESS_RACK, 800),
];

const STILL_MID_KNEE = 144;

const LUNGE_TOP = 176;
const lungeRep = (lead: Leg, b: number) => [front(lead), ...rep(b, LUNGE_TOP, { downMs: 1200, bottomMs: 200, upMs: 1100, topMs: 500 })];

export const CLIP_DEFS: readonly ClipDef[] = [
  {
    ...DEFAULTS,
    name: 'squat_clean',
    exercise: 'squat',
    description: '6 reps, side view, 15 fps, light noise, then 9.5 s standing still',
    seed: 101,
    startAngle: SQUAT_TOP,
    script: [hold(1500), ...squatReps([88, 92, 85, 90, 94, 87]), hold(9100)],
    expected: { reps: 6, partials: 0, set_end: 'still', flags: flagged({ tempo: [2, 4, 5] }) },
  },
  {
    ...DEFAULTS,
    name: 'squat_noisy',
    exercise: 'squat',
    description:
      '6 reps, σ=0.006 noise, 10–15 fps with timestamp jitter, outlier spikes, low-confidence dips, ' +
      'far side mostly below 0.5, two 0.5 s dropouts (one mid-descent)',
    seed: 202,
    fps: [10, 15],
    jitterMs: 8,
    noise: 0.006,
    spikes: 5,
    dips: 3,
    farConfidence: [0.15, 0.5],
    startAngle: SQUAT_TOP,
    script: [hold(NOISY_LEAD_MS), ...squatReps([90, 86, 93, 88, 91, 89], NOISY_TEMPO), hold(1200)],
    absentWindows: [
      [NOISY_LEAD_MS + NOISY_REP_MS + 300, 500], // rep 2, on the way down
      [NOISY_LEAD_MS + 3 * NOISY_REP_MS - 560, 500], // standing between reps 3 and 4
    ],
    expected: { reps: 6, partials: 0, set_end: null, flags: flagged({ tempo: [1, 5] }) },
  },
  {
    ...DEFAULTS,
    name: 'squat_threshold_hover',
    exercise: 'squat',
    description:
      'Standing angle wobbles 163–169 (across start_enter, never past start_exit) before and between ' +
      'reps; 4 reps and 2 partials that stop at ~142',
    seed: 303,
    startAngle: HOVER_BASE,
    script: [
      hoverWobble(3),
      ...hoverRep(90), hoverWobble(1),
      ...hoverPartial(142), hoverWobble(1),
      ...hoverRep(88), hoverWobble(1),
      ...hoverPartial(143), hoverWobble(1),
      ...hoverRep(92), hoverWobble(1),
      ...hoverRep(89), hoverWobble(1),
    ],
    expected: { reps: 4, partials: 2, set_end: null, flags: [] },
  },
  {
    ...DEFAULTS,
    name: 'squat_bounce_pause',
    exercise: 'squat',
    description: '4 reps with a 1.5 s pause at the bottom (one with a 3° bounce) and 1.5 s pauses at the top',
    seed: 404,
    startAngle: SQUAT_TOP,
    script: [
      hold(1500),
      ...rep(88, SQUAT_TOP, BOUNCE_TEMPO),
      move(88, 1100), hold(500), move(91, 250), move(88, 250), hold(500), move(SQUAT_TOP, 1000), hold(1500),
      ...rep(90, SQUAT_TOP, BOUNCE_TEMPO),
      ...rep(87, SQUAT_TOP, BOUNCE_TEMPO),
    ],
    expected: { reps: 4, partials: 0, set_end: null, flags: flagged({ tempo: [1] }) },
  },
  {
    ...DEFAULTS,
    name: 'squat_absent_end',
    exercise: 'squat',
    description: '3 reps, then the person leaves the frame for 9.3 s',
    seed: 505,
    startAngle: SQUAT_TOP,
    script: [hold(1000), ...squatReps([89, 91, 87]), hold(800), absent(9300)],
    expected: { reps: 3, partials: 0, set_end: 'absent', flags: flagged({ tempo: [0] }) },
  },
  {
    ...DEFAULTS,
    name: 'squat_off_form',
    exercise: 'squat',
    description: '6 reps, side view: reps 2 and 4 stop at ~110 (shallow), reps 3 and 5 lean the trunk to ~55',
    seed: 515,
    startAngle: SQUAT_TOP,
    script: [
      hold(1500),
      ...squatReps([90]),
      ...squatReps([110]),
      form({ lean: 0.55 }), ...squatReps([88]), form(),
      ...squatReps([112]),
      form({ lean: 0.55 }), ...squatReps([91]), form(),
      ...squatReps([89]),
      hold(700),
    ],
    expected: {
      reps: 6,
      partials: 0,
      set_end: null,
      flags: flagged({ depth: [1, 3], trunk_lean: [2, 4], tempo: [0, 1, 3, 5] }),
    },
  },
  {
    ...DEFAULTS,
    name: 'squat_front_knees_in',
    exercise: 'squat',
    description:
      `6 reps, front three-quarter view (turned ${QUARTER_YAW}°), true knee angle ~75 at the bottom; ` +
      'on reps 2, 4 and 6 the knees move 25 px inward',
    seed: 525,
    view: 'front',
    startAngle: SQUAT_TOP,
    script: [
      hold(1500),
      ...[75, 72, 78, 74, 76, 73].flatMap((b, i) => [form(i % 2 ? { kneesIn: 25 } : {}), ...squatReps([b])]),
      form(),
      hold(700),
    ],
    expected: { reps: 6, partials: 0, set_end: null, flags: flagged({ knee_tracking: [1, 3, 5], tempo: [0, 1, 2, 3, 4, 5] }) },
  },
  {
    ...DEFAULTS,
    name: 'squat_still_mid',
    exercise: 'squat',
    description: `3 reps, then stops halfway down (knee ~${STILL_MID_KNEE}) and holds there, wobbling ±3°, for 9.3 s`,
    seed: 535,
    startAngle: SQUAT_TOP,
    script: [hold(1500), ...squatReps([89, 92, 88]), move(STILL_MID_KNEE, 900), wobble(9300, 3, 9)],
    expected: { reps: 3, partials: 1, set_end: 'still', flags: flagged({ tempo: [1, 2] }) },
  },
  {
    ...DEFAULTS,
    name: 'push_up_lockout',
    exercise: 'push_up',
    description: '5 reps, side view; each lockout eases from 150 to 168 over 0.6 s, past start_enter at 155',
    seed: 606,
    facing: -1,
    startAngle: PUSH_UP_TOP,
    script: [hold(1500), ...[85, 88, 84, 90, 86].flatMap(pushUpRep), hold(700)],
    expected: { reps: 5, partials: 0, set_end: null, flags: flagged({ depth: [1, 3], tempo: [0, 1, 2, 3, 4] }) },
  },
  {
    ...DEFAULTS,
    name: 'push_up_hip_sag',
    exercise: 'push_up',
    description: '5 reps, side view; the hips sag ~90 px below the shoulder-ankle line at the bottom of reps 2 and 4',
    seed: 616,
    facing: -1,
    startAngle: PUSH_UP_TOP,
    script: [
      hold(1500),
      ...pushUpRep(86),
      form({ sag: 90 }), ...pushUpRep(88), form(),
      ...pushUpRep(85),
      form({ sag: 90 }), ...pushUpRep(87), form(),
      ...pushUpRep(84),
      hold(700),
    ],
    expected: { reps: 5, partials: 0, set_end: null, flags: flagged({ hip_sag: [1, 3], tempo: [0, 1, 2, 3, 4] }) },
  },
  {
    ...DEFAULTS,
    name: 'bicep_curl_clean',
    exercise: 'bicep_curl',
    description: '8 reps, side view, 15 fps, light noise',
    seed: 707,
    facing: -1,
    startAngle: CURL_TOP,
    script: [hold(1500), ...[45, 48, 42, 50, 46, 44, 52, 47].flatMap(curlRep), hold(700)],
    expected: { reps: 8, partials: 0, set_end: null, flags: flagged({ tempo: [0, 1, 2, 3, 4, 6, 7] }) },
  },
  {
    ...DEFAULTS,
    name: 'shoulder_press_clean',
    exercise: 'shoulder_press',
    description: '6 reps, front view, elbow 85° at the rack to ~170° overhead',
    seed: 808,
    view: 'front',
    startAngle: PRESS_RACK,
    script: [hold(1500), ...[170, 168, 172, 169, 171, 167].flatMap(pressRep), hold(600)],
    expected: { reps: 6, partials: 0, set_end: null, flags: [] },
  },
  {
    ...DEFAULTS,
    name: 'shoulder_press_cloud',
    exercise: 'shoulder_press',
    description: '6 reps, front view, cloud mode: 10 fps, timestamp jitter, σ=0.005 noise',
    seed: 909,
    view: 'front',
    fps: 10,
    jitterMs: 15,
    noise: 0.005,
    spikes: 2,
    source: 'cloud',
    startAngle: PRESS_RACK,
    script: [hold(1500), ...[169, 171, 166, 170, 168, 172].flatMap(pressRep), hold(600)],
    expected: { reps: 6, partials: 0, set_end: null, flags: [] },
  },
  {
    ...DEFAULTS,
    name: 'shoulder_press_rest_positions',
    exercise: 'shoulder_press',
    description:
      '3 reps, front view, then rests without pressing: arms drop to hang straight (elbow ~180), hands ' +
      'to the lap (elbow ~131), chest height (elbow ~60), the sides, the lap and chest height again, ' +
      'then rests in the lap for 9.2 s',
    seed: 818,
    view: 'front',
    startAngle: PRESS_RACK,
    script: [
      hold(1000), ...[170, 168, 171].flatMap(pressRep),
      pressTo(PRESS_SIDES, 1200), form({ forearm: 'down' }), hold(600),
      pressTo(PRESS_LAP, 1000), hold(1000),
      pressTo(PRESS_CHEST, 1100), hold(600),
      pressTo(PRESS_SIDES, 1100), hold(600),
      pressTo(PRESS_LAP, 1000), hold(600),
      pressTo(PRESS_CHEST, 1000), hold(600),
      pressTo(PRESS_LAP, 1000), hold(9200),
    ],
    expected: { reps: 3, partials: 3, set_end: 'still', flags: [] },
  },
  {
    ...DEFAULTS,
    name: 'shoulder_press_cropped_wrists',
    exercise: 'shoulder_press',
    description:
      '4 reps, front view, camera low so the lap is near the bottom edge; between reps the hands rest in ' +
      'the lap, where the wrists are cropped (c 0.1–0.4, mostly under 0.3, and 20–40 px jitter)',
    seed: 828,
    view: 'front',
    offsetY: 700,
    startAngle: PRESS_RACK,
    script: [
      hold(1000), ...pressRep(170),
      ...[168, 171, 169].flatMap((top) => [...pressLapRest(1500), ...pressRep(top)]),
      hold(300),
    ],
    expected: { reps: 4, partials: 3, set_end: null, flags: [] },
  },
  {
    ...DEFAULTS,
    name: 'lunge_alternating',
    exercise: 'lunge',
    description: '6 reps, side view, front leg alternates left/right each rep',
    seed: 1010,
    startAngle: LUNGE_TOP,
    script: [
      hold(1500),
      ...(['left', 'right', 'left', 'right', 'left', 'right'] as const).flatMap((l, i) => lungeRep(l, [92, 95, 90, 94, 91, 93][i])),
      hold(500),
    ],
    expected: { reps: 6, partials: 0, set_end: null, flags: [] },
  },
];

// ---------------------------------------------------------------------------
// Generation

/** The joints that form the primary angle (both sides), for keeping spikes off the counter. */
const PRIMARY_JOINTS: Record<ExerciseId, string[]> = {
  squat: ['hip', 'knee', 'ankle'],
  lunge: ['hip', 'knee', 'ankle'],
  push_up: ['shoulder', 'elbow', 'wrist'],
  bicep_curl: ['shoulder', 'elbow', 'wrist'],
  shoulder_press: ['shoulder', 'elbow', 'wrist'],
};
/** How deep (past count_min) the clean angle must be before a primary joint may spike. */
const SPIKE_SAFE: Record<ExerciseId, (a: number) => boolean> = {
  squat: (a) => a < 115,
  lunge: (a) => a < 110,
  push_up: (a) => a < 100,
  bicep_curl: (a) => a < 80,
  shoulder_press: (a) => a > 155,
};

function buildPose(def: ClipDef, s: Sample): Pose {
  const near: Leg = def.facing === 1 ? 'right' : 'left';
  let p: Pose;
  switch (def.exercise) {
    case 'squat': p = def.view === 'front' ? squatQuarterPose(s.angle, s.form) : squatPose(s.angle, near, s.form); break;
    case 'push_up': p = pushUpPose(s.angle, near, s.form); break;
    case 'bicep_curl': p = curlPose(s.angle, near); break;
    case 'shoulder_press': p = pressPose(s.angle, s.raise, s.form.forearm); break;
    case 'lunge': p = lungePose(s.angle, near, s.front); break;
  }
  if (def.view === 'side' && def.facing === -1) {
    for (const k of Object.keys(p)) p[k] = [IMAGE.width - p[k][0], p[k][1]];
  }
  if (def.offsetY !== 0) for (const k of Object.keys(p)) p[k] = [p[k][0], p[k][1] + def.offsetY];
  return p;
}

/**
 * How far the hand (and what it holds) reaches below the wrist, px. A wrist whose hand runs past the
 * bottom edge is cropped: its confidence drops, mostly below 0.3 but not always, and it jumps around
 * by `CROPPED_JITTER_PX`.
 */
const HAND_PX = 130;
const CROPPED_C: [number, number] = [0.1, 0.4];
const CROPPED_JITTER_PX: [number, number] = [20, 40];
/** Confidence of a joint outside the image (its position is clamped to the edge). */
const OFF_FRAME_C: [number, number] = [0.02, 0.15];

const round = (v: number, places: number) => {
  const r = Math.round(v * 10 ** places) / 10 ** places;
  return r === 0 ? 0 : r; // no -0
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export interface GenerateOptions {
  /** Noise-free: no position noise, jitter, spikes or dips, and fixed confidences. Absences stay. */
  clean?: boolean;
}

export function generateClip(def: ClipDef, opts: GenerateOptions = {}): Clip {
  const clean = opts.clean === true;
  const rng = new Rng(def.seed);
  const duration = scriptDuration(def.script);

  // Pass 1: frame times. Drawn first so the clean clip shares the noisy clip's frame spacing.
  const times: number[] = []; // ms since clip start, jitter applied
  for (let t = 0; t <= duration; ) {
    const jitter = rng.uniform(-def.jitterMs, def.jitterMs);
    const at = Math.round(t + (clean ? 0 : jitter));
    times.push(Math.max(at, (times[times.length - 1] ?? -1) + 1));
    t += Array.isArray(def.fps) ? 1000 / rng.uniform(def.fps[0], def.fps[1]) : 1000 / def.fps;
  }
  const n = times.length;

  // Pass 2: plan the disturbances.
  const spikeAt = new Map<number, { joint: number; dx: number; dy: number }>();
  const dipAt = new Map<number, { joint: number; c: number }[]>();
  const near: Leg = def.facing === 1 ? 'right' : 'left';
  const primary = new Set(PRIMARY_JOINTS[def.exercise]);
  for (let i = 0; i < def.spikes; i++) {
    for (let tries = 0; tries < 50; tries++) {
      const f = rng.int(0, n - 1);
      const j = rng.int(0, JOINT_NAMES.length - 1);
      const base = JOINT_NAMES[j].replace(/^(left|right)_/, '');
      const mag = rng.uniform(0.05, 0.08);
      const ang = rng.uniform(0, 2 * Math.PI);
      const s = sampleScript(def.script, def.startAngle, times[f]);
      if (spikeAt.has(f) || s.absent) continue;
      if (primary.has(base) && !SPIKE_SAFE[def.exercise](s.angle)) continue;
      if (!clean) spikeAt.set(f, { joint: j, dx: mag * Math.cos(ang), dy: mag * Math.sin(ang) });
      break;
    }
  }
  for (let i = 0; i < def.dips; i++) {
    const f0 = rng.int(0, n - 6);
    const length = rng.int(2, 5);
    // Dip a near-side joint (the far side is already weak in the clips that use dips).
    const sided = def.view === 'side' ? near : rng.uniform() < 0.5 ? 'left' : 'right';
    const joint = JOINT_NAMES.indexOf(`${sided}_${LIMBS[rng.int(0, LIMBS.length - 1)]}`);
    for (let f = f0; f < f0 + length; f++) {
      const c = rng.uniform(0.05, 0.28);
      if (!clean) dipAt.set(f, [...(dipAt.get(f) ?? []), { joint, c }]);
    }
  }

  // Pass 3: frames.
  const t0 = BASE_TIME_MS + def.seed * 1000;
  const frames: ClipFrame[] = [];
  for (let f = 0; f < n; f++) {
    const t = times[f];
    const s = sampleScript(def.script, def.startAngle, t);
    const inWindow = def.absentWindows.some(([a, d]) => t >= a && t < a + d);
    if (s.absent || inWindow) {
      frames.push({ absent: true, timestamp_ms: t0 + t });
      continue;
    }
    const pose = buildPose(def, s);
    const spike = spikeAt.get(f);
    const joints: Joint[] = JOINT_NAMES.map((name, j) => {
      const [px, py] = pose[name];
      let c: number;
      const isFar = def.view === 'side' && name !== 'nose' && !name.startsWith(near);
      const isFace = /eye|ear/.test(name);
      const offFrame = px < 0 || px > IMAGE.width || py < 0 || py > IMAGE.height;
      const cropped = name.endsWith('_wrist') && py + HAND_PX > IMAGE.height;
      if (offFrame || cropped) {
        const [lo, hi] = offFrame ? OFF_FRAME_C : CROPPED_C;
        c = clean ? (lo + hi) / 2 : rng.uniform(lo, hi);
      } else if (isFar) {
        const [lo, hi] = def.farConfidence;
        c = clean ? (lo + hi) / 2 : rng.uniform(lo, hi);
        if (isFace) c *= 0.7;
      } else {
        c = clean ? 0.92 : rng.uniform(0.84, 0.98);
      }
      let x = px / IMAGE.width;
      let y = py / IMAGE.height;
      if (!clean && def.noise > 0) {
        x += rng.gauss() * def.noise;
        y += rng.gauss() * def.noise;
      }
      if (!clean && cropped) {
        const r = rng.uniform(...CROPPED_JITTER_PX);
        const a = rng.uniform(0, 2 * Math.PI);
        x += (r * Math.cos(a)) / IMAGE.width;
        y += (r * Math.sin(a)) / IMAGE.height;
      }
      if (spike && spike.joint === j) {
        x += spike.dx;
        y += spike.dy;
      }
      for (const d of dipAt.get(f) ?? []) if (d.joint === j) c = d.c;
      return { x: round(clamp01(x), 4), y: round(clamp01(y), 4), c: round(c, 2) };
    });
    const pr: PoseResult = {
      source: def.source,
      model: 'synthetic-stick-figure',
      timestamp_ms: t0 + t,
      score: round(clean ? 0.9 : rng.uniform(0.8, 0.95), 2),
      joints,
    };
    frames.push(pr);
  }

  return {
    name: def.name,
    exercise: def.exercise,
    source: 'synthetic',
    description: def.description,
    image: { width: IMAGE.width, height: IMAGE.height },
    expected: { ...def.expected },
    frames,
  };
}

export function generateAll(opts: GenerateOptions = {}): Clip[] {
  return CLIP_DEFS.map((d) => generateClip(d, opts));
}

/** The committed file contents for a clip: compact JSON plus a trailing newline. */
export const serializeClip = (clip: Clip) => `${JSON.stringify(clip)}\n`;
