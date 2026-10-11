/// <reference types="node" />
// Checking the form rules against human rep labels from an AI-09 export (AI-10). Synthetic clips
// only: the real export stays out of the repo.

import { createHash } from 'crypto';

import type { DatasetClip, RepAnnotation } from '../../../../../ml/labelling/src/contract';
import {
  calibrate,
  checkClip,
  crossClip,
  engineReps,
  matchReps,
  readBundle,
  renderReport,
  scoreRule,
  toEngineClip,
  type CheckRow,
} from '../__fixtures__/labelCheck';
import { CLIP_DEFS, generateClip } from '../__fixtures__/synth';
import { isAbsentFrame, type Clip } from '../recording';
import { getSpec } from '../specs';
import type { Rule } from '../types';

const def = (name: string) => CLIP_DEFS.find((d) => d.name === name)!;

/** Wraps an engine clip as an export clip, timestamps made relative as the capture does. */
function asDatasetClip(clip: Clip, clipId: string, view: 'side' | 'front' = 'side'): DatasetClip {
  const base = clip.frames[0].timestamp_ms;
  return {
    schema_version: 1,
    clip_id: clipId,
    session_id: `session-${clipId}`,
    participant_id: 'p1',
    exercise_id: clip.exercise as DatasetClip['exercise_id'],
    view,
    camera_position: 'back',
    side: 'left',
    context: 'standard',
    image: clip.image,
    source: 'coreml',
    model: 'yolov8n-pose-320',
    origin: 'synthetic',
    consent: { reference: 'c1', version: 'joint-capture-v1', allowed_use: true, purpose: 'private_model_development' },
    status: 'complete',
    stop_reason: 'manual',
    frames: clip.frames.map((f) =>
      isAbsentFrame(f)
        ? { timestamp_ms: f.timestamp_ms - base, absent: true as const }
        : { timestamp_ms: f.timestamp_ms - base, score: f.score, joints: f.joints },
    ),
    annotations: [],
    suggestions: [],
  };
}

const annotation = (id: string, start: number, end: number, labels: string[], state: RepAnnotation['state'] = 'accepted'): RepAnnotation => ({
  rep_id: id,
  start_frame: start,
  end_frame: end,
  state,
  human_labels: labels,
  primary_label: labels[0] ?? null,
  reviewer_id: 'p1',
  reviewed_at: '2026-10-10T12:00:00Z',
  boundary_provenance: 'engine',
  revision: 1,
});

const offForm = () => asDatasetClip(generateClip(def('squat_off_form')), 'clip-off-form');

describe('toEngineClip', () => {
  it('keeps every frame, absent frames and timestamps, and adds the clip detector', () => {
    const data = asDatasetClip(generateClip(def('squat_absent_end')), 'clip-absent');
    const clip = toEngineClip(data);
    expect(clip.exercise).toBe('squat');
    expect(clip.image).toEqual(data.image);
    expect(clip.frames).toHaveLength(data.frames.length);
    expect(clip.frames.some(isAbsentFrame)).toBe(true);
    clip.frames.forEach((f, i) => {
      expect(f.timestamp_ms).toBe(data.frames[i].timestamp_ms);
      if (!isAbsentFrame(f)) expect(f).toMatchObject({ source: 'coreml', model: 'yolov8n-pose-320' });
    });
  });
});

describe('engineReps', () => {
  it('finds the synthetic reps with their rule flags, as ordered frame ranges', () => {
    const reps = engineReps(offForm());
    expect(reps).toHaveLength(6);
    const flagged = (rule: string) => reps.flatMap((r, i) => (r.outcomes.some((o) => o.rule_id === rule && o.status === 'flag') ? [i] : []));
    expect(flagged('depth')).toEqual([1, 3]);
    expect(flagged('trunk_lean')).toEqual([2, 4]);
    expect(flagged('tempo')).toEqual([0, 1, 3, 5]);
    for (let i = 0; i < reps.length; i++) {
      expect(reps[i].end_frame).toBeGreaterThan(reps[i].start_frame);
      if (i > 0) expect(reps[i].start_frame).toBeGreaterThanOrEqual(reps[i - 1].end_frame);
      expect(reps[i].durations.outbound).toBeGreaterThan(0);
    }
  });
});

