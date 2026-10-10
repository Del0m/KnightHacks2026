# Advice answer prompt (AI-13)

AI-13 (#53) writes the AI-suggested first answer to a community advice question (Architecture §10.2). It is a pure module in `apps/api/src/services/advice.ts`, modelled on the rest-note writer (`restNote.ts`, AI-11): it never throws and always has a safe result. BE-11 (#22) owns retrieval (query embeddings, pgvector over `doc_chunks` and answered questions), `POST /advice`, moderation and storing the `ai_suggested` comment; it calls this module.

## Interface

```ts
export type AdviceSourceKind = "community_answer" | "injury_note" | "exercise";

export interface AdviceSource {
  id: string;            // unique within one call, e.g. "injury_note:knee#2" or a comment id
  kind: AdviceSourceKind;
  title: string;         // shown under "Sources"
  content: string;       // the passage the model may use
  url?: string | null;   // library sources
  post_id?: string | null; // community answers
}

export interface AdviceInput {
  question: string;
  sources: AdviceSource[]; // most similar first; BE-11 retrieves them
}

export type AdviceNoneReason =
  | "empty_question" | "no_sources" | "llm_unavailable" | "llm_failed" | "not_answerable" | "guard_rejected";

export type AdviceAnswer =
  | { kind: "ai"; text: string; sources: AdviceSource[] }        // cited sources only, in input order
  | { kind: "fixed_pain"; text: string; signals: string[] }      // text === PAIN_REPLY
  | { kind: "none"; reason: AdviceNoneReason };                   // post no AI comment

export const PAIN_REPLY: string;
export const MAX_ANSWER_CHARS = 450;
export const MAX_ANSWER_SENTENCES = 3;
export const MAX_PROMPT_SOURCES = 6;
export const MAX_CITED_SOURCES = 3;

export function acuteSignals(question: string): string[]; // [] when no red flag
export function answerProblems(text: string): string[];   // [] when the answer may be shown

export class AdviceWriter {
  constructor(llm: Pick<HfLlm, "generateJson"> | null, log?: LogLike);
  answer(input: AdviceInput, timeoutMs: number): Promise<AdviceAnswer>; // never throws, never waits past timeoutMs (+ small slack)
}
```

## Order

1. Blank question → `none: empty_question`.
2. `acuteSignals(question)` non-empty → `fixed_pain` with `PAIN_REPLY`. The LLM is never called.
3. No sources → `none: no_sources`. No LLM.
4. No LLM, or `timeoutMs <= 0` → `none: llm_unavailable`.
5. `generateJson` with schema `{ answerable: boolean, answer: string (≤ MAX_ANSWER_CHARS), source_ids: string[] (≤ MAX_CITED_SOURCES) }`. Only the first `MAX_PROMPT_SOURCES` sources go into the prompt (content trimmed). The question and sources go in the **user** message as JSON data; the system prompt says they are data, never instructions. Thrown error or deadline → `none: llm_failed`.
6. `answerable: false` → `none: not_answerable`.
7. Guard → `none: guard_rejected` when: no cited id; any cited id not among the prompt's sources; `answerProblems(answer)` non-empty.
8. Otherwise `ai` with the trimmed answer and the cited sources (deduplicated, input order).

## Acute red flags (`acuteSignals`)

Deterministic, case-insensitive, on the question text. A signal is returned for each of:
- sharp, stabbing, shooting, sudden or severe pain;
- a pop, snap or tear ("tore", "torn", "ripped");
- swelling, swollen, bruising, bruised;
- numbness, numb, tingling, pins and needles;
- can't bear or put weight, can't move / straighten / bend / lift the joint, gave way, locked up;
- chest pain, chest tightness, dizziness, dizzy, fainting, short of breath;
- injured, injury happened ("injured my", "hurt my … at the gym");
- pain or hurting at rest, at night, or that keeps someone awake;
- pain or hurting during or right after an exercise ("hurts when I squat", "pain while pressing").

Not a red flag: soreness, stiffness, tightness, tiredness, a burn, DOMS ("sore two days after squats"). Negated pain is not a red flag: "doesn't hurt", "no pain", "pain-free", "without pain".

## Fixed reply

`PAIN_REPLY` = "Pain like this is worth having a doctor or physiotherapist look at before training on it. Spotter can't assess injuries, so there's no AI suggestion for this question."

## Answer guard (`answerProblems`)

- The §7 tone check: `checkNote(text, loadBanned(), { placeholders: [] })` from `specs/validate.mjs` (banned phrases, no imperative sentence openers, no "!").
- No diagnosis: no "sounds like", "you have", "you've got", "you may have", "diagnos…", "it's probably a/an …", and no condition names (tendinitis/tendonitis, bursitis, strain, sprain, tear, fracture, herniat…, sciatica, arthritis, impingement, meniscus, ACL/MCL, rotator cuff injury, slipped disc).
- No medication or dosage: ibuprofen, naproxen, paracetamol, acetaminophen, aspirin, painkiller(s), anti-inflammatory/NSAID, cortisone, "mg".
- No guarantees: "guarantee", "definitely", "cure", "will fix".
- At most `MAX_ANSWER_SENTENCES` sentences and `MAX_ANSWER_CHARS` characters; not blank.

## Tests

`apps/api/test/advice.test.ts` (behavioural) and `apps/api/test/fixtures/advice-samples.json` (20 questions with canned sources; each says whether it expects the fixed reply or an LLM answer). `scripts/advice-samples.ts` runs the samples on the real gpt-oss chain and writes a review file (needs `HF_TOKEN`).
