import { EXERCISE_IDS } from './contract.ts';
import type { ConsentRecord, DatasetClip, ExerciseId } from './contract.ts';
import { validateClip } from './validate.ts';
export interface CoverageReport {
    complete: boolean;
    total: number;
    by_exercise: Record<ExerciseId, number>;
    by_label: Record<string, number>;
    by_participant: Record<string, number>;
    deficits: Record<ExerciseId, number>;
}
export function coverage(clips: DatasetClip[], consents: ConsentRecord[]): CoverageReport {
    const by_exercise = Object.fromEntries(EXERCISE_IDS.map(e => [e, 0])) as Record<ExerciseId, number>;
    const by_label: Record<string, number> = Object.create(null), by_participant: Record<string, number> = Object.create(null);
    const seenClips = new Set<string>(), seenReps = new Set<string>();
    let total = 0;
    for (const clip of clips) {
        if (seenClips.has(clip.clip_id))
            continue;
        seenClips.add(clip.clip_id);
        if (clip.origin !== 'recorded' || clip.status === 'recording' || validateClip(clip, consents).length)
            continue;
        for (const a of clip.annotations) {
            if (a.state !== 'accepted' || seenReps.has(a.rep_id))
                continue;
            seenReps.add(a.rep_id);
            total++;
            by_exercise[clip.exercise_id]++;
            by_label[a.primary_label!] = (by_label[a.primary_label!] ?? 0) + 1;
            by_participant[clip.participant_id] = (by_participant[clip.participant_id] ?? 0) + 1;
        }
    }
    const deficits = Object.fromEntries(EXERCISE_IDS.map(e => [e, Math.max(0, 40 - by_exercise[e])])) as Record<ExerciseId, number>;
    return { complete: EXERCISE_IDS.every(e => deficits[e] === 0), total, by_exercise, by_label, by_participant, deficits };
}
