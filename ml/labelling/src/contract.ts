export const EXERCISE_IDS = ['squat', 'push_up', 'bicep_curl', 'shoulder_press', 'lunge'] as const;
export type ExerciseId = typeof EXERCISE_IDS[number];
export type View = 'front' | 'side';
export const LABEL_VIEWS: Record<ExerciseId, Record<string, View | 'any'>> = {
    squat: { clean: 'any', partial_range: 'side', knees_in: 'front', forward_lean: 'side', fast_lowering: 'any' },
    push_up: { clean: 'any', partial_range: 'any', hip_sag: 'side', incomplete_lockout: 'any', fast_lowering: 'any' },
    bicep_curl: { clean: 'any', partial_range: 'any', elbow_drift: 'side', torso_swing: 'side', fast_lowering: 'any' },
    shoulder_press: { clean: 'any', back_arch: 'side', incomplete_lockout: 'any', wrists_off_stack: 'front', fast_lowering: 'any' },
    lunge: { clean: 'any', partial_range: 'side', forward_lean: 'side', fast_lowering: 'any' },
};
export interface ConsentRecord {
    reference: string;
    participant_id: string;
    version: 'joint-capture-v1';
    granted_at: string;
    purpose: 'private_model_development';
    status: 'active' | 'withdrawn';
    publication_allowed: false;
}
export interface DatasetJoint {
    x: number;
    y: number;
    c: number;
}
export type DatasetFrame = {
    timestamp_ms: number;
    absent: true;
} | {
    timestamp_ms: number;
    score: number;
    joints: DatasetJoint[];
};
export type ClipFrame = DatasetFrame;
export interface RepAnnotation {
    rep_id: string;
    start_frame: number;
    end_frame: number;
    state: 'accepted' | 'uncertain' | 'discard';
    human_labels: string[];
    primary_label: string | null;
    reviewer_id: string;
    reviewed_at: string;
    boundary_provenance: 'manual' | 'engine' | 'engine_adjusted';
    revision: number;
}
export interface RepSuggestion {
    start_frame: number;
    end_frame: number;
    rule_flags: string[];
}
export interface DatasetClip {
    schema_version: 1;
    clip_id: string;
    session_id: string;
    participant_id: string;
    exercise_id: ExerciseId;
    view: View;
    camera_position: 'front' | 'back';
    side: 'left' | 'right' | 'bilateral';
    context: 'standard' | 'modified' | 'prescribed';
    image: {
        width: number;
        height: number;
    };
    source: 'coreml' | 'vision';
    model: string;
    origin: 'recorded' | 'synthetic';
    consent: {
        reference: string;
        version: 'joint-capture-v1';
        allowed_use: true;
        purpose: 'private_model_development';
    };
    status: 'recording' | 'complete' | 'incomplete';
    stop_reason: 'manual' | 'limit' | 'background' | 'camera_error' | 'mode_change' | 'recovered' | null;
    frames: DatasetFrame[];
    annotations: RepAnnotation[];
    suggestions: RepSuggestion[];
}
