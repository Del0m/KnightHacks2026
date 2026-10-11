import type { DatasetClip, RepAnnotation } from './contract.ts';

export const PREPROCESSING_VERSION = 'aspect-time-linear-v1';
export const PREPROCESSING_CONFIG = {
  version: PREPROCESSING_VERSION,
  frames: 32,
  joints: 17,
  confidence_threshold: 0.3,
  max_gap_ms: 300,
  normalization: 'x_times_image_aspect',
  invalid_fill: 0,
  interpolation: 'linear_between_adjacent_valid_source_frames',
} as const;

export interface DerivedRep {
  joints: number[][][];
  confidence: number[][];
  validity: boolean[][];
  duration_ms: number;
  normalization: { method: 'aspect_only'; image_aspect: number; preprocessing_version: string };
}

/** Timestamp resampling uses raw adjacent detections and never smoothed/held engine joints. */
export function deriveRep(clip: DatasetClip, annotation: RepAnnotation): DerivedRep {
  const { start_frame: start, end_frame: end } = annotation;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > clip.frames.length || end <= start) {
    throw new Error('Invalid rep interval');
  }
  const frames = clip.frames.slice(start, end);
  const first = frames[0].timestamp_ms;
  const last = frames[frames.length - 1].timestamp_ms;
  const aspect = clip.image.width / clip.image.height;
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    throw new Error('Rep needs positive dimensions and duration');
  }
  frames.forEach((f, i) => {
    if (!Number.isFinite(f.timestamp_ms) || (i > 0 && f.timestamp_ms <= frames[i - 1].timestamp_ms)) throw new Error('Invalid frame timestamps');
  });
  const result: DerivedRep = {
    joints: [], confidence: [], validity: [], duration_ms: last - first,
    normalization: { method: 'aspect_only', image_aspect: aspect, preprocessing_version: PREPROCESSING_VERSION },
  };
  let left = 0;
  for (let i = 0; i < 32; i++) {
    const t = first + (last - first) * i / 31;
    while (left + 1 < frames.length && frames[left + 1].timestamp_ms <= t) left++;
    const a = frames[left];
    const b = a.timestamp_ms === t ? a : frames[Math.min(left + 1, frames.length - 1)];
    const dt = b.timestamp_ms - a.timestamp_ms;
    const weight = dt === 0 ? 0 : (t - a.timestamp_ms) / dt;
    const coords: number[][] = [], confidence: number[] = [], validity: boolean[] = [];
    for (let j = 0; j < 17; j++) {
      const ja = 'absent' in a ? undefined : a.joints[j];
      const jb = 'absent' in b ? undefined : b.joints[j];
      const valid = !!ja && !!jb && ja.c >= .3 && jb.c >= .3 && dt <= 300;
      if (valid && ja && jb) {
        coords.push([(ja.x + (jb.x - ja.x) * weight) * aspect, ja.y + (jb.y - ja.y) * weight]);
        confidence.push(ja.c + (jb.c - ja.c) * weight);
      } else {
        coords.push([0, 0]);
        confidence.push(0);
      }
      validity.push(valid);
    }
    result.joints.push(coords); result.confidence.push(confidence); result.validity.push(validity);
  }
  return result;
}
