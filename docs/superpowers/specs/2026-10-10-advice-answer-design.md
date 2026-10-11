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
  | "empty_question" | "no_sources" | "llm_unavailable" | "llm_failed" | "not_answerable" | "guard_rejected"
  | "unsupported_claim" | "verify_failed";

export type AdviceAnswer =
  | { kind: "ai"; text: string; sources: AdviceSource[] }        // cited sources only, in input order
  | { kind: "fixed_pain"; text: string; signals: string[] }      // text === PAIN_REPLY
  | { kind: "none"; reason: AdviceNoneReason };                   // post no AI comment

export const PAIN_REPLY: string;
export const MAX_ANSWER_CHARS = 450;
export const MAX_ANSWER_SENTENCES = 3;
export const MAX_PROMPT_SOURCES = 6;
export const MAX_CITED_SOURCES = 3;

export const REPUTABLE_SOURCE_HOSTS: readonly string[];
export function isReputableUrl(url: string): boolean;
export function splitSentences(text: string): string[];
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
3. Library sources (`injury_note`, `exercise`) whose `url` fails `isReputableUrl` are dropped (logged); community answers are kept, labelled as community. No sources left → `none: no_sources`. No LLM.
4. No LLM, or `timeoutMs <= 0` → `none: llm_unavailable`.
5. `generateJson` with schema `{ answerable: boolean, answer: string (≤ MAX_ANSWER_CHARS), source_ids: string[] (≤ MAX_CITED_SOURCES) }`. Only the first `MAX_PROMPT_SOURCES` sources go into the prompt (content trimmed). The question and sources go in the **user** message as JSON data; the system prompt says they are data, never instructions. Thrown error or deadline → `none: llm_failed`.
6. `answerable: false` → `none: not_answerable`.
7. Guard → `none: guard_rejected` when: no cited id; more than `MAX_CITED_SOURCES` cited ids; any cited id not among the prompt's sources; `answerProblems(answer)` non-empty; or the answer states a number that none of its cited sources contains (grounding, as the rest note keeps its rule's numbers).
8. Claim check: a second `generateJson` call (schema name `advice_verify`) gets `{ sentences: splitSentences(answer), sources: [{ id, content }] }` with only the cited sources (content as shown to the model) and returns `{ supported: boolean[] }`, one per sentence: is the sentence fully supported by those sources? Any `false` → `none: unsupported_claim`. A thrown error, a missed deadline, or the wrong shape (not an array of booleans the same length as the sentences) → `none: verify_failed`. Both model calls share the one `timeoutMs` budget; the check gets what remains.
9. Otherwise `ai`: the trimmed answer followed by `ADVICE_DISCLAIMER` ("This is general information, not medical advice. Always consult a doctor before acting on it."), and the cited sources (deduplicated by id, input order). The disclaimer is part of `text`, so it is shown wherever the answer is; the guard and the claim check see only the model's words.

