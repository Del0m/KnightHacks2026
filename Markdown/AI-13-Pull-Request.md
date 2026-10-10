Closes #53.

This adds the advice answer writer in `apps/api/src/services/advice.ts`. BE-11 (#22) hands it a community advice question and the sources it retrieved, and gets back one of three results:
- **An answer:** a short gpt-oss answer that cites 1 to 3 of those sources.
- **The fixed reply:** for a question that mentions pain or an acute sign. The model never sees the question.
- **No AI answer:** community answers carry the thread.

The writer never throws and enforces its own deadline. It follows the AI-11 rest-note writer (`restNote.ts`): a JSON-schema prompt through the CONN-07 client, a guard on the output, and a safe fallback.

Branched from `main` at `5b83b0c`. Built in a separate worktree, so the AI-09 labelling checkout was not touched.

## What it produces

| Result | When | BE-11 does |
|---|---|---|
| `{ kind: "ai", text, sources }` | The model answered from the given sources, and the guard passed | Posts `text` as the `ai_suggested` first comment, with `sources` (title plus URL or post id) shown under "AI suggestion" |
| `{ kind: "fixed_pain", text, signals }` | The question mentions pain, or an acute sign (§1.1) | Posts `PAIN_REPLY` instead of an AI answer. `signals` is for logs only. |
| `{ kind: "none", reason }` | Blank question, nothing to cite, no model or time budget, the model failed or declined, or the guard rejected the answer | Posts no AI comment |

`PAIN_REPLY` is: "Pain like this is worth having a doctor or physiotherapist look at before training on it. Spotter can't assess injuries, so there's no AI suggestion for this question."

## Changes

- **`advice.ts`.** The full contract is in `docs/superpowers/specs/2026-10-10-advice-answer-design.md`.
  - **Order of checks:**
    1. A blank question gets no answer.
    2. A pain or acute check in code gives the fixed reply.
    3. No sources gives no answer.
    4. No model or no time budget gives no answer.
    5. gpt-oss writes `{ answerable, answer, source_ids }` from the question and up to 6 sources. They're passed in the user message as JSON data, and the system prompt treats them as data, never instructions.
    6. `answerable: false` gives no answer.
    7. The guard runs, and a rejection gives no answer.
  - **Pain rule (`acuteSignals`).** Architecture §1.1 says "Pain mentioned anywhere routes to 'please check with your physio or a doctor'".
    - **Flagged:** any pain word that isn't negated (pain, hurt, ache, headache, twinge, throb…), and acute signs: sharp or sudden pain, a pop or tear, swelling or bruising, numbness, can't bear weight, a joint that gave way, chest pain or dizziness, a fresh injury, fractures, dislocations, spasms, passing out, dark urine after training, and similar.
    - **Negation:** "doesn't hurt", "no pain" and "pain-free" don't count, unless the sentence goes on with a contrast ("isn't painful at rest, only when I squat").
    - **Not flagged:** soreness, stiffness, tightness and a burn.
    - **Past injuries:** a past or recovering injury with no pain and no acute sign ("since my knee injury last year, cleared by my physio") gets an answer, because training again after an injury is what Spotter is for. Only the injury flag is exempted.
  - **Guard (`answerProblems` plus checks in the writer).** An answer is rejected when it:
    - cites no source, more than 3, or one it wasn't shown
    - states a number that no cited source contains
    - fails the §7 tone check from `specs/validate.mjs` (banned phrases, imperative openers, "!")
    - diagnoses, guesses a cause or names a condition. "You have a few options" and "less strain on the knee" pass.
    - mentions medication, a dose or a brand-name painkiller
    - promises an outcome, or permits training through pain
    - uses advice-style commands ("Rest the knee…", "I'd recommend…", "Consider…")
    - contains line breaks, links, handles or promotions. Community answers are user content and may try to steer the model.
  - **Deadline:** the writer stops waiting 250 ms after `timeoutMs`, even if the client ignores its own timeout.
- **`scripts/advice-samples.ts` (`npm run advice:samples`).** It runs the 20 sample questions on the real chain and writes `docs/reviews/advice-<date>.md`: a summary table, each answer with its cited sources, and a "Reviewer notes" line per question. It needs `HF_TOKEN`, and rejects bad flags before any network call.
- **`test/fixtures/advice-samples.json`.** 20 questions covering acute pain, soreness, technique, programming, diagnosis bait and off-topic, with canned sources. The injury-note excerpts are quoted from `rag/notes`; the exercise passages are written in the library's style.
- **Docs.** Root `Architecture.md` §10.2 describes the writer, the pain rule, the guard and the fallback. The design note is the contract.

### Decisions taken

- AI-13 is the answer module only. BE-11 owns retrieval (query embeddings, pgvector over `doc_chunks` and answered questions), `POST /advice`, moderation and storing the comment.
- The pain rule follows §1.1. Mild soreness and past injuries without pain still get an answer.
- When there's nothing to cite, or the model or guard fails, there is no AI answer. An uncited answer is never shown.
- Answers use the same quiet-coaching tone as rest notes.
- Citations are an id list; the text carries no inline markers.

## Validation

**Test-first.** The tests were committed before the implementation:
- `b8b8c89` ran against a stub of the agreed interface: 61 of 72 failed.
- After an independent review and two product decisions, `84b5198` added 50 more cases: 40 of 122 failed.
- `d90ef4c` added the headache case: 1 of 123 failed.

The implementation then made them pass with the test files unchanged.

Run from `apps/api`, `npx vitest run test/advice.test.ts test/advice-samples-script.test.ts`:

```
 Test Files  2 passed (2)
      Tests  140 passed (140)
```

Full suite, `npx vitest run`:

```
 Test Files  23 passed (23)
      Tests  285 passed (285)
```

On `main` this was 21 files and 145 tests. The two flaky tests there (rest-time "never waits past the 2.5 s cap" and seed "resets instead of duplicating") failed once in a parallel run and passed when rerun alone. They passed in every run on this branch.

`npm run -s typecheck` and `npx eslint .` show no output. `npx prettier --check` on the changed files prints "All matched files use Prettier code style!" Three files on `main` (`scripts/moderation-sample.ts`, `test/conn-compat.test.ts`, `test/social.test.ts`) already fail prettier and aren't touched here.

From the repo root, `node --test specs/*.test.mjs`: 62 pass, 0 fail.

`env -u HF_TOKEN npm run advice:samples` prints "HF_TOKEN is not set: advice:samples needs it to call gpt-oss. Add it to apps/api/.env." and exits 1.

## Not checked

- **Team review of the live answers is still to do.** One live run is in `docs/reviews/advice-2026-10-10.md`: `npm run advice:samples` on the default chain, with a 12 s timeout.
  - **Routing:** 20 of 20 as expected. The 10 answerable questions got answers, the off-topic one was declined, and all 9 pain or acute questions got the fixed reply with no model call.
  - **Guard:** rejected nothing.
  - **Latency:** 0.4 to 1.7 s per answer, and 4.1 s for the decline.
  - **Quality, a first read only:**
    - Several answers are close paraphrases of their sources: push-up progression, shoulder press variations, the back warm-up, and the knee strengthening answer to the diagnosis-bait question.
    - Some add claims the sources don't make. The guard checks numbers, not claims:
      - glutes_lunge: "an upright torso helps keep the focus on the glutes"
      - clicks: "good form often helps with clicking"
      - no_pain_tight: cites the lower-back note for hamstrings
    - The reviewer-notes lines are blank, for the team.
- **One run only.** Answers vary between runs, and how often the guard rejects across many questions is unmeasured.
- **The pain check was probed by hand** beyond the tests, but it's a word-level check, not a classifier.

## Known limits

- **Over-triggering is deliberate.** Some harmless questions get the fixed reply:
  - "my knee clicks and pops but doesn't hurt"
  - "hurt my back two years ago, now fine", because "hurt" is a pain word
  - "Should I pop some before training?"
  - "tear through my workouts"
- **Some vague questions get through:**
  - "my wrist feels weird and weak and I can't grip the bar"
  - "a lump near my belly button after heavy lifting"
  - "since my ACL surgery my knee feels unstable"

  These go to the model. The guard still blocks a diagnosis or prescription, and the sources rarely cover them, so the model is likely to decline.
- **Grounding** compares digits only, so "three sets" isn't checked against the sources.
- **The fixed reply opens with "Pain like this…"** even when the question names an acute sign without the word pain (numbness, "injured my wrist", can't bear weight).
- **The guard is strict, by design.** A rejected answer means no AI comment, never a wrong one.
- **BE-11 must pass the post's title and body together** as `question`, or a red flag in the title is missed.
- **Moderation conflict:** `moderation.ts` says "Advice isn't shown to other members" and skips the threats check for advice. §10.2 has community answers on advice posts. BE-11 should settle which is true.

## Not included

- BE-11: retrieval, query embeddings, embeddings for answered questions, `POST /advice` and the comment insert.
- FE-11 and FE-12: the "AI suggestion" label, sources display and the ask flow.
- A team review of live sample answers (see "Not checked").
