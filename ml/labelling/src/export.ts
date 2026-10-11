import type { ConsentRecord, DatasetClip } from './contract.ts';
import { assertCollection } from './validate.ts';
import { coverage } from './coverage.ts';
import { deriveRep, PREPROCESSING_CONFIG } from './preprocess.ts';

export type Digest = (text: string) => Promise<string>;
export interface DatasetBundle {
  schema_version: 1;
  clips_jsonl: string;
  training_jsonl: string;
  manifest: {
    schema_version: 1;
    checksums: { clips_jsonl: string; training_jsonl: string };
    counts: ReturnType<typeof coverage>;
    preprocessing: typeof PREPROCESSING_CONFIG;
    consents: { reference: string; participant_id: string; status: 'active'; allowed_use: true }[];
  };
}

const lines = (rows: unknown[]) => rows.length ? rows.map((row) => JSON.stringify(row)).join('\n') + '\n' : '';

/** Defense in depth: explicit fields at every level, without rounding the source observations. */
export function serializeClip(clip: DatasetClip): DatasetClip {
  return {
    schema_version: clip.schema_version,
    clip_id: clip.clip_id, session_id: clip.session_id, participant_id: clip.participant_id,
    exercise_id: clip.exercise_id, view: clip.view, camera_position: clip.camera_position,
    side: clip.side, context: clip.context,
    image: { width: clip.image.width, height: clip.image.height },
    source: clip.source, model: clip.model, origin: clip.origin,
    consent: {
      reference: clip.consent.reference, version: clip.consent.version,
      allowed_use: clip.consent.allowed_use, purpose: clip.consent.purpose,
    },
    status: clip.status, stop_reason: clip.stop_reason,
    frames: clip.frames.map((frame) => 'absent' in frame
      ? { timestamp_ms: frame.timestamp_ms, absent: true as const }
      : {
        timestamp_ms: frame.timestamp_ms, score: frame.score,
        joints: frame.joints.map((joint) => ({ x: joint.x, y: joint.y, c: joint.c })),
      }),
    annotations: clip.annotations.map((annotation) => ({
      rep_id: annotation.rep_id, start_frame: annotation.start_frame, end_frame: annotation.end_frame,
      state: annotation.state, human_labels: annotation.human_labels.map((label) => label),
      primary_label: annotation.primary_label, reviewer_id: annotation.reviewer_id,
      reviewed_at: annotation.reviewed_at, boundary_provenance: annotation.boundary_provenance,
      revision: annotation.revision,
    })),
    suggestions: clip.suggestions.map((suggestion) => ({
      start_frame: suggestion.start_frame, end_frame: suggestion.end_frame,
      rule_flags: suggestion.rule_flags.map((flag) => flag),
    })),
  };
}

/** Collection validation rejects unknown properties before serialization. No private registry is exported. */
export async function createBundle(clips: DatasetClip[], consents: ConsentRecord[], digest: Digest): Promise<DatasetBundle> {
  assertCollection(clips, consents);
  if (clips.some((clip) => clip.status === 'recording' && clip.annotations.some((a) => a.state === 'accepted'))) throw new Error('Stop capture before exporting accepted reps');
  const clipsJsonl = lines(clips.map(serializeClip));
  const training = clips.flatMap((clip) => clip.origin !== 'recorded' ? [] : clip.annotations
    .filter((a) => a.state === 'accepted')
    .map((annotation) => ({
      schema_version: 1, rep_id: annotation.rep_id, clip_id: clip.clip_id,
      participant_id: clip.participant_id, session_id: clip.session_id,
      exercise_id: clip.exercise_id, view: clip.view, side: clip.side, context: clip.context,
      consent_reference: clip.consent.reference,
      start_frame: annotation.start_frame, end_frame: annotation.end_frame,
      human_labels: annotation.human_labels, primary_label: annotation.primary_label,
      reviewer_id: annotation.reviewer_id, reviewed_at: annotation.reviewed_at,
      boundary_provenance: annotation.boundary_provenance, revision: annotation.revision,
      ...deriveRep(clip, annotation),
    })));
  const trainingJsonl = lines(training);
  const references = new Map(clips.map((c) => [c.consent.reference, c.participant_id]));
  const consentSummaries = [...references].sort(([a], [b]) => a.localeCompare(b)).map(([reference, participant_id]) => ({
    reference, participant_id, status: 'active' as const, allowed_use: true as const,
  }));
  return {
    schema_version: 1, clips_jsonl: clipsJsonl, training_jsonl: trainingJsonl,
    manifest: {
      schema_version: 1,
      checksums: { clips_jsonl: await digest(clipsJsonl), training_jsonl: await digest(trainingJsonl) },
      counts: coverage(clips, consents), preprocessing: { ...PREPROCESSING_CONFIG }, consents: consentSummaries,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return '{' + Object.keys(row).sort().map((key) => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function parseLines(text: string): unknown[] {
  if (!text) return [];
  const rows = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (rows.some((line) => !line.trim())) throw new Error('Empty JSONL row');
  return rows.map((line) => JSON.parse(line));
}

export async function validateBundle(value: unknown, consents: ConsentRecord[], digest: Digest): Promise<DatasetClip[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bundle');
  const bundle = value as DatasetBundle;
  if (Object.keys(bundle).sort().join(',') !== 'clips_jsonl,manifest,schema_version,training_jsonl' || bundle.schema_version !== 1 || typeof bundle.clips_jsonl !== 'string' || typeof bundle.training_jsonl !== 'string') throw new Error('Invalid bundle fields');
  const clips = parseLines(bundle.clips_jsonl) as DatasetClip[];
  assertCollection(clips, consents);
  const expected = await createBundle(clips, consents, digest);
  if (canonical(bundle.manifest) !== canonical(expected.manifest)) throw new Error('Manifest, consent or checksums do not match source');
  if (canonical(parseLines(bundle.training_jsonl)) !== canonical(parseLines(expected.training_jsonl))) throw new Error('Training rows do not match reviewed source');
  // Exact bytes are part of the checksum contract; canonical comparison above permits key order only in rows.
  if (await digest(bundle.training_jsonl) !== bundle.manifest.checksums.training_jsonl || await digest(bundle.clips_jsonl) !== bundle.manifest.checksums.clips_jsonl) throw new Error('Checksum mismatch');
  return clips;
}

export async function importBundle(value: unknown, consents: ConsentRecord[], digest: Digest, existingClips: DatasetClip[] = []): Promise<DatasetClip[]> {
  const clips = await validateBundle(value, consents, digest);
  assertCollection([...existingClips, ...clips], consents);
  return clips;
}
