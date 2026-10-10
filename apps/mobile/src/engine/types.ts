// Types for the form engine. Spec types mirror specs/exercises/schema.json; the format is in
// docs/specs/exercise-spec-format.md. Engine behaviour: docs/superpowers/specs/2026-10-10-form-engine-design.md.

import type { Joint } from '../pose/types';

// ---------------------------------------------------------------------------
// Exercise spec (specs/exercises/<id>.json)

export type Direction = 'decreasing' | 'increasing';
export type SideMode = 'left' | 'right' | 'both_avg' | 'min' | 'max' | 'most_visible';
export type View = 'front' | 'side';
export type RuleView = View | 'any';
export type Severity = 'form' | 'safety';
export type Reduce = 'min' | 'max' | 'mean' | 'first' | 'last';
export type CompareOp = '<=' | '>=' | '<' | '>';
export type ThresholdName = 'start_exit' | 'count_min' | 'target' | 'start_enter';
export type Injury = 'knee' | 'shoulder' | 'lower_back';

/** A COCO joint name, an unsided base name (`knee`) resolved by `side`, or `mid_<base>`. */
export type Point = string;

export interface JointAngleSpec {
  type: 'joint_angle';
  /** `[a, vertex, c]` */
  joints: [Point, Point, Point];
  /** Defaults to `most_visible`. */
  side?: SideMode;
}

export interface SegmentTiltSpec {
  type: 'segment_tilt';
  from: Point;
  to: Point;
  /** Only needed when a point is unsided. Defaults to `most_visible`. */
  side?: SideMode;
}

export interface WidthRatioSpec {
  type: 'width_ratio';
  /** COCO names. */
  numerator: [string, string];
  denominator: [string, string];
}

export type AngleSpec = JointAngleSpec | SegmentTiltSpec | WidthRatioSpec;

export interface Phases {
  start_exit: number;
  count_min: number;
  target: number;
  start_enter: number;
  reverse_deg: number;
  min_state_ms: number;
  set_end_still_ms: number;
}

export type RulePhase = 'outbound' | 'peak' | 'return' | 'rep';

export interface RuleCheck {
  /** An `angles` key, or `duration_ms`. */
  metric: string;
  /** Omitted for `duration_ms`. */
  reduce?: Reduce;
  op: CompareOp;
  value: number | ThresholdName;
}

export interface Rule {
  id: string;
  phase: RulePhase;
  view: RuleView;
  check: RuleCheck;
  severity: Severity;
  priority: number;
  label: string;
  joints: string[];
  rest_note: string;
}

export interface InjuryOverride {
  phases?: Partial<Phases>;
  rules?: Record<string, { value?: number | ThresholdName; severity?: Severity; rest_note?: string }>;
  disable_rules?: string[];
  extra_note: string;
}

export interface ExerciseSpec {
  spec_version: 1;
  id: string;
  name: string;
  recommended_view: View;
  angles: Record<string, AngleSpec>;
  primary_angle: { name: string; direction: Direction };
  phases: Phases;
  rules: Rule[];
  injury_overrides: Record<Injury, InjuryOverride>;
}

// ---------------------------------------------------------------------------
// Smoothing and metrics

/**
 * One smoothed frame of joints, 17 entries in `JOINT_NAMES` order. An entry is null when the joint
 * is missing: below the confidence floor for longer than the hold time, or never seen. A held joint
 * keeps its last smoothed x/y and reports the current raw `c`.
 */
export type SmoothedJoints = (Joint | null)[];

/** Spec metric values for one frame, keyed by `angles` name. Null when a needed point is missing. */
export type Metrics = Record<string, number | null>;

/** Which side a metric was read from this frame. `both` for `both_avg`, `mid_` points and `width_ratio`. */
export type MetricSide = 'left' | 'right' | 'both';
export type MetricSides = Record<string, MetricSide | null>;

// ---------------------------------------------------------------------------
// Rep counter (pure: primary angle over time)

