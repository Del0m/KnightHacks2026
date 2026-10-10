// Basic mode (AI-03): Apple Vision body pose mapped to the 17 COCO joints, iPhone only.
// The user picks it in settings; `selectPoseMode` never chooses it automatically. Android has no
// on-device pose and uses cloud mode instead. Mapping lives in PoseCore's VisionPoseMapper.swift.
import { usePoseOutput, type PoseOutput } from './usePoseOutput';
import type { PoseDetection } from './types';

/** `PoseResult.model` for basic-mode results; their `source` is `"vision"`. */
export const BASIC_MODEL = 'apple-vision-body-pose';

/** Apple Vision exists only on iOS. */
export function isBasicModeSupported(platform: string): boolean {
  return platform === 'ios';
}

/** `usePoseOutput` running Apple Vision instead of YOLOv8. Same throttle, frame handling and output. */
export function useBasicPoseOutput(opts: { maxFps?: number; onPose: (d: PoseDetection) => void }): PoseOutput {
  return usePoseOutput({ ...opts, engine: 'vision' });
}
