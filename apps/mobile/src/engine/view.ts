// Camera view of a rep from torso geometry. Behaviour: docs/superpowers/specs/2026-10-10-form-rules-design.md §2.

import { JOINT_NAMES } from '../pose/types';
import type { DetectedView, EngineFrame } from './types';

// Per-rep median ratio on the fixtures: side clips (squat, push_up, bicep_curl, lunge) 0.023–0.034,
// front clips (shoulder_press) 0.529–0.538, a squat turned 30° from the camera 0.431–0.440. A square-on torso only reaches about 0.55 (hip keypoints
// sit well inside the shoulders), so the front bound is 0.4 rather than 0.5 to allow a slight turn.
/** A rep whose median ratio is at least this is `front`. */
export const FRONT_MIN_RATIO = 0.4;
/** A rep whose median ratio is at most this is `side`. */
export const SIDE_MAX_RATIO = 0.25;

const MIN_FRAMES = 3;
const EPS = 1e-6;

const idx = (name: string) => JOINT_NAMES.indexOf(name);
const L_SHOULDER = idx('left_shoulder');
const R_SHOULDER = idx('right_shoulder');
const L_HIP = idx('left_hip');
const R_HIP = idx('right_hip');

/**
 * How wide the torso looks against its height: (|ΔX shoulders| + |ΔX hips|) / (2 × torso), with
 * `X = x * imageAspect`. 0 when only one side's shoulder and hip are present (the far side hidden
 * is itself a side view). Null when it can't be read.
 */
export function viewRatio(frame: EngineFrame, imageAspect: number): number | null {
  const j = frame.joints;
  const ls = j[L_SHOULDER] ?? null;
  const rs = j[R_SHOULDER] ?? null;
  const lh = j[L_HIP] ?? null;
  const rh = j[R_HIP] ?? null;
  if (ls && rs && lh && rh) {
    const midShoulder = { x: ((ls.x + rs.x) / 2) * imageAspect, y: (ls.y + rs.y) / 2 };
    const midHip = { x: ((lh.x + rh.x) / 2) * imageAspect, y: (lh.y + rh.y) / 2 };
    const torso = Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y);
    if (torso < EPS) return null;
    const width = Math.abs(ls.x - rs.x) * imageAspect + Math.abs(lh.x - rh.x) * imageAspect;
    return width / (2 * torso);
  }
  const leftOnly = ls && lh && !rs && !rh;
  const rightOnly = rs && rh && !ls && !lh;
  return leftOnly || rightOnly ? 0 : null;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The view of a rep from its `windows.rep` frames. `unknown` with fewer than 3 readable frames. */
export function detectView(frames: EngineFrame[], imageAspect: number): DetectedView {
  const ratios = frames.map((f) => viewRatio(f, imageAspect)).filter((r): r is number => r !== null);
  if (ratios.length < MIN_FRAMES) return 'unknown';
  const m = median(ratios);
  if (m >= FRONT_MIN_RATIO) return 'front';
  if (m <= SIDE_MAX_RATIO) return 'side';
  return 'unknown';
}
