// AI-11 / INT-05: the one rest note shown between sets (Architecture §7).
//
// A note is two parts, good news first:
//   1. how many reps were clean, counted from the phone's rule flags (INT-06), so it always
//      agrees with the set medal ("6 of 8 reps were clean.")
//   2. at most one suggestion: the highest-priority flagged rule's spec rest_note, with {n},
//      {total}, {value} and {t} filled in, optionally rephrased by gpt-oss (CONN-07)
//
// The LLM only writes part 2 and only when there is a flag; its sentence must pass the same tone
// check as the specs' fixed notes (specs/validate.mjs: banned phrases, no commands, no "!").
// If it is slow, fails or fails the check, the fixed rest_note is used (source: "fixed").
import { checkNote, loadBanned } from "../../../../specs/validate.mjs";
import type { HfLlm, JsonSchema } from "../integrations/huggingface/llm.js";

export interface RestNote {
  text: string;
  source: "llm" | "fixed";
  rule_id: string | null; // the rule the suggestion is about, null for an all-clean set
}

// What restNote needs from a spec rule (specs/exercises/*.json).
export interface SpecRule {
  id: string;
  priority: number; // 1 = most important
  rest_note: string;
  label?: string;
  check?: { metric?: string; value?: unknown };
}

export interface NoteRep {
  flags: { rule_id: string }[];
  tempo_ms?: number | null;
}

export interface NoteInput {
  exerciseName: string;
  reps: NoteRep[];
  rules: SpecRule[];
}

export interface NoteFacts {
  total: number;
  clean: number;
  top: { rule: SpecRule; n: number } | null; // highest-priority flagged rule with a spec
}

const banned = loadBanned();
const MAX_SUGGESTION_CHARS = 160;

export function noteFacts(input: NoteInput): NoteFacts {
  const total = input.reps.length;
  const clean = input.reps.filter((r) => r.flags.length === 0).length;
  const counts = new Map<string, number>();
  for (const rep of input.reps) {
    for (const id of new Set(rep.flags.map((f) => f.rule_id))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const top = input.rules
    .filter((r) => counts.has(r.id))
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => ({ rule, n: counts.get(rule.id)! }))[0];
  return { total, clean, top: top ?? null };
}

export function goodNews(facts: NoteFacts): string {
  if (facts.total === 0) return "Set logged.";
  if (facts.clean === 0) return `${facts.total} ${facts.total === 1 ? "rep" : "reps"} done.`;
  return `${facts.clean} of ${facts.total} reps were clean.`;
}

// Seconds for duration rules ({t}): the average rep time of the flagged reps, one decimal.
function flaggedSeconds(input: NoteInput, ruleId: string): string | null {
  const times = input.reps
    .filter((r) => r.flags.some((f) => f.rule_id === ruleId) && typeof r.tempo_ms === "number")
    .map((r) => r.tempo_ms!);
  if (!times.length) return null;
  return (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1).replace(/\.0$/, "");
}

/** The spec's rest_note with its placeholders filled in, or null if one can't be filled. */
export function fillRuleNote(input: NoteInput, facts: NoteFacts): string | null {
  if (!facts.top) return null;
  const { rule, n } = facts.top;
  const values: Record<string, string | null> = {
    n: String(n),
    total: String(facts.total),
    value: typeof rule.check?.value === "number" ? String(rule.check.value) : null,
    t: flaggedSeconds(input, rule.id),
  };
  let missing = false;
  const text = rule.rest_note.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = values[name];
    if (v == null) missing = true;
    return v ?? "";
  });
  return missing ? null : text;
}

export function fixedNote(input: NoteInput): RestNote {
  const facts = noteFacts(input);
  const suggestion = fillRuleNote(input, facts);
  return {
    text: suggestion ? `${goodNews(facts)} ${suggestion}` : goodNews(facts),
    source: "fixed",
    rule_id: suggestion ? facts.top!.rule.id : null,
  };
}

/** Problems with an LLM-written suggestion, or [] if it may be shown. */
export function suggestionProblems(text: string): string[] {
  const problems = checkNote(text, banned, { placeholders: [] });
  if (text.length > MAX_SUGGESTION_CHARS) problems.push("too long");
  if ((text.match(/[.?!](\s|$)/g) ?? []).length > 1) problems.push("more than one sentence");
  // The clean count comes from goodNews(), which matches the medal; the LLM mustn't restate it.
  if (/\b\d+ (of|out of) \d+\b/i.test(text)) problems.push("restates the clean count");
  return problems;
}

const SUGGESTION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suggestion"],
  properties: { suggestion: { type: "string", maxLength: MAX_SUGGESTION_CHARS } },
};

const SYSTEM = [
  "You rewrite one coaching suggestion for a lifter resting between sets.",
  "Write exactly one short, kind sentence (under 25 words) about the movement, not the person.",
  "Describe what helps, as an observation or an option. Never give a command, never start with a verb like",
  "'keep', 'try' or 'make', and never use words like must, should, don't, always, never, bad or wrong.",
  "No exclamation marks and no rep counts. Keep the meaning of the original note.",
].join(" ");

export class RestNoteWriter {
  constructor(private readonly llm: Pick<HfLlm, "generateJson"> | null) {}

  /** The rest note for a set. Never throws; falls back to the fixed note within `timeoutMs`. */
  async write(input: NoteInput, timeoutMs: number): Promise<RestNote> {
    const fixed = fixedNote(input);
    const facts = noteFacts(input);
    if (!this.llm || !fixed.rule_id || !facts.top || timeoutMs <= 0) return fixed;

    const ruleNote = fillRuleNote(input, facts)!;
    try {
      const { data } = await this.llm.generateJson<{ suggestion: string }>({
        schema: SUGGESTION_SCHEMA,
        schemaName: "rest_note",
        system: SYSTEM,
        user: JSON.stringify({
          exercise: input.exerciseName,
          about: facts.top.rule.label ?? facts.top.rule.id,
          original_note: ruleNote,
        }),
        timeoutMs,
        // gpt-oss reasons before it answers and the reasoning counts against max_tokens: at 200
        // the reasoning used it all and the reply came back empty. 1024 answers in ~0.3-0.9 s.
        maxTokens: 1024,
        temperature: 0.4,
      });
      const suggestion = data.suggestion.trim();
      if (suggestionProblems(suggestion).length) return fixed;
      return { text: `${goodNews(facts)} ${suggestion}`, source: "llm", rule_id: fixed.rule_id };
    } catch {
      return fixed; // slow or failed: the fixed note is always ready
    }
  }
}
