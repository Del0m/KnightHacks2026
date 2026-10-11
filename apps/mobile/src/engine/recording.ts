import type { PoseDetection, PoseResult } from '../pose/types';

/** A no-person frame. `PoseResult` is null in that case, so the time is kept here. */
export interface AbsentFrame {
  absent: true;
  timestamp_ms: number;
}

export type ClipFrame = PoseResult | AbsentFrame;

/**
 * A joint sequence for engine tests: synthetic (`__fixtures__/synth.ts`) or recorded on a phone with
 * the PoseDebugScreen recorder. `expected` is filled in by hand for recorded clips.
 */
export interface Clip {
  name: string;
  /** Spec id. */
  exercise: string;
  source: 'synthetic' | 'recorded';
  description: string;
  /** Upright frame size; `imageAspect` is width ÷ height. */
  image: { width: number; height: number };
  expected?: {
    reps: number;
    partials: number;
    set_end: 'still' | 'absent' | 'lost' | null;
    /**
     * The complete list of rule flags for the clip with the base spec, no injuries, view detected.
     * `rep_index` is 0-based.
     */
    flags?: { rule_id: string; rep_index: number }[];
  };
  frames: ClipFrame[];
}

export const isAbsentFrame = (f: ClipFrame): f is AbsentFrame => 'absent' in f;

/** `|| 0` turns -0 into 0, so a clip survives a JSON round trip unchanged. */
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places || 0;

/** Coordinates to 4 decimals and confidence to 2, as in the committed fixtures. */
export function compactPose(r: PoseResult): PoseResult {
  return {
    ...r,
    score: round(r.score, 2),
    joints: r.joints.map((j) => ({ x: round(j.x, 4), y: round(j.y, 4), c: round(j.c, 2) })),
  };
}

/**
 * Collects detections into a `Clip`. A no-person frame is stamped with its capture time
 * (`timestampMs`, set by cloud mode), else `nowMs`; pass pose-clock time (`createPoseClock`).
 */
export function createClipRecorder(meta: { exercise: string; image: { width: number; height: number } }) {
  const frames: ClipFrame[] = [];
  return {
    add(d: PoseDetection, nowMs: number) {
      frames.push(d.result ? compactPose(d.result) : { absent: true, timestamp_ms: d.timestampMs ?? nowMs });
    },
    get length() {
      return frames.length;
    },
    toClip(name: string): Clip {
      return {
        name,
        exercise: meta.exercise,
        source: 'recorded',
        description: '',
        image: meta.image,
        frames: [...frames],
      };
    },
  };
}
