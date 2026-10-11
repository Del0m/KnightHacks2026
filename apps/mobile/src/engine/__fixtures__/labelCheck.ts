/// <reference types="node" />
// Checks the form rules against human rep labels from an AI-09 export bundle (AI-10). Node only:
// it hashes with `crypto`. Run on a real bundle with `scripts/check-rule-labels.ts`.

import { createHash } from 'crypto';

import type { DatasetClip } from '../../../../../ml/labelling/src/contract';
import { createFormEngine } from '../engine';
import { isAbsentFrame, type Clip } from '../recording';
import { evaluateRep } from '../rules';
import { getSpec } from '../specs';
import type { CompareOp, ExerciseSpec, RepDurations, Rule, RuleOutcome } from '../types';

export interface FrameRange {
  start_frame: number;
  /** Exclusive. */
  end_frame: number;
}

export interface EngineRep extends FrameRange {
  outcomes: RuleOutcome[];
  durations: RepDurations;
}

/** One labelled rep paired with the engine rep it overlaps. */
export interface CheckRow {
  clip_id: string;
  exercise_id: string;
  view: 'front' | 'side';
  rep_id: string;
  human_labels: string[];
  primary_label: string | null;
  outcomes: RuleOutcome[];
  durations: RepDurations;
}

export interface ClipCheck {
  clip_id: string;
  exercise_id: string;
  rows: CheckRow[];
  /** Accepted labels with no engine rep. */
  unmatchedLabels: number;
  /** Engine reps with no accepted label. */
  unmatchedEngine: number;
  /** Reps where the rerun flags the same rules as the capture-time suggestion. */
  captureAgreement: { same: number; total: number };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const jsonl = (s: string) => s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** The export's clips, after checking both JSONL checksums against the manifest. */
export function readBundle(bundle: { clips_jsonl: string; training_jsonl: string; manifest: { checksums: Record<string, string> } }): DatasetClip[] {
  for (const key of ['clips_jsonl', 'training_jsonl'] as const) {
    if (sha256(bundle[key]) !== bundle.manifest.checksums[key]) throw new Error(`${key} checksum does not match the manifest`);
  }
  return jsonl(bundle.clips_jsonl) as DatasetClip[];
}

/** The export clip as an engine clip. Timestamps stay relative to the first frame, as captured. */
export function toEngineClip(clip: DatasetClip): Clip {
  return {
    name: clip.clip_id,
    exercise: clip.exercise_id,
    source: 'recorded',
    description: '',
    image: clip.image,
    frames: clip.frames.map((f) =>
      'absent' in f
        ? { absent: true, timestamp_ms: f.timestamp_ms }
        : { source: clip.source, model: clip.model, timestamp_ms: f.timestamp_ms, score: f.score, joints: f.joints },
    ),
  };
}

/**
 * Plays the clip through the engine as the labelling screen does (caller view, base spec, set ended
 * after the last frame) and maps each closed rep to frames the way the capture maps suggestions.
 */
export function engineReps(clip: DatasetClip, spec: ExerciseSpec = getSpec(clip.exercise_id)!): EngineRep[] {
  const engine = createFormEngine(spec, { imageAspect: clip.image.width / clip.image.height });
  const events = toEngineClip(clip).frames.flatMap((f) => (isAbsentFrame(f) ? engine.pushAbsent(f.timestamp_ms) : engine.push(f)).events);
  const last = clip.frames.at(-1)?.timestamp_ms ?? 0;
  events.push(...engine.endSet(last).events);
  const reps: EngineRep[] = [];
  for (const e of events) {
    if (e.type !== 'rep_closed') continue;
    const start = clip.frames.findIndex((f) => f.timestamp_ms >= e.rep.startedAt);
    let end = clip.frames.findIndex((f) => f.timestamp_ms > e.rep.closedAt);
    if (end < 0) end = clip.frames.length;
    if (start < 0 || end <= start) continue;
    // A closing frame can also start the next attempt; it belongs to the new rep.
    const previous = reps.at(-1);
    if (previous && previous.end_frame > start) previous.end_frame = start;
    reps.push({
      start_frame: start,
      end_frame: end,
      outcomes: evaluateRep(spec, e.rep, { view: clip.view }).outcomes,
      durations: e.rep.durations,
    });
  }
  return reps.filter((r) => r.end_frame > r.start_frame);
}

const overlap = (a: FrameRange, b: FrameRange) => Math.max(0, Math.min(a.end_frame, b.end_frame) - Math.max(a.start_frame, b.start_frame));
const iou = (a: FrameRange, b: FrameRange) => {
  const o = overlap(a, b);
  return o / (a.end_frame - a.start_frame + (b.end_frame - b.start_frame) - o);
};

/** Pairs labels with engine reps one to one, best overlap first, keeping pairs with IoU ≥ `minIou`. */
export function matchReps<L extends FrameRange, E extends FrameRange>(labels: L[], engine: E[], minIou = 0.5) {
  const candidates = labels
    .flatMap((label, li) => engine.map((rep, ei) => ({ li, ei, iou: iou(label, rep) })))
    .filter((c) => c.iou >= minIou)
    .sort((a, b) => b.iou - a.iou || a.li - b.li);
  const usedL = new Set<number>();
  const usedE = new Set<number>();
  const pairs: { label: L; engine: E; iou: number }[] = [];
  for (const c of candidates) {
    if (usedL.has(c.li) || usedE.has(c.ei)) continue;
    usedL.add(c.li);
    usedE.add(c.ei);
    pairs.push({ label: labels[c.li], engine: engine[c.ei], iou: c.iou });
  }
  pairs.sort((a, b) => a.label.start_frame - b.label.start_frame);
  return {
    pairs,
    unmatchedLabels: labels.filter((_, i) => !usedL.has(i)),
    unmatchedEngine: engine.filter((_, i) => !usedE.has(i)),
  };
}

const flagIds = (outcomes: RuleOutcome[]) => outcomes.filter((o) => o.status === 'flag').map((o) => o.rule_id).sort();

/** Reruns the engine on one clip and pairs its reps with the accepted human labels. */
export function checkClip(clip: DatasetClip): ClipCheck {
  const reps = engineReps(clip);
  const accepted = clip.annotations.filter((a) => a.state === 'accepted');
  const m = matchReps(accepted, reps);
  const capture = matchReps(clip.suggestions, reps);
  return {
    clip_id: clip.clip_id,
    exercise_id: clip.exercise_id,
    rows: m.pairs.map(({ label, engine }) => ({
      clip_id: clip.clip_id,
      exercise_id: clip.exercise_id,
      view: clip.view,
      rep_id: label.rep_id,
      human_labels: label.human_labels,
      primary_label: label.primary_label,
      outcomes: engine.outcomes,
      durations: engine.durations,
    })),
    unmatchedLabels: m.unmatchedLabels.length,
    unmatchedEngine: m.unmatchedEngine.length,
    captureAgreement: {
      same: capture.pairs.filter((p) => flagIds(p.engine.outcomes).join() === [...p.label.rule_flags].sort().join()).length,
      total: Math.max(clip.suggestions.length, reps.length),
    },
  };
}

export interface Point {
  clip_id: string;
  value: number;
  /** The human labels include the rule's label. */
  positive: boolean;
}

export interface RuleScore {
  rule_id: string;
  label: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Skipped for the view, or unmeasured. */
  skipped: number;
  points: Point[];
}

/** A flag is the rule calling its label; a pass is it calling the label absent. */
export function scoreRule(rows: CheckRow[], rule: Rule): RuleScore {
  const s: RuleScore = { rule_id: rule.id, label: rule.label, tp: 0, fp: 0, fn: 0, tn: 0, skipped: 0, points: [] };
  for (const r of rows) {
    const o = r.outcomes.find((x) => x.rule_id === rule.id);
    if (!o || (o.status !== 'flag' && o.status !== 'pass') || o.value === null) {
      s.skipped++;
      continue;
    }
    const positive = r.human_labels.includes(rule.label);
    const flagged = o.status === 'flag';
    if (flagged && positive) s.tp++;
    else if (flagged) s.fp++;
    else if (positive) s.fn++;
    else s.tn++;
    s.points.push({ clip_id: r.clip_id, value: o.value, positive });
  }
  return s;
}

const passes = (value: number, op: CompareOp, t: number) =>
  op === '<=' ? value <= t : op === '>=' ? value >= t : op === '<' ? value < t : value > t;
/** A positive is right when the check fails (the rule flags it). */
const correctAt = (points: Pick<Point, 'value' | 'positive'>[], op: CompareOp, t: number) =>
  points.filter((p) => passes(p.value, op, t) !== p.positive).length;

export interface Calibration {
  /** Best threshold: `current` when it is among the best, else the closest best candidate. */
  threshold: number;
  correct: number;
  total: number;
  positives: number;
  /** A threshold exists that gets every rep right, with both labels present. */
  separable: boolean;
  /** [last value that must flag, first value that must pass] (or the reverse for `<=`), when separable. */
  range: [number, number] | null;
}

export function calibrate(points: Pick<Point, 'value' | 'positive'>[], op: CompareOp, current: number): Calibration {
  const values = [...new Set(points.map((p) => p.value))].sort((a, b) => a - b);
  const positives = points.filter((p) => p.positive).length;
  const negatives = points.length - positives;
  const total = points.length;
  // Flags sit below the threshold for `>=`/`>` checks and above it for `<=`/`<`.
  const flagsBelow = op === '>=' || op === '>';
  let range: [number, number] | null = null;
  if (positives > 0 && negatives > 0) {
    const pos = points.filter((p) => p.positive).map((p) => p.value);
    const neg = points.filter((p) => !p.positive).map((p) => p.value);
    const lo = flagsBelow ? Math.max(...pos) : Math.max(...neg);
    const hi = flagsBelow ? Math.min(...neg) : Math.min(...pos);
    if (lo < hi) range = [lo, hi];
  }
  const candidates = [current];
  if (values.length) {
    candidates.push(values[0] - 1, values.at(-1)! + 1);
    for (let i = 1; i < values.length; i++) candidates.push((values[i - 1] + values[i]) / 2);
  }
  if (range) candidates.push((range[0] + range[1]) / 2);
  let threshold = current;
  let correct = correctAt(points, op, current);
  for (const t of candidates) {
    const c = correctAt(points, op, t);
    if (c > correct || (c === correct && Math.abs(t - current) < Math.abs(threshold - current))) {
      threshold = t;
      correct = c;
    }
  }
  if (range && correct === total && correctAt(points, op, current) < total) threshold = (range[0] + range[1]) / 2;
  return { threshold, correct, total, positives, separable: range !== null, range };
}

/**
 * For each ordered pair of clips: the threshold fitted on `train`, scored on `test`. `fitted` is false
 * when `train` has only one label, so there was nothing to fit.
 */
export function crossClip(points: Point[], op: CompareOp, current: number) {
  const clips = [...new Set(points.map((p) => p.clip_id))].sort();
  if (clips.length < 2) return [];
  return clips.flatMap((train) => {
    const own = points.filter((p) => p.clip_id === train);
    const fit = calibrate(own, op, current);
    const fitted = fit.positives > 0 && fit.positives < fit.total;
    return clips
      .filter((test) => test !== train)
      .map((test) => {
        const held = points.filter((p) => p.clip_id === test);
        return { train, test, fitted, threshold: fit.threshold, correct: correctAt(held, op, fit.threshold), total: held.length };
      });
  });
}

const frac = (n: number, d: number) => `${n}/${d}`;
const short = (id: string) => id.replace(/^clip_/, '').slice(0, 8);
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const spread = (vs: number[]) => (vs.length ? `${fmt(Math.min(...vs))}–${fmt(Math.max(...vs))}` : '—');

/** Markdown summary per exercise. Counts only: no joints or ids beyond short clip prefixes. */
export function renderReport(checks: ClipCheck[]): string {
  const out: string[] = ['# Form rules against human labels', ''];
  const exercises = [...new Set(checks.map((c) => c.exercise_id))].sort();
  for (const ex of exercises) {
    const spec = getSpec(ex)!;
    const cs = checks.filter((c) => c.exercise_id === ex);
    const rows = cs.flatMap((c) => c.rows);
    out.push(`## ${ex}`, '');
    out.push(`${rows.length} labelled reps matched across ${cs.length} clip${cs.length === 1 ? '' : 's'}.`);
    for (const c of cs) {
      out.push(
        `- clip ${short(c.clip_id)}: ${c.rows.length} matched, ${c.unmatchedLabels} labels without an engine rep, ` +
          `${c.unmatchedEngine} engine reps without a label; rerun flags equal capture flags on ${frac(c.captureAgreement.same, c.captureAgreement.total)} reps`,
      );
    }
    if (cs.length === 1) out.push('', 'Only one clip: thresholds below describe this clip and cannot be validated on another.');
    const labels = new Map<string, number>();
    for (const r of rows) for (const l of r.human_labels) labels.set(l, (labels.get(l) ?? 0) + 1);
    out.push('', `Human labels: ${[...labels].map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}.`, '');
    out.push('| rule | label | judged | human yes | flagged | precision | recall | value, label yes | value, label no | current | separating range | best on this data |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    const cross: string[] = [];
    for (const rule of spec.rules) {
      const s = scoreRule(rows, rule);
      const current = typeof rule.check.value === 'number' ? rule.check.value : spec.phases[rule.check.value];
      const c = calibrate(s.points, rule.check.op, current);
      const yes = s.points.filter((p) => p.positive).map((p) => p.value);
      const no = s.points.filter((p) => !p.positive).map((p) => p.value);
      const judged = s.points.length;
      out.push(
        `| ${rule.id} | ${rule.label} | ${judged}${s.skipped ? ` (${s.skipped} skipped)` : ''} | ${s.tp + s.fn} | ${s.tp + s.fp} | ` +
          `${s.tp + s.fp ? frac(s.tp, s.tp + s.fp) : '—'} | ${s.tp + s.fn ? frac(s.tp, s.tp + s.fn) : '—'} | ${spread(yes)} | ${spread(no)} | ` +
          `${rule.check.op} ${fmt(current)} | ${c.range ? `${fmt(c.range[0])}–${fmt(c.range[1])}` : '—'} | ${judged ? `${rule.check.op} ${fmt(c.threshold)}: ${frac(c.correct, c.total)}` : '—'} |`,
      );
      for (const x of crossClip(s.points, rule.check.op, current)) {
        if (s.tp + s.fn === 0) continue;
        cross.push(
          x.fitted
            ? `- ${rule.id}: fitted on ${short(x.train)} (${rule.check.op} ${fmt(x.threshold)}), ${frac(x.correct, x.total)} right on ${short(x.test)}`
            : `- ${rule.id}: ${short(x.train)} has only one label, so nothing to fit for ${short(x.test)}`,
        );
      }
    }
    if (cross.length) out.push('', 'Fitted on one clip, tested on the other:', '', ...cross);
    // Lowering is the phase the exercise's fast_lowering rule times (way down for a squat, way back for a press).
    const lowering = spec.rules.find((r) => r.check.metric === 'duration_ms' && r.label === 'fast_lowering');
    out.push('', 'Timing by human label' + (lowering ? ` (lowering is the \`${lowering.id}\` rule's ${lowering.phase} time)` : '') + ':', '');
    out.push('| label | reps | lowering, ms | rep, ms |', '|---|---|---|---|');
    for (const label of labels.keys()) {
      const mine = rows.filter((r) => r.human_labels.includes(label));
      const low = mine.flatMap((r) => {
        const v = r.outcomes.find((o) => o.rule_id === lowering?.id)?.value;
        return v == null ? [] : [v];
      });
      out.push(`| ${label} | ${mine.length} | ${spread(low)} | ${spread(mine.map((r) => r.durations.rep))} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