describe('matchReps', () => {
  const engine = [
    { start_frame: 0, end_frame: 10 },
    { start_frame: 10, end_frame: 20 },
    { start_frame: 30, end_frame: 40 },
  ];

  it('pairs each label with the engine rep it overlaps most, one to one', () => {
    const m = matchReps([{ start_frame: 1, end_frame: 10 }, { start_frame: 11, end_frame: 21 }], engine);
    expect(m.pairs.map((p) => [p.label.start_frame, p.engine.start_frame])).toEqual([[1, 0], [11, 10]]);
    expect(m.unmatchedEngine).toEqual([engine[2]]);
    expect(m.unmatchedLabels).toEqual([]);
  });

  it('leaves a label unmatched when the overlap is under half the union', () => {
    const m = matchReps([{ start_frame: 36, end_frame: 50 }], engine);
    expect(m.pairs).toEqual([]);
    expect(m.unmatchedLabels).toHaveLength(1);
  });
});

describe('checkClip', () => {
  it('rows every accepted label matched to an engine rep, and counts agreement with the capture flags', () => {
    const data = offForm();
    const reps = engineReps(data);
    data.suggestions = reps.map((r, i) => ({
      start_frame: r.start_frame,
      end_frame: r.end_frame,
      // Rep 0 disagrees with the rerun on purpose.
      rule_flags: i === 0 ? [] : r.outcomes.filter((o) => o.status === 'flag').map((o) => o.rule_id),
    }));
    data.annotations = [
      annotation('a0', reps[0].start_frame, reps[0].end_frame, ['clean']),
      annotation('a1', reps[1].start_frame, reps[1].end_frame, ['partial_range']),
      annotation('a2', reps[2].start_frame, reps[2].end_frame, ['forward_lean', 'fast_lowering']),
      annotation('a3', reps[3].start_frame, reps[3].end_frame, ['clean'], 'discard'),
      annotation('a9', 5000, 5010, ['clean']),
    ];
    const out = checkClip(data);
    expect(out.rows.map((r) => r.rep_id)).toEqual(['a0', 'a1', 'a2']);
    expect(out.rows[2]).toMatchObject({ clip_id: 'clip-off-form', exercise_id: 'squat', human_labels: ['forward_lean', 'fast_lowering'] });
    expect(out.unmatchedLabels).toBe(1);
    expect(out.unmatchedEngine).toBe(3);
    expect(out.captureAgreement).toEqual({ same: 5, total: 6 });
  });
});

const tempo: Rule = getSpec('squat')!.rules.find((r) => r.id === 'tempo')!;
const row = (clip: string, value: number | null, labels: string[], status: 'pass' | 'flag' | 'skipped_view' | 'unmeasured'): CheckRow => ({
  clip_id: clip,
  exercise_id: 'squat',
  view: 'side',
  rep_id: `${clip}-${value}`,
  human_labels: labels,
  primary_label: labels[0],
  outcomes: [{ rule_id: 'tempo', status, value, threshold: 800 }],
  durations: { outbound: value ?? 0, peak: 0, return: 0, rep: 0 },
});

describe('scoreRule', () => {
  it('counts a flag as a positive call for the rule label and skips reps it could not judge', () => {
    const s = scoreRule([
      row('a', 500, ['fast_lowering'], 'flag'),
      row('a', 600, ['clean'], 'flag'),
      row('a', 900, ['fast_lowering'], 'pass'),
      row('a', 1000, ['clean'], 'pass'),
      row('a', null, ['clean'], 'skipped_view'),
      row('a', null, ['fast_lowering'], 'unmeasured'),
    ], tempo);
    expect(s).toMatchObject({ rule_id: 'tempo', label: 'fast_lowering', tp: 1, fp: 1, fn: 1, tn: 1, skipped: 2 });
    expect(s.points).toEqual([
      { clip_id: 'a', value: 500, positive: true },
      { clip_id: 'a', value: 600, positive: false },
      { clip_id: 'a', value: 900, positive: true },
      { clip_id: 'a', value: 1000, positive: false },
    ]);
  });
});