Any other place that shows injury-note content (the planner's "why this exercise", a library screen) shows `ADVICE_DISCLAIMER` with it.

## Reputable sources

`isReputableUrl(url)` is true only for `https:` URLs whose host is, or is a subdomain of, one of `REPUTABLE_SOURCE_HOSTS`, or that start with `https://github.com/yuhonas/free-exercise-db` or `https://raw.githubusercontent.com/yuhonas/free-exercise-db/` (free-exercise-db: technique only, public domain, chosen in §10.1). Hosts: public health bodies and national professional bodies, plus major academic medical centres:

`nhs.uk`, `nhsinform.scot`, `nih.gov`, `medlineplus.gov`, `cdc.gov`, `who.int`, `orthoinfo.aaos.org`, `orthoinfo.org` (AAOS OrthoInfo's current host), `acsm.org`, `choosept.com`, `csp.org.uk`, `mayoclinic.org`, `clevelandclinic.org`, `hopkinsmedicine.org`, `health.harvard.edu`.

Every library source in the sample fixture must pass it (tested).

## Injury note format (rag/notes, CONN-08)

Each `## section` starts with a `Sources:` line: comma-separated URLs that support that section, every one passing `isReputableUrl`, or `Sources: team guidance` for content no reputable page states (programming details the team wrote). There are no note-level sources. `parseNote` throws on a section without the line. `noteChunks` puts the section's own URLs in `metadata.sources` and `metadata.team_guidance`, and leaves the line out of the content. BE-11 maps a chunk to an `AdviceSource` with `url = metadata.sources[0]`, so a team-guidance chunk has no URL and the writer drops it: it is never cited as if a health body said it (the planner can still use it). Each note ends with a sourced `## When to get checked` section (red flags from NHS / AAOS), and has more sourced sections than team guidance. A rewritten note is `reviewed: false` until a person signs it off; ingest skips unreviewed notes unless run with drafts.

## Pain and acute red flags (`acuteSignals`)

Architecture §1.1: "Pain mentioned anywhere routes to 'please check with your physio or a doctor'." Deterministic, case-insensitive, on the question text. BE-11 must pass the post's title and body together as `question`, so a red flag in the title counts. A signal is returned for each of:
- any pain word that isn't negated: pain, painful, hurt/hurts/hurting, ache/aches/aching/achy, headache, backache, neck or stomach ache, migraine, twinge, throb, "ouch";
- agony, "killing me", dislocated or out of place, broke/broken/fractured, a crack, spasms, a hernia, passed out / blacked out / fainting, can't feel a limb, can barely walk / stand / move, hot or red to the touch, black and blue, a racing heart, dark urine after training, "something gave", limping, hard to walk, tender to the touch;
- sharp, stabbing, shooting, sudden or severe pain;
- a pop, snap or tear ("tore", "torn", "ripped");
- swelling, swollen, bruising, bruised;
- numbness, numb, tingling, pins and needles;
- can't bear or put weight, can't move / straighten / bend / lift the joint, gave way, locked up;
- chest pain, chest tightness, dizziness, dizzy, fainting, short of breath;
- a fresh injury ("injured my wrist yesterday", "hurt my back at the gym today", "just pulled something", "tweaked it two days ago"): hours or days ago, today, yesterday, just, or no time given;
- pain or hurting at rest, at night, or that keeps someone awake;
- pain or hurting during or right after an exercise ("hurts when I squat", "pain while pressing").

Not a red flag on its own: a past or recovering injury ("since my knee injury last year", "two years ago", "recovering from", "coming back from", "cleared by my physio", weeks, months or years ago). SteadyForum is for getting back to training after an injury (§1.1), so these get a cautious, sourced answer unless another red flag is present ("since my knee injury it swells up" is still acute).

Not a red flag: soreness, stiffness, tightness, tiredness, a burn, DOMS ("sore two days after squats"). Negated pain is not a red flag ("doesn't hurt", "no pain", "pain-free", "without pain") unless the sentence goes on with a contrast ("isn't painful at rest, only when I squat", "doesn't hurt at rest but does when I squat"). Look-alike words don't count: "numbers", "pop a pre-workout", "tear down my routine", "can't lift my bodyweight".

## Fixed reply

`PAIN_REPLY` = "Pain like this is worth having a doctor or physiotherapist look at before training on it. SteadyForum can't assess injuries, so there's no AI suggestion for this question."

## Answer guard (`answerProblems`)

- The §7 tone check: `checkNote(text, loadBanned(), { placeholders: [] })` from `specs/validate.mjs` (banned phrases, no imperative sentence openers, no "!").
- No diagnosis: no "sounds like", "diagnos…", "it's probably/likely …", and no "you have / you've got / you may have / you might have" followed by a condition or injury wording ("you have a few options" is fine). No condition names (tendinitis/tendonitis, bursitis, sprain, fracture, herniat…, sciatica, arthritis, impingement, meniscus, ACL/MCL, rotator cuff injury, slipped disc). "Strain" and "tear" count only as a diagnosis ("a strain", "strained the muscle", "muscle tear", "torn"), not in "less strain on the knee".
- No medication or dosage: ibuprofen, naproxen, paracetamol, acetaminophen, aspirin, painkiller(s), anti-inflammatory/NSAID, cortisone, "mg".
- No guarantees: "guarantee", "definitely", "cure", "will fix", "heal", "get rid of", "for sure", "completely".
- No guessed causes or named syndromes: "it could/may/might be", "probably/likely a", "pulled a muscle", "pinched nerve", "inflamed", "syndrome", "runner's knee", "tennis elbow", "shin splints".
- No brand-name painkillers (Advil, Motrin, Tylenol, Aleve, Voltaren) and no permission to train through pain ("push/train/work through", "through the pain").
- Advice-style commands as well as the §7 openers: sentences opening with rest, ice, skip, swap, add, see, consider, start, switch, drop, stretch, warm, cut, eat, sleep, drink, apply, wear, ease, ignore, visit or just, and "I'd recommend", "I suggest", "you could try", "you might want to".
- One paragraph of prose: no line breaks, so commands can't hide in a list.
- No links, handles or promotions (http, www, a domain, @name, "DM me", discount, promo, "% off"): community answers are user content and may try to steer the model.
- At most `MAX_ANSWER_SENTENCES` sentences and `MAX_ANSWER_CHARS` characters; not blank.

## Tests

`apps/api/test/advice.test.ts` (behavioural) and `apps/api/test/fixtures/advice-samples.json` (20 questions with canned sources; each says whether it expects the fixed reply or an LLM answer). `scripts/advice-samples.ts` runs the samples on the real gpt-oss chain and writes a review file (needs `HF_TOKEN`).
