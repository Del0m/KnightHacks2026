const FRAME_TIME_TOLERANCE_MS = 0.001;

/**
 * Frame throttle for the camera worklet. Returns true when enough time has passed since the
 * last processed frame to stay at or under `maxFps`. Frames that return false are dropped,
 * never queued. `lastMs` null means nothing has been processed yet; `maxFps` <= 0 is unlimited.
 */
export function shouldProcess(nowMs: number, lastMs: number | null, maxFps: number): boolean {
  'worklet';
  if (lastMs === null || maxFps <= 0 || nowMs < lastMs) return true;
  return nowMs - lastMs >= 1000 / maxFps - FRAME_TIME_TOLERANCE_MS;
}
