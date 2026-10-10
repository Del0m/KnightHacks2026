// INT-05 / FE-07: what the rest card shows. The phone's own result appears at once; the server's
// (POST /sessions/:id/sets → { score, rest_note }) replaces it if it arrives while the rest is on.

export type Medal = 'gold' | 'silver' | 'bronze';

/** What the phone knows the moment the set ends (its rule flags, INT-06). */
export interface PhoneResult {
  medal: Medal;
  cleanReps: number;
  totalReps: number;
}

/** The part of the API's set response the card uses. */
export interface ServerRestResult {
  score: { medal: Medal; source: 'databricks' | 'phone' };
  rest_note: { text: string; source: 'llm' | 'fixed'; rule_id: string | null };
}

export interface RestCardContent {
  medal: Medal;
  note: string;
  fromServer: boolean;
}

/** Same good-news line as the API's fixed note, so the swap doesn't change the count. */
export function phoneNote({ cleanReps, totalReps }: PhoneResult): string {
  if (totalReps === 0) return 'Set logged.';
  if (cleanReps === 0) return `${totalReps} ${totalReps === 1 ? 'rep' : 'reps'} done.`;
  return `${cleanReps} of ${totalReps} reps were clean.`;
}

/**
 * The phone result until the server's arrives; the server's only if it arrived during the rest,
 * so the card never changes after the next set has started.
 */
export function restCardContent(phone: PhoneResult, server: ServerRestResult | null, arrivedDuringRest: boolean): RestCardContent {
  if (server && arrivedDuringRest) return { medal: server.score.medal, note: server.rest_note.text, fromServer: true };
  return { medal: phone.medal, note: phoneNote(phone), fromServer: false };
}

export const MEDAL_LABEL: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