export type RepState = 'start' | 'outbound' | 'peak' | 'return';
/**
 * Why the set ended. `absent`: no person for `set_end_still_ms`. `lost`: a person was there for most
 * of that gap but the primary angle couldn't be measured (e.g. ankles cropped out).
 */
export type SetEndReason = 'still' | 'absent' | 'lost' | 'manual';

/** Durations in ms, per the spec format. `return` and `rep` stop at the `start_enter` crossing. */
export interface RepDurations {
  outbound: number;
  peak: number;
  return: number;
  rep: number;
}

/** Timing of one counted rep, as the counter sees it. */
export interface RepTiming {
  /** 1-based, equal to the rep count right after it was counted. Becomes `rep_index`. */
  index: number;
  /** Frame time the rep left `start` (crossed `start_exit`). */
  startedAt: number;
  /** Frame time it entered `peak` (crossed `count_min`). */
  peakAt: number;
  /** Frame time it entered `return` (moved back by `reverse_deg`). */
  returnAt: number;
  /** Frame time it crossed `start_enter` and was counted. */
  countedAt: number;
  /** Frame time the rule windows closed (the rep settled). */
  closedAt: number;
  /** Furthest primary angle reached in the rep's direction (min for `decreasing`, max for `increasing`). */
  extreme: number;
  durations: RepDurations;
}

/**
 * Counter events. `attempt` numbers every departure from `start` (1, 2, ...), counted or not, so
 * frames can be buffered before it is known whether the attempt becomes a rep.
 */
export type CounterEvent =
  | { type: 'rep_started'; t: number; attempt: number }
  | { type: 'partial'; t: number; attempt: number }
  | { type: 'rep_counted'; t: number; attempt: number; index: number }
  | { type: 'rep_closed'; t: number; attempt: number; timing: RepTiming }
  | { type: 'set_ended'; t: number; reason: SetEndReason };

/** Where a frame belongs: the attempt whose rule windows it extends, and which window. */
export interface FrameWindow {
  attempt: number;
  /** `return` also covers the settle tail after the count. Every tagged frame is also in `rep`. */
  phase: 'outbound' | 'peak' | 'return';
}

export interface CounterStep {
  state: RepState;
  repCount: number;
  ended: boolean;
  /**
   * Window for this frame, or null (in `start` with no open rep, a null value, or the frame that
   * closed a rep by moving back or starting the next one). Assigned after this step's transitions,
   * so the frame that starts a rep is in its `outbound`, and the crossing frame that counts it is in
   * its `return`.
   */
  window: FrameWindow | null;
  /** In order. A frame may emit several, e.g. `rep_closed` then `rep_started`. */
  events: CounterEvent[];
}

// ---------------------------------------------------------------------------
// Engine (smoothing + metrics + counter)

/** One frame as AI-07 sees it inside a rep window. Only frames with a non-null primary angle. */
export interface EngineFrame {
  /** `timestamp_ms` of the pose. */
  t: number;
  metrics: Metrics;
  sides: MetricSides;
  joints: SmoothedJoints;
}

export interface RepWindows {
  outbound: EngineFrame[];
  peak: EngineFrame[];
  /** From entering `return` until the rep settles (past the count). */
  return: EngineFrame[];
  /** The whole rep: outbound + peak + return, in order. */
  rep: EngineFrame[];
}

/** A finished rep, handed over on `rep_closed`. AI-07 reduces the windows; AI-08 packages it. */
export interface RepRecord extends RepTiming {
  windows: RepWindows;
  /** Side of the primary angle at the extreme frame (range-of-motion tracking per side). */
  side: MetricSide | null;
  /** Upright image width ÷ height when the rep closed, for geometry on `windows[*].joints`. */
  imageAspect: number;
}

export type EngineEvent =
  | { type: 'rep_started'; t: number }
  | { type: 'partial'; t: number }
  | { type: 'rep_counted'; t: number; index: number }
  | { type: 'rep_closed'; t: number; rep: RepRecord }
  | { type: 'set_ended'; t: number; reason: SetEndReason };

