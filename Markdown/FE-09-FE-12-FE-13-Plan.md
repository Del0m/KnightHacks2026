# FE-09, FE-12 and FE-13 implementation plan

**Goal:** Deliver the approved mobile weekly plan, advice and buddy flows, using the permanent Render API and a standalone iPhone Release build.

**Architecture:** Keep existing authenticated request handling, glass components and native sheets. Account-scoped plans are durable per week; social writes require connectivity and keep drafts on failure. Maintain public guest training and distinguish tracked exercises from library items.

**Spec:** User-approved scope and GitHub issues #34, #37, #38; FE-09 retains the day selector above dated exercise lists.

**Constraints:** App first; Expo SDK 57 docs; no new design system, generic AI filler, secrets in tracked files, location below gym granularity, or invented server endpoints. Existing supported movements are curl, squat, shoulder press, push-up and lunge.

## Task 1 — Weekly planning
- [x] Write failing API/cache/date/prescription tests.
- [x] Add Planner API/cache module consuming GET /plans/current?tz and POST /plans/generate?tz.
- [x] Retain weekly selector; show each workout day below with prescription, reasons, source titles/identifiers and swap notes; rest/empty/error/offline/rehab states.
- [x] Integrate selected dated routine with Train/Workout; snapshot started sessions and preserve supported exercise mappings, avoid arbitrary library IDs falling back to curl.
- [x] Verify tests, typecheck, lint and shared workflow compatibility.

## Task 2 — Advice
- [x] Test posting, AI/fixed-pain/no-answer states, citations, duplicate prevention and draft retention.
- [x] Add AskAdvice sheet and authenticated POST /advice client, then open the returned thread through Feed.
- [x] Render AI labels, professional-help replies and source links; preserve existing post editor behavior and limits.
- [x] Verify targeted tests/typecheck.

## Task 3 — Buddies
- [x] Test suggestions, request/accept/decline, retry and account/request races.
- [x] Implement real suggestion/request/accepted lists and matching reasons with existing API routes.
- [x] Persist gym/training preferences through supported profile fields; never display or request home location.
- [x] Verify targeted tests/typecheck.

## Task 4 — Delivery
- [x] Configure private mobile API URL to https://knighthacks2026.onrender.com, preserving auth configuration.
- [x] Run combined mobile checks and integration review; update implementation documentation.
- [x] Build signed Release with embedded JS/models and Render URL; install on the paired phone with Metro stopped.
- [ ] Verify direct launch: iOS blocked the automated attempt because the phone was locked.
- [ ] Physical check: remote API Feed on mobile data, Plan generation, advice outcome/thread, buddy states and camera practice.

## Review focus
Account switching must not expose cached plans or old social results; week boundaries must use local dates; unsupported exercise IDs cannot select curl; regeneration cannot mutate an active workout; permanent API errors must preserve data/drafts rather than pretend success.

## Final combined verification — October 11, 2026

- Mobile: 84 suites / 839 tests pass; TypeScript passes; lint has zero errors and nine existing warnings.
- API: 32 suites / 575 tests pass; TypeScript and affected Buddies lint pass.
- Independent review findings fixed and regression-tested: persist a new workout before its first set, isolate completion indicators by selected plan date, and restore the current exercise’s rep target rather than the first exercise’s target.
- Signed Release built and installed, with embedded app code, both pose models and the permanent Render URL. No server secrets matched pushable files or the JavaScript bundle; private API/mobile envs remain ignored.
- Hosted `/health` reports Neon, language-model, moderation and embeddings live. Databricks/server scoring/cloud pose are disabled there; phone inference and local set feedback are available.
- iPhone was locked at launch; cable-free/cellular acceptance is requested from the owner. Personal Team signature expires October 17, 2026 at 19:36:34 UTC; TestFlight/longer-lived distribution remains a separate setup task.
- Local Buddies mutual-block privacy changes require deployment to Render before that additional server protection is live. No backend deployment is implied by installing the phone build.

Implementation details: `FE-09-Implementation.md`, `FE-12-Implementation.md`, `FE-13-Implementation.md`, `iPhone-Standalone.md`. This work is committed locally on `codex/fe09-fe12-fe13`; no push or new PR was requested.
