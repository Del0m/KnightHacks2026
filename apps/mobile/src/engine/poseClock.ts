/**
 * Time on the pose clock (`timestamp_ms`, the capture time) for moments that carry no pose of their
 * own, such as no-person frames and manual set ends: the last pose's timestamp plus the wall time
 * elapsed since that pose arrived. Before any pose it falls back to wall time.
 */
export function createPoseClock(wallNow: () => number = Date.now) {
  let last: { pose: number; wall: number } | null = null;
  return {
    /** Call with each pose's `timestamp_ms` as it arrives. */
    observe(poseMs: number) {
      last = { pose: poseMs, wall: wallNow() };
    },
    now(): number {
      return last ? last.pose + (wallNow() - last.wall) : wallNow();
    },
  };
}
