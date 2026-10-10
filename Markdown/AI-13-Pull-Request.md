Closes #53.

This adds the advice answer writer in `apps/api/src/services/advice.ts`. BE-11 (#22) hands it a community advice question and the sources it retrieved, and gets back one of three results:
- **An answer:** a short gpt-oss answer, where every sentence is supported by the reputable sources it cites.
- **The fixed reply:** for a question that mentions pain or an acute sign. The model never sees the question.
- **No AI answer:** community answers carry the thread.

The writer never throws and has one time budget for both of its model calls. It follows the AI-11 rest-note writer (`restNote.ts`): a JSON-schema prompt through the CONN-07 client, guards on the output, and a safe fallback.

The answers are only as good as their sources, so this branch also re-sources the injury notes in `rag/notes` (CONN-08):
- Every section now names the NHS, AAOS OrthoInfo, MedlinePlus, ChoosePT, Cleveland Clinic or Harvard Health pages that support it. Each claim was checked against the fetched pages.
- Each note ends with the full warning-sign list from its NHS page.

Branched from `main` at `5b83b0c`, and `main` hasn't moved since. Built in a separate worktree, so the AI-09 labelling checkout was not touched.

## What it produces

| Result | When | BE-11 does |
|---|---|---|
| `{ kind: "ai", text, sources }` | The model answered from allowed sources, the guard passed, and the claim check found every sentence supported | Posts `text` as the `ai_suggested` first comment, with `sources` (title plus URL or post id) shown under "AI suggestion" |
| `{ kind: "fixed_pain", text, signals }` | The question mentions pain or an acute sign (§1.1) | Posts `PAIN_REPLY` instead of an AI answer. `signals` is for logs only. |
| `{ kind: "none", reason }` | `empty_question`, `no_sources`, `llm_unavailable`, `llm_failed`, `not_answerable`, `guard_rejected`, `unsupported_claim` or `verify_failed` | Posts no AI comment |

`PAIN_REPLY` is: "Pain like this is worth having a doctor or physiotherapist look at before training on it. Spotter can't assess injuries, so there's no AI suggestion for this question."

## Changes

- **`advice.ts`.** The full contract is in `docs/superpowers/specs/2026-10-10-advice-answer-design.md`.
  - **Order of checks:**
    1. A blank question gets no answer.
    2. The pain and acute check gives the fixed reply.
    3. The reputable-source filter runs. If no source is left, there's no answer.
    4. If there's no model or no time budget, there's no answer.
    5. gpt-oss answers from up to 6 sources, passed as JSON data and never as instructions.
    6. If the model declines, there's no answer.
    7. The guard runs.
    8. The claim check runs.
  - **Pain rule.** Architecture §1.1 says "Pain mentioned anywhere routes to 'please check with your physio or a doctor'".
    - **Flagged:** any pain word that isn't negated (pain, hurt, ache, headache, twinge, throb…), and acute signs: a pop or tear, swelling, numbness, can't bear weight, a joint that gave way, chest pain or dizziness, a fresh injury, fractures, dislocations, spasms, passing out, dark urine after training, and similar.
    - **Negation:** "doesn't hurt" and "pain-free" don't count, unless the sentence goes on with a contrast ("isn't painful at rest, only when I squat").
    - **Still answered:** soreness, stiffness and tightness, and past or recovering injuries with no pain and no acute sign (back-to-training is what Spotter is for).
  - **Reputable sources.** Library sources reach the model only if their URL is `https:` and the host is on `REPUTABLE_SOURCE_HOSTS`:
    - NHS, NHS inform, NIH, MedlinePlus, CDC and WHO
    - AAOS OrthoInfo (both hosts), ACSM, ChoosePT and CSP
    - Mayo Clinic, Cleveland Clinic, Johns Hopkins and Harvard Health
    - free-exercise-db, for technique only

    Other library sources are dropped before the prompt. Community answers stay citable and are labelled as community.
  - **Guard.** An answer is rejected when it:
    - cites no source, more than 3, or one it wasn't shown
    - states a number no cited source contains
    - fails the §7 tone check
    - diagnoses, guesses a cause or names a condition
    - mentions medication, or promises an outcome
    - permits training through pain
    - uses advice-style commands
    - contains line breaks, links or promotions
  - **Claim check.** A second gpt-oss call gets each sentence and the cited sources' text, and says per sentence whether it's supported. Hedges like "often" or "one option is" are fine. Any added fact, benefit, cause, number or situation means `unsupported_claim`. A failure or a malformed reply means `verify_failed`.
- **`rag/ingest.ts` (CONN-08).** Each note section starts with a `Sources:` line: URLs, or `team guidance`. Chunks carry their own section's URLs and a `team_guidance` flag, and note-level sources are gone. Team-guidance chunks have no URL, so the writer never cites them as if a health body said them; the planner can still use them.
- **`rag/notes/*.md` (CONN-08), re-sourced from an audit of every cited page.**
  - **What the audit found:** only 1 of 10 old sources was A-rated (8 were private clinic or coaching blogs). Several claims were unsupported, and some contradicted reputable guidance: optimistic ankle timelines, "keep load off the legs", and shoulder lines.
  - **Now:**
    - every sourced section cites only pages fetched and checked on 2026-10-10
    - programming tips no such page states are marked as team guidance
    - each note ends with the warning signs its NHS page lists
  - **Two independent passes:** a second subagent, which didn't write the notes, re-checked every claim, and its fixes were applied.
  - **Review status:** all five notes are `reviewed: false`.
- **`specs/validate.mjs`.** The shared tone check now reads Unicode hyphens (U+2010, U+2011) as hyphens. A live answer starting "Push‑ups…" was being rejected as the command "push", and rest notes had the same bug.
- **`scripts/advice-samples.ts` (`npm run advice:samples`).** It runs the 20 sample questions on the real chain and writes `docs/reviews/advice-<date>.md`, including a "Reviewer notes" line per question.
- **`test/fixtures/advice-samples.json`.** 20 questions, with sources generated from the rewritten notes (`parseNote`/`noteChunks`) and the real free-exercise-db entries at the pinned commit (`exerciseChunk`).
- **Docs.** Root `Architecture.md` §10.1 (sources) and §10.2 (the writer, the pain rule, the allow-list, the guard and the claim check), plus the design note.

### Decisions taken

- AI-13 is the answer module. BE-11 owns retrieval, `POST /advice`, moderation and storage.
- The pain rule follows §1.1. Past or recovering injuries without pain get an answer.
- Every failure means no AI answer, never an uncited or unchecked one.
- Answers use the rest-note tone.
- Citations are an id list.
- Claims are checked by a second model call that fails closed.
- Sources are A-rated only: Human Kinetics, a B-rated publisher, isn't allowed. Sources are attached per section, and unsourced content is labelled as team guidance rather than removed.

## Validation

**Test-first.** Each change started from committed failing tests:

| Commit | Tests failing before the implementation |
|---|---|
| `b8b8c89` | 61 of 72 |
| `84b5198` | 40 of 122 |
| `d90ef4c` | 1 of 123 |
| `a5614e0` | 22 of 146 |
| `231b072` | 18 of 165 |
| `8968c38` | 1 advice test and 1 spec test |

The implementations made them pass without changing the tests.

Run from `apps/api`, `npx vitest run`:

```
 Test Files  24 passed (24)
      Tests  333 passed (333)
```

On `main` this was 21 files and 145 tests. The two flaky tests there (rest-time "2.5 s cap" and seed "resets") failed once in a parallel run, then passed alone and in every run on this branch.

`npm run -s typecheck` and `npx eslint .` show no output. `npx prettier --check` on the changed files is clean. Three files on `main` already fail prettier and aren't touched here.

From the repo root, `node --test specs/*.test.mjs`: 63 pass, 0 fail.

**Live runs** on the default gpt-oss chain, with the token from a local `.env`:

| Run | Matched | What happened |
|---|---|---|
| Before the claim check | 20 of 20 | Several answers added claims their sources don't make ("an upright torso focuses the glutes", "good form helps with clicking"). |
| Claim check plus new sources | 18 of 20 | It caught that glutes claim. One answer was wrongly rejected by the hyphen bug (now fixed). |
| Final (`docs/reviews/advice-2026-10-10.md`) | 19 of 20 | The one miss is a justified `unsupported_claim`: "an incline push-up reduces the load", which free-exercise-db doesn't say. |

In the final run:
- **Routing:** the off-topic question was declined, and all 9 pain or acute questions got the fixed reply with no model call.
- **Latency:** 0.7 to 1.9 s for answers with both model calls, with one outlier at 5.4 s.
- **Grounding:** every answer sentence traces to its source, numbers included (6 to 10 inches, the first six weeks, 10 to 30 seconds).

## Not checked

- **Medical review of the five notes.** They're `reviewed: false`, and ingest skips them until someone sets them back. Until then, re-ingesting removes the injury notes from the live library.
  - **Ankle weight bearing:** the NHS says to keep weight off for 2 to 3 days, and AAOS says early weight bearing. The note follows the NHS for the first days, then weight bearing as tolerated.
  - **Shoulder and knee emergency signs:** these come from the generic NHS sprains page, because those NHS pages have no emergency list.
  - **Lower back:** the wording of the sexual-function warning sign.
  - **Team-guidance sections:** whether they're sound.
- **Team review of the live answers:** the reviewer-notes lines in `docs/reviews/advice-2026-10-10.md` are blank.
- **Re-ingest into Neon:** not run, because it writes to the database. After review, run `npm run rag:ingest` in `rag/`.
- **Variability:** one live run per stage. Answers vary between runs, and the long-run rejection rate is unmeasured.

## Known limits

- **Over-triggering is deliberate.** Some harmless questions get the fixed reply:
  - "my knee clicks and pops but doesn't hurt"
  - "hurt my back two years ago, now fine", because "hurt" is a pain word
  - "Should I pop some before training?"
- **Some vague questions reach the model**, such as "my wrist feels weird and weak" and "a lump near my belly button after lifting". The guard and the claim check still block a diagnosis or an unsupported claim.
- **The claim check is a model judging a model.** It's strict, and a rejection means no answer, but it isn't proof.
- **Grounding of number words:** written-out numbers ("three sets") rely on the claim check, not the digit check.
- **Single-URL sources:** a section can cite several pages, but `AdviceSource` carries one URL (the first), so an answer shows one link per section.
- **Fixed-reply wording:** it opens with "Pain like this…" even for numbness or "injured my wrist" questions that don't say "pain".
- **Stiff phrasing:** neutral framing makes some answers read a little stiffly ("is described as…").
- **BE-11 must pass the post's title and body together** as `question`.
- **Moderation conflict:** `moderation.ts` says "Advice isn't shown to other members", but §10.2 has community answers on advice posts. BE-11 should settle it.

## Also on this branch

- `rag/ingest.ts` and `rag/notes/*.md` belong to CONN-08. They changed here because answers cite them.
- The `specs/validate.mjs` hyphen fix also applies to AI-11 rest notes.

## Not included

- BE-11: retrieval, query embeddings, answered-question embeddings, `POST /advice` and the comment insert.
- FE-11 and FE-12: the "AI suggestion" label, the sources display and the ask flow.
- The medical review, the team review of the answers, and the re-ingest (see "Not checked").