describe('calibrate', () => {
  it('finds the range of thresholds that separates the labels, for a ">=" check', () => {
    // Positives fail the check, so they sit below the threshold.
    const c = calibrate([
      { value: 400, positive: true }, { value: 500, positive: true },
      { value: 700, positive: false }, { value: 900, positive: false },
    ], '>=', 800);
    expect(c.separable).toBe(true);
    expect(c.range).toEqual([500, 700]);
    expect(c.correct).toBe(4);
    expect(c.threshold).toBeGreaterThan(500);
    expect(c.threshold).toBeLessThanOrEqual(700);
  });

  it('flips direction for a "<=" check', () => {
    const c = calibrate([{ value: 30, positive: false }, { value: 60, positive: true }], '<=', 45);
    expect(c.separable).toBe(true);
    expect(c.range).toEqual([30, 60]);
    expect(c.threshold).toBe(45);
  });

  it('reports the best count when the labels overlap', () => {
    const c = calibrate([
      { value: 400, positive: true }, { value: 600, positive: false },
      { value: 700, positive: true }, { value: 900, positive: false },
    ], '>=', 800);
    expect(c.separable).toBe(false);
    expect(c.range).toBeNull();
    expect(c.correct).toBe(3);
  });

  it('cannot separate a single class', () => {
    const c = calibrate([{ value: 400, positive: false }, { value: 500, positive: false }], '>=', 800);
    expect(c).toMatchObject({ separable: false, range: null, correct: 2, total: 2, positives: 0 });
  });
});

describe('crossClip', () => {
  it('fits the threshold on one clip and scores it on each other clip', () => {
    const points = [
      { clip_id: 'a', value: 400, positive: true }, { clip_id: 'a', value: 900, positive: false },
      { clip_id: 'b', value: 600, positive: true }, { clip_id: 'b', value: 700, positive: false },
    ];
    const out = crossClip(points, '>=', 800);
    expect(out.map((o) => [o.train, o.test])).toEqual([['a', 'b'], ['b', 'a']]);
    // Fitted on a, the threshold lands between 400 and 900; clip b's labels sit inside that gap.
    expect(out[0].total).toBe(2);
    // Fitted on b (between 600 and 700), clip a is separated.
    expect(out[1]).toMatchObject({ correct: 2, total: 2 });
  });

  it('returns nothing with a single clip', () => {
    expect(crossClip([{ clip_id: 'a', value: 1, positive: true }], '>=', 800)).toEqual([]);
  });
});

describe('readBundle', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const bundle = (clips: string) => ({
    schema_version: 1,
    clips_jsonl: clips,
    training_jsonl: '',
    manifest: { checksums: { clips_jsonl: sha(clips), training_jsonl: sha('') } },
  });

  it('parses the clips when the checksums match', () => {
    const clip = offForm();
    expect(readBundle(bundle(`${JSON.stringify(clip)}\n`))).toHaveLength(1);
  });

  it('refuses a bundle whose clips do not match the manifest', () => {
    const b = bundle('{}\n');
    b.clips_jsonl = '{"tampered":true}\n';
    expect(() => readBundle(b)).toThrow(/checksum/);
  });
});

describe('renderReport', () => {
  it('writes counts as fractions and says when an exercise has a single clip', () => {
    const data = offForm();
    const reps = engineReps(data);
    data.annotations = reps.map((r, i) => annotation(`a${i}`, r.start_frame, r.end_frame, i === 2 || i === 4 ? ['forward_lean'] : ['clean']));
    const md = renderReport([checkClip(data)]);
    expect(md).toContain('## squat');
    expect(md).toMatch(/trunk_lean.*forward_lean/);
    expect(md).toContain('2/2');
    expect(md).toMatch(/one clip/i);
  });
});
