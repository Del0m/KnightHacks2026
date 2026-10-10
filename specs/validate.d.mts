// Types for validate.mjs, so the API can reuse the rest-note tone check (INT-05, AI-11).

export interface BannedPhrases {
  description?: string;
  phrases: string[];
  imperative_openers: string[];
}

export const NOTE_PLACEHOLDERS: string[];

export function loadBanned(): BannedPhrases;

/** Problems with a note's phrasing, or [] if it reads as a description rather than a command. */
export function checkNote(text: string, banned: BannedPhrases, options?: { placeholders?: string[] }): string[];
