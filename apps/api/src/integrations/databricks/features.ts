// CONN-05: the form model's frame-derived rep features, computed from the set's joints so Model
// Serving sees the same inputs the model was trained on.
//
// A port of silver_frames and silver_reps in databricks/pipelines/spotter_sessions/silver.py;
// keep the two in step. specs/set-record/fixtures/features holds frames with the expected
// features, checked here (apps/api/test/score-features.test.ts) and in the pipeline
// (databricks/pipelines/spotter_sessions/tests/test_feature_parity.py).
//
// Angles use normalised image coordinates, as in the pipeline: consistent per lifter and
// device, not exact degrees on non-square frames.

import type { JointFrame } from "./upload.js";

export interface RepFeatures {
  lowering_ms: number | null;
  rising_ms: number | null;
  asymmetry: number | null;
  max_trunk_angle: number | null;
  min_knee_ankle_ratio: number | null;
}

export const NO_FEATURES: RepFeatures = {
  lowering_ms: null,
  rising_ms: null,
  asymmetry: null,
  max_trunk_angle: null,
  min_knee_ankle_ratio: null,
};

// COCO joint indexes (docs/pose/pose-result-contract.md)
const L_SHOULDER = 5, R_SHOULDER = 6, L_ELBOW = 7, R_ELBOW = 8, L_WRIST = 9, R_WRIST = 10;
const L_HIP = 11, R_HIP = 12, L_KNEE = 13, R_KNEE = 14, L_ANKLE = 15, R_ANKLE = 16;

// Which angle defines depth for each exercise (PRIMARY_ANGLE in silver.py). Anything unlisted
// uses the knee.
const PRIMARY_ANGLE: Record<string, "hip" | "elbow"> = Object.fromEntries([
  ...["deadlift", "romanian_deadlift", "hip_thrust", "good_morning"].map((e) => [e, "hip"]),
  ...["shoulder_press", "bench_press", "overhead_press", "push_up", "bicep_curl", "row", "dip"].map(
    (e) => [e, "elbow"],
  ),
]);

// silver_frames drops frames where the torso is too small to measure or the lower body is unsure.
const MIN_TORSO_LEN = 0.01;
const MIN_LOWER_CONF = 0.3;

interface FrameAngles {
  left: number;
  right: number;
  primary: number;
  trunk: number;
  kneeAnkleRatio: number | null;
}

const x = (kp: number[], j: number) => kp[3 * j]!;
const y = (kp: number[], j: number) => kp[3 * j + 1]!;
const c = (kp: number[], j: number) => kp[3 * j + 2]!;

/** Angle at joint b, in degrees, between b->a and b->cc. */
function angle(kp: number[], a: number, b: number, cc: number): number {
  const ax = x(kp, a) - x(kp, b), ay = y(kp, a) - y(kp, b);
  const cx = x(kp, cc) - x(kp, b), cy = y(kp, cc) - y(kp, b);
  const denom = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  // Spark's try_divide gives null here, and least/greatest skip the null, so the clamp yields 1.
  const cos = denom === 0 ? 1 : Math.max(-1, Math.min(1, (ax * cx + ay * cy) / denom));
  return (Math.acos(cos) * 180) / Math.PI;
}

function frameAngles(kp: number[], primary: "knee" | "hip" | "elbow"): FrameAngles | null {
  const hipX = (x(kp, L_HIP) + x(kp, R_HIP)) / 2, hipY = (y(kp, L_HIP) + y(kp, R_HIP)) / 2;
  const shX = (x(kp, L_SHOULDER) + x(kp, R_SHOULDER)) / 2, shY = (y(kp, L_SHOULDER) + y(kp, R_SHOULDER)) / 2;
  const torsoLen = Math.hypot(shX - hipX, shY - hipY);
  const lowerConf =
    (c(kp, L_HIP) + c(kp, R_HIP) + c(kp, L_KNEE) + c(kp, R_KNEE) + c(kp, L_ANKLE) + c(kp, R_ANKLE)) / 6;
  if (!(torsoLen > MIN_TORSO_LEN) || !(lowerConf >= MIN_LOWER_CONF)) return null;

  const [left, right] =
    primary === "hip"
      ? [angle(kp, L_SHOULDER, L_HIP, L_KNEE), angle(kp, R_SHOULDER, R_HIP, R_KNEE)]
      : primary === "elbow"
        ? [angle(kp, L_SHOULDER, L_ELBOW, L_WRIST), angle(kp, R_SHOULDER, R_ELBOW, R_WRIST)]
        : [angle(kp, L_HIP, L_KNEE, L_ANKLE), angle(kp, R_HIP, R_KNEE, R_ANKLE)];
  const ankleSpread = Math.abs(x(kp, L_ANKLE) - x(kp, R_ANKLE));

  return {
    left,
    right,
    primary: (left + right) / 2,
    // Lean from vertical: 0 = upright. Image y points down.
    trunk: (Math.atan2(Math.abs(shX - hipX), hipY - shY) * 180) / Math.PI,
    kneeAnkleRatio: ankleSpread === 0 ? null : Math.abs(x(kp, L_KNEE) - x(kp, R_KNEE)) / ankleSpread,
  };
}

/**
 * Features for each rep from the set's frames. A rep gets nulls (which the model handles) when
 * the phone sent no boundaries or no usable frames fall inside them.
 */
export function repFeatures(
  exerciseId: string,
  reps: { start_ms?: number | null; end_ms?: number | null }[],
  frames: JointFrame[] | undefined,
): RepFeatures[] {
  if (!frames?.length) return reps.map(() => NO_FEATURES);

  const primary = PRIMARY_ANGLE[exerciseId] ?? "knee";
  const usable = frames
    .map((f) => ({ t_ms: f.t_ms, a: frameAngles(f.kp, primary) }))
    .filter((f): f is { t_ms: number; a: FrameAngles } => f.a !== null);

  return reps.map(({ start_ms, end_ms }) => {
    if (start_ms == null || end_ms == null || end_ms <= start_ms) return NO_FEATURES;
    const inRep = usable.filter((f) => f.t_ms >= start_ms && f.t_ms <= end_ms);
    if (inRep.length === 0) return NO_FEATURES;

    let bottom = inRep[0]!;
    let leftMin = Infinity, leftMax = -Infinity, rightMin = Infinity, rightMax = -Infinity;
    let maxTrunk = -Infinity;
    let minRatio: number | null = null;
    for (const f of inRep) {
      if (f.a.primary < bottom.a.primary) bottom = f;
      leftMin = Math.min(leftMin, f.a.left);
      leftMax = Math.max(leftMax, f.a.left);
      rightMin = Math.min(rightMin, f.a.right);
      rightMax = Math.max(rightMax, f.a.right);
      maxTrunk = Math.max(maxTrunk, f.a.trunk);
      if (f.a.kneeAnkleRatio !== null) minRatio = Math.min(minRatio ?? Infinity, f.a.kneeAnkleRatio);
    }
    const leftRange = leftMax - leftMin, rightRange = rightMax - rightMin;
    const widest = Math.max(leftRange, rightRange);
    const lowering = bottom.t_ms - start_ms;

    return {
      lowering_ms: lowering,
      rising_ms: end_ms - start_ms - lowering,
      // 0 = perfectly even, 0.15+ is flagged by the risk score
      asymmetry: widest === 0 ? null : Math.abs(leftRange - rightRange) / widest,
      max_trunk_angle: maxTrunk,
      min_knee_ankle_ratio: minRatio,
    };
  });
}
