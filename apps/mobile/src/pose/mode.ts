// Pose mode selection (Architecture §4.1). AI-04 supplies the benchmark fps and caches the result.

/** Which pose source runs, or why none does. */
export type PoseMode = 'coreml' | 'vision' | 'cloud' | 'paused' | 'unavailable';

/** The user's choice in settings. Apple Vision is never chosen automatically. */
export type PosePreference = 'auto' | 'cloud' | 'vision';

export interface ModeInputs {
  /** `Platform.OS`. Only iOS runs pose on the phone; everything else uses cloud mode. */
  platform: string;
  /** YOLOv8 fps from the 2-second benchmark; null when it has not run or the model failed to load. */
  coremlFps: number | null;
  preference: PosePreference;
  /** The user agreed to send frames to the cloud endpoint. */
  cloudConsent: boolean;
  cloudReachable: boolean;
}

/** Below this, YOLOv8 is too slow for live rep counting and the phone uses cloud mode. */
export const MIN_ON_DEVICE_FPS = 12;

/**
 * Picks the pose mode:
 * - iPhone: YOLOv8 at 12+ fps, otherwise cloud. Apple Vision only when the user picks it.
 * - Android: always cloud.
 * - Cloud without consent is `unavailable` (Live Set is gated), or YOLOv8 on a phone that can run it.
 * - Consented cloud that is unreachable is `paused`, never YOLOv8: the camera check offers Core ML
 *   only on an explicit tap (AI-17), so a cloud-preferring phone never switches on its own.
 */
export function selectPoseMode(m: ModeInputs): PoseMode {
  const ios = m.platform === 'ios';
  if (ios && m.preference === 'vision') return 'vision';

  const onDevice = ios && m.coremlFps != null && m.coremlFps >= MIN_ON_DEVICE_FPS;
  if (onDevice && m.preference !== 'cloud') return 'coreml';

  if (!m.cloudConsent) return onDevice ? 'coreml' : 'unavailable';
  if (!m.cloudReachable) return 'paused';
  return 'cloud';
}