export interface EngineUpdate {
  t: number;
  state: RepState;
  repCount: number;
  ended: boolean;
  /** Primary angle this frame, or null. */
  primary: number | null;
  primarySide: MetricSide | null;
  metrics: Metrics;
  /** Smoothed joints; null on a no-person frame. */
  joints: SmoothedJoints | null;
  events: EngineEvent[];
}

export interface OneEuroParams {
  /** Hz. Lower means smoother at rest. */
  minCutoff: number;
  /** Speed coefficient. Higher means less lag when moving. */
  beta: number;
  /** Hz, cutoff for the derivative. */
  dCutoff: number;
}

export interface EngineOptions {
  /**
   * Upright image width ÷ height. Joints are normalized per axis, so x is scaled by this before any
   * angle is measured. Default 9/16 (portrait 1080 × 1920).
   */
  imageAspect?: number;
  filter?: Partial<OneEuroParams>;
  /** Joints below this confidence are held, then missing. Default 0.3. */
  minConfidence?: number;
  /** How long a low-confidence joint keeps its last value, ms. Default 300. */
  holdMs?: number;
  /** `most_visible` switches only when the other side leads by this much mean confidence. Default 0.1. */
  sideMargin?: number;
  /** `width_ratio` is null when the denominator's x-distance is below this. Default 0.02. */
  minRatioDenominator?: number;
}

// ---------------------------------------------------------------------------
// Form rules (AI-07): docs/superpowers/specs/2026-10-10-form-rules-design.md

/** Camera view of one rep. `unknown` runs only `view: "any"` rules. */
export type DetectedView = View | 'unknown';

/** One failed rule on one rep. Stored as `FORM_FLAG`. */
export interface Flag {
  rule_id: string;
  severity: Severity;
  /** 0-based within the set: `RepRecord.index - 1`. */
  rep_index: number;
}

export type RuleStatus = 'pass' | 'flag' | 'skipped_view' | 'unmeasured';

export interface RuleOutcome {
  rule_id: string;
  status: RuleStatus;
  /** Reduced value (ms for `duration_ms`); null when skipped or unmeasured. */
  value: number | null;
  /** The resolved `check.value`. */
  threshold: number;
}

/** Every rule's result for one rep, in `spec.rules` order. */
export interface RepResult {
  rep_index: number;
  view: DetectedView;
  /** `caller` when the view was passed in, else `detected`. */
  view_source: 'caller' | 'detected';
  flags: Flag[];
  outcomes: RuleOutcome[];
  /** Union of `joints` over the flagged rules, for the amber tint. */
  tint_joints: string[];
}

/** One rule over the whole set. */
export interface RuleAggregate {
  rule_id: string;
  severity: Severity;
  priority: number;
  /** Reps flagged by this rule (`{n}`). */
  n: number;
  /** Reps where it passed or flagged (not skipped or unmeasured). */
  evaluated: number;
  /** Mean reduced value over the flagged reps (`{value}`, and `{t}` in seconds); null when n = 0. */
  mean_value: number | null;
}

/** The held flags, released when the set ends. AI-08 packages this. */
export interface SetFlags {
  exercise_id: string;
  reason: SetEndReason;
  /** Counted reps (`{total}`). */
  total_reps: number;
  /** Reps with no flags. */
  clean_reps: number;
  /** All flags, in rep order then `spec.rules` order. */
  flags: Flag[];
  reps: RepResult[];
  /** One per rule in `spec.rules`, in that order. */
  rules: RuleAggregate[];
  /** The flagged rule with the best (lowest) priority: the one rest note. Null when every rep is clean. */
  top: RuleAggregate | null;
  /** The injury overrides' `extra_note`s, in body-part order. */
  extra_notes: string[];
}

/**
 * A spec with the user's injury overrides applied (`applyInjuries`). AI-16's physio limits go on top
 * and keep these fields. The rules read `extra_notes` into `SetFlags`.
 */
export interface EffectiveSpec extends ExerciseSpec {
  /** Applied in body-part order: `knee`, `shoulder`, `lower_back`. */
  injuries: Injury[];
  /** Their `extra_note`s, same order. */
  extra_notes: string[];
}
