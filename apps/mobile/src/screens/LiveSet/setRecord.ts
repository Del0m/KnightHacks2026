import { restNote } from '@/engine/rules';
import type { ExerciseSpec, SetFlags } from '@/engine/types';
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
