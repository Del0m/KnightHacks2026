# FE-12 — Ask for advice

Status: implemented in the iPhone-first Feed flow. Uses BE-11, no new packages or backend changes.

## Behavior

- Feed has an **Ask for advice** glass action. It opens the existing transparent bottom sheet with an exercise/goal/difficulty prompt and a 500-character question field. This intentionally keeps the same composer limit as ordinary posts; BE-11 permits up to 2,000 characters.
- Explicit submission calls authenticated `POST /advice { body }`. A synchronous sending lock prevents duplicate taps. Failures retain the draft. Leaving the screen or changing accounts prevents an old completion from opening a thread in the new screen/account.
- Successful questions immediately open their community comment thread, with any initial reply already visible while comments load. The `ai`, `fixed_pain` and `none` outcomes all open the thread; no suggestion shows “Your question is posted. Community members can answer here.” The fixed pain/professional-help response is displayed verbatim from the backend.
- AI replies say **SteadyForum** and **AI-suggested answer**. Library citations open only valid HTTP(S) links without embedded credentials. Community citations open the referenced question's comments through the authenticated visibility-checked endpoint. Sources without links remain readable citations.
- Advice posts are labeled **Advice question**. The ordinary post title/body composer, local ten-example preview, and existing comments/reps remain unchanged. Ask for advice is absent from the example preview so sample interactions never publish real questions.
- Comment sources and immediate reply sources are checked at the API boundary. Malformed advice responses advise refreshing Feed before trying again rather than suggesting that a possibly saved question certainly failed.

## Verification

Tests cover all three outcomes, explicit submit, draft retention, duplicate tap locking, late completion after unmount/account switch, immediate first reply during a delayed comments load, advice labels, malformed responses/sources, and safe citation schemes. Existing Feed tests continue to cover ordinary posts, comment races, moderation errors, paging, cache removal and preview isolation.

- Targeted Feed suites: 34 tests pass (6 suites).
- Mobile TypeScript: passes.
- Mobile lint: zero errors; nine pre-existing warnings outside Feed.
- Full mobile suite at this stage: 81 suites / 830 tests pass. Integration owner will repeat checks after final FE-09/FE-13 edits.

## Phone check

Open Feed → Ask for advice → submit a normal training question. Confirm the thread opens, the suggestion label/citations appear if BE-11 has configured AI providers, and comments work. Repeat with a pain question to confirm the backend's fixed professional-help reply. Disconnect the Mac and check the same flow through the hosted API in the standalone build. No AI answer is a supported community-only result when retrieval/models are unavailable.

## Constraints

The advice create endpoint has no idempotency key: retrying after a lost HTTP response can duplicate a question already stored by the server. There is no automatic submit retry. Existing drafts stay in the open sheet on failure; they are intentionally discarded on account changes. Community source threads absent from the currently loaded feed display their citation title because there is no single-post read endpoint; access and comments are still checked by BE-11's visibility rules.
