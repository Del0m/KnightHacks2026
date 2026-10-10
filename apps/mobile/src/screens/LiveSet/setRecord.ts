import { restNote } from '@/engine/rules';
import type { EngineEvent, ExerciseSpec, RepRecord, SetFlags } from '@/engine/types';
import type { WorkoutSet } from '@/services/workoutApi';
import type { PhoneResult } from './restCardContent';

export type SetFeedback = PhoneResult & { note: string };
export function setFeedback(spec: ExerciseSpec, summary: SetFlags, baseline = 0.7): SetFeedback {
  const total = summary.total_reps, clean = summary.clean_reps;
  const medal = total > 0 && clean === total ? 'gold' : total > 0 && Math.round(clean / total * 10000) >= Math.round(baseline * 10000) ? 'silver' : 'bronze';
  const news = `${clean} good ${clean === 1 ? 'rep' : 'reps'} / ${total} total.`;
  // One highest-priority suggestion. Injury notes stay with the effective spec, not extra advice cards.
  const note = restNote(spec, { ...summary, extra_notes: [] });
  return { medal, cleanReps: clean, totalReps: total, note: [news, note].filter(Boolean).join(' ') };
}

/** Store timing once per closed rep; no video or camera frames leave the device. */
export function createSetCapture(spec: ExerciseSpec) {
  const records = new Map<number, RepRecord>();
  return {
    onEvent(event: EngineEvent) { if (event.type === 'rep_closed') records.set(event.rep.index - 1, event.rep); },
    finish(summary: SetFlags): WorkoutSet {
      return { exercise_id: spec.id, reps: summary.reps.map(result => {
        const rep = records.get(result.rep_index);
        if (!rep) throw new Error('A counted rep is missing its measured timing.');
        return {
          // No frame upload yet: omit bounds rather than send the absolute pose clock.
          start_ms: null, end_ms: null,
          tempo_ms: Math.max(0, rep.countedAt - rep.startedAt),
          range_deg: Math.abs(spec.phases.start_enter - rep.extreme),
          quality: null, clean: result.flags.length === 0,
          flags: result.flags.map(({ rule_id, severity }) => ({ rule_id, severity })),
        };
      }) };
    },
  };
}
