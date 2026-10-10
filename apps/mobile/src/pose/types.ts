// Mirrors docs/pose/pose-result-contract.md and PoseCore (PoseResult.swift, OverlayGeometry.swift).

/** COCO keypoint order; `joints[i]` is `JOINT_NAMES[i]`. Same order as `PoseResult.jointNames`. */
export const JOINT_NAMES: readonly string[] = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

/** Skeleton edges as joint index pairs. Same pairs and order as `OverlayGeometry.bones`. */
export const BONES: readonly [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], // face
  [5, 6], [5, 11], [6, 12], [11, 12], // torso
  [5, 7], [7, 9], [6, 8], [8, 10], // arms
  [11, 13], [13, 15], [12, 14], [14, 16], // legs
];

/** Normalized 0–1 in the upright, unmirrored image (origin top-left); `c` is confidence 0–1. */
export interface Joint {
  x: number;
  y: number;
  c: number;
}

export interface PoseResult {
  source: 'coreml' | 'cloud';
  model: string;
  /** Frame time, Unix milliseconds. */
  timestamp_ms: number;
  /** Person-detection confidence, 0–1. */
  score: number;
  /** Always 17 entries, in `JOINT_NAMES` order. */
  joints: Joint[];
}

/** One inference: `result` is undefined when no person was found. */
export interface PoseDetection {
  result?: PoseResult;
  latencyMs: number;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isJoint = (v: unknown): v is Joint => {
  if (typeof v !== 'object' || v === null) return false;
  const j = v as Record<string, unknown>;
  return isNumber(j.x) && isNumber(j.y) && isNumber(j.c);
};

export function isPoseResult(v: unknown): v is PoseResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (r.source === 'coreml' || r.source === 'cloud') &&
    typeof r.model === 'string' &&
    isNumber(r.timestamp_ms) &&
    isNumber(r.score) &&
    Array.isArray(r.joints) &&
    r.joints.length === JOINT_NAMES.length &&
    r.joints.every(isJoint)
  );
}
