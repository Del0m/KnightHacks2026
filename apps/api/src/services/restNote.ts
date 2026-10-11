// AI-11 / INT-05: the one rest note shown between sets (Architecture §7).
//
// A note is two parts, good news first:
//   1. how many reps were clean, counted from the phone's rule flags (INT-06), so it always
//      agrees with the set medal ("6 of 8 reps were clean.")
//   2. at most one suggestion: the highest-priority flagged rule's spec rest_note, with {n},
//      {total}, {value} and {t} filled in, optionally rephrased by gpt-oss (CONN-07). Like the
//      fixed notes, it may be a fact and a reason (two sentences), and it keeps their numbers.
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
  lowering_ms?: number | null; // AI-08: start of the rep to its turn; what the tempo rules measure
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
const MAX_SUGGESTION_CHARS = 200;
const MAX_SUGGESTION_SENTENCES = 2; // a fact and a reason, like the fixed notes

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

// Seconds for duration rules ({t}): the flagged reps' average lowering time, one decimal. Every
// spec's tempo rule measures the lowering phase and its note says "on the way down", so the
// whole rep's tempo_ms would overstate it ("1.6 s on the way down" for a rep lowered in 0.7 s).
// Reps without lowering_ms (unmeasured) are left out; with none, the note can't be filled and
// the fixed "n of m clean" line is used instead.
function flaggedSeconds(input: NoteInput, ruleId: string): string | null {
  const times = input.reps
    .filter((r) => r.flags.some((f) => f.rule_id === ruleId) && typeof r.lowering_ms === "number")
    .map((r) => r.lowering_ms!);
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

const numbers = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * Problems with an LLM-written suggestion, or [] if it may be shown. With `original` (the filled-in
 * rule note it rewrites), the suggestion must keep the original's numbers and add none: "about
 * 0.8 s" and "on 3 reps" make a note specific (Architecture §7), and an invented number is a
 * wrong fact.
 */
export function suggestionProblems(text: string, original?: string): string[] {
  const problems = checkNote(text, banned, { placeholders: [] });
  if (text.length > MAX_SUGGESTION_CHARS) problems.push("too long");
  if ((text.match(/[.?!](\s|$)/g) ?? []).length > MAX_SUGGESTION_SENTENCES) {
    problems.push(`more than ${MAX_SUGGESTION_SENTENCES} sentences`);
  }
  const kept = new Set(numbers(text));
  const dropped = original ? numbers(original).filter((n) => !kept.has(n)) : [];
  if (dropped.length) problems.push(`drops the original's numbers (${dropped.join(", ")})`);
  const given = new Set(original ? numbers(original) : []);
  const invented = original ? [...kept].filter((n) => !given.has(n)) : [];
  if (invented.length) problems.push(`adds numbers the original doesn't have (${invented.join(", ")})`);
  // The clean count comes from goodNews(), which matches the medal; the LLM mustn't restate it.
  if (/\b\d+ (of|out of) \d+\b/i.test(text)) problems.push("restates the clean count");
  // About the movement, not the person: "your knees drifted" is fine, "you are leaning" is not.
  if (/\byou(?:'re|\s+are|\s+were|\s+seem|\s+look)\b/i.test(text.replace(/\u2019/g, "'"))) {
    problems.push("describes the person, not the movement");
  }
  return problems;
}

const SUGGESTION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suggestion"],
  properties: { suggestion: { type: "string", maxLength: MAX_SUGGESTION_CHARS } },
};

// Worked examples pin the tone better than rules alone. Without them gpt-oss either adds reasons
// the spec doesn't give ("engages the deltoids") or turns a suggestion into a claim that the
// lifter already did it ("Your hips are level with your knees").
const SYSTEM = [
  "You reword one coaching note for a lifter resting between sets, so it reads naturally and kindly.",
  "Reword only: say what the original says and nothing more. Add no new facts, reasons, benefits,",
  "muscles or advice, and change none. Keep every number, written as digits exactly as given.",
  "What happened stays in the past tense; what helps stays an option for the next set, never something",
  "already done. Write one or two short sentences (under 35 words in all) about the movement, not the person.",
  "Never give a command or start a sentence with an imperative verb (keep, try, make, lower, push...),",
  "never use words like must, should, don't, always, never, bad or wrong, no exclamation marks, and never",
  "say how many reps were clean.",
  "Examples of original -> reworded:",
  "'Next set, try lowering until your hips are level with your knees.' ->",
  "'Lowering until your hips are level with your knees could give a fuller squat next set.'",
  "'Your knees drifted inward on 3 reps. Pointing them over your toes keeps them comfortable.' ->",
  "'Your knees drifted inward on 3 reps. Knees that point over your toes tend to feel more comfortable.'",
  "'Your reps took about 0.8 s on the way down. Around 2 s gives you more control.' ->",
  "'The way down took about 0.8 s per rep. Closer to 2 s gives more control.'",
].join(" ");

// Console or pino: both take a plain message.
export interface LogLike {
  warn(msg: string): void;
}

const silent: LogLike = { warn: () => {} };

export class RestNoteWriter {
  constructor(
    private readonly llm: Pick<HfLlm, "generateJson"> | null,
    private readonly log: LogLike = silent,
  ) {}

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
        temperature: 0.2,
      });
      const suggestion = data.suggestion.trim();
      const problems = suggestionProblems(suggestion, ruleNote);
      if (problems.length) {
        this.log.warn(`[rest-note] guard rejected "${suggestion}": ${problems.join("; ")}`);
        return fixed;
      }
      return { text: `${goodNews(facts)} ${suggestion}`, source: "llm", rule_id: fixed.rule_id };
    } catch (err) {
      // Slow or failed: the fixed note is always ready.
      this.log.warn(`[rest-note] LLM failed: ${err instanceof Error ? err.message : String(err)}`);
      return fixed;
    }
  }
}
