// Generated from schema.json by generate-types.mjs. Do not edit; run
// `node specs/set-record/generate-types.mjs` after changing the schema.
// Field meanings, units and clocks: docs/specs/set-record-format.md.

/** Spec id (specs/exercises/<id>.json). */
export type ExerciseId = string;

/** Pose source that produced the joints (PoseSource on the phone). */
export type InferenceMode = "coreml" | "vision" | "cloud";

export type Severity = "form" | "safety";

export type Medal = "bronze" | "silver" | "gold";

/** still: no movement for set_end_still_ms. absent: no person. lost: a person but no primary angle. manual: the Done button. */
export type SetEndReason = "still" | "absent" | "lost" | "manual";

/** One failed form rule on one rep (FORM_FLAG). */
export interface Flag {
  /** Rule id from the exercise spec. */
  rule_id: string;
  severity: Severity;
  /** 0-based within the set; equals the rep's rep_index. */
  rep_index: number;
}

/** Per-rep aggregates (REP). Times are integer ms on the set clock. */
export interface Rep {
  /** 0-based within the set: the engine's rep number minus 1. */
  rep_index: number;
  /** When the rep left the start position, ms since set start. */
  start_ms: number | null;
  /** When the rep was counted, ms since set start. */
  end_ms: number | null;
  /** Rep duration, start to count. */
  tempo_ms: number;
  /** Movement range: max minus min of the primary angle over the rep's gated frames up to the count. */
  range_deg: number;
  /** Form-quality model score, advisory only (INT-06). Null from the phone. */
  quality: number | null;
  /** Start to the turn: the first frame at the rep's direction-aware extreme. The lowering only for eccentric-first exercises. */
  lowering_ms: number | null;
  /** Turn to count: tempo_ms minus lowering_ms. */
  rising_ms: number | null;
  flags: Flag[];
}

/** One pose frame. Joints only, never video (Architecture §13). */
export interface JointFrame {
  /** ms since set start. */
  t_ms: number;
  /** 17 COCO joints flattened as x, y, c; x and y normalised 0-1 in the upright image, c is confidence. */
  kp: number[];
}

/** Body of POST /sessions/:id/sets, built on the phone when the set ends (AI-08). */
export interface SetRecord {
  schema_version: 1;
  /** 0-based position of the set in its session. */
  set_index: number;
  exercise_id: ExerciseId;
  weight_kg: number | null;
  end_reason: SetEndReason;
  /** Attempts that left the start position but weren't counted. */
  partial_reps: number;
  /** Measured over the kept frames; null with fewer than 2. */
  fps: number | null;
  frames: JointFrame[];
  reps: Rep[];
}

/** Body of POST /sessions. */
export interface SessionStart {
  /** ISO 8601 with offset. */
  started_at?: string;
  device?: string;
  inference_mode: InferenceMode;
}

/** One set as BE-04 hands it to the Databricks uploader (CONN-02). */
export interface ExportSet {
  set_index: number;
  exercise_id: ExerciseId;
  weight_kg: number | null;
  medal: Medal | null;
  /** Null for sets recorded before AI-08. */
  end_reason: SetEndReason | null;
  partial_reps: number | null;
  fps: number | null;
  frames: JointFrame[];
  reps: Rep[];
}

/** A finished session as BE-04 hands it to the uploader. user_id is the Neon id and never leaves the API. */
export interface ExportSession {
  id: string;
  user_id: string;
  started_at: string;
  finished_at: string;
  device: string;
  inference_mode: InferenceMode;
  medal: Medal | null;
  form_score: number | null;
  experience_level: string | null;
  /** Coarse tags: a body part, optionally with a side (knee, knee:left). */
  injury_groups: string[];
  /** YYYY-MM-DD start of the active rehab plan. */
  rehab_start_on: string | null;
  sets: ExportSet[];
}

/** One set in the metadata file: ExportSet without the frames. */
export interface MetaSet {
  set_index: number;
  exercise_id: ExerciseId;
  weight_kg: number | null;
  medal: Medal | null;
  end_reason: SetEndReason | null;
  partial_reps: number | null;
  frame_count: number;
  reps: Rep[];
}

/** meta/<date>/<session_id>.json on the Databricks Volume (bronze META_SCHEMA). */
export interface ExportMeta {
  schema_version: 1;
  session_id: string;
  /** HMAC pseudonym, never the Neon id. */
  user_id: string;
  started_at: string;
  finished_at: string;
  device: string;
  inference_mode: InferenceMode;
  medal: Medal | null;
  form_score: number | null;
  experience_level: string | null;
  injury_groups: string[];
  rehab_start_on: string | null;
  joints_path: string;
  exported_at: string;
  sets: MetaSet[];
}

/** One line of joints/<date>/<session_id>.ndjson.gz (bronze JOINTS_SCHEMA). */
export interface ExportJointsLine {
  session_id: string;
  set_index: number;
  exercise_id: ExerciseId;
  fps: number | null;
  frames: JointFrame[];
}
