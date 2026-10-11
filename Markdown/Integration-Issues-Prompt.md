Task: create 5–10 GitHub issues in https://github.com/Del0m/KnightHacks2026 that connect the existing issues into one working product, and label them `area: integration`.

Read first, verify every claim below against the repo, ask questions, then wait for approval of the final issue list before creating anything on GitHub.

## Why these issues are needed

The 75 existing issues (DB, BE, FE, AI, CONN and PITCH) each build one piece. They're linked only by their "Depends on" lines. No issue owns the joins between areas, which is where the product breaks:

- **Camera coaching isn't connected.** The phone's workout screen, `apps/mobile/src/app/workout.tsx`, is a manual rep logger. Its own footer says "You record your own reps here. Camera coaching isn't connected." It saves to local storage through `apps/mobile/src/state/Training.tsx`, and nothing calls the API.
- **There's no API.** `apps/api` has no `package.json` and no server. It holds only the CONN integrations from PR #83 (`src/integrations/databricks/{upload,score}.ts`, `src/integrations/huggingface/{llm,moderation}.ts`, `src/jobs/syncInsights.ts`). Each of those says "Stubs until dependencies land" and reads env directly.
- **The set record is defined in three places.**
  - `upload.ts` has a `FinishedSession` stub "mirroring AI-08".
  - `score.ts` has a `ScoreRep` stub.
  - `databricks/pipelines/steadyforum_sessions/bronze.py` has explicit Spark schemas with the comment "Keep them in sync with upload.ts".
  - AI-08 (`apps/mobile/src/engine/setRecord.ts`) and DB-04 (the Neon `sets`, `reps` and `form_flags` tables) will each add a fourth and fifth copy.
- **Identifiers already disagree:**
  - **Exercise ids:** the FE catalogue in `apps/mobile/src/data/workout.ts` uses `'curl' | 'squat' | 'press'`. The specs in `specs/exercises/*.json` use `bicep_curl`, `squat`, `shoulder_press`, `push_up` and `lunge`.
  - **Inference mode:** `upload.ts` types it as `"on_device" | "cloud"`. The phone's `PoseMode` in `apps/mobile/src/pose/mode.ts` is `'coreml' | 'vision' | 'cloud' | 'paused' | 'unavailable'`.
  - **Rep and set ids:** bronze expects `rep_index` and `set_index`, which `upload.ts` adds while serializing. AI-08 must agree with that.
- **The medal is computed in three places with no precedence rule.** `score.ts` has `pickMedal`, which picks a per-set medal during rest. BE-05 computes the workout medal on finish. `gold.py` has `gold_workout_medals`. PR #83 also notes the baseline form model "labels most reps as faults", so live scoring tends toward bronze. Nothing decides how the phone's rule flags (AI-07) and the model's labels (AI-10, CONN-05) combine into "clean".
- **Pseudonyms don't line up.** The Databricks side only knows HMAC pseudonyms. PR #83 notes that the insight sync skips the synthetic demo users, because their `u_…` ids aren't pseudonyms of real Neon users. DB-10's seed and the synthetic-data notebook need matching ids, or the demo progress screen stays empty.
- **The airplane-mode demo has no plan.** Architecture §17 turns on airplane mode mid-set. Nothing says what happens to the set POST while offline.

## Read these first

Read them fully. The issues must cite real paths and sections.

1. **Root `Architecture.md`.** This is the canonical copy; ignore `Markdown/Architecture.md`, which is stale. Read all of it, especially:
   - §3 and §5 (the inference split and fallbacks)
   - §4.1 (pose modes)
   - §6.1 (the engine contract: `rep_counted`, `rep_closed`, `useFormEngine`, missing data, set end)
   - §6.2 (specs and injury overrides)
   - §7 (quiet coaching and the rest-time sequence diagram)
   - §8 (medals)
   - §9.2 and §9.3 (the data model and API surface)
   - §11 (the pipeline and insight sync)
   - §13 (privacy and deletion)
   - §14 (deployment and secrets)
   - §16 (the milestones and the "Integration + bug bash" block)
   - §17 (the demo script)
   - §18 (fallbacks)
2. **`issues/issues.json`.** All 75 issues; read each body and its "Depends on". `issues/create_issues.sh` shows how they were created.
3. **What's live on GitHub:** `gh issue list --repo Del0m/KnightHacks2026 --state all --limit 200`. Note which are closed. CONN-01 to CONN-09 and AI-01 to AI-05 are closed.
4. **PR #83 body:** `gh pr view 83 --repo Del0m/KnightHacks2026`. Its "Needs follow-up before it runs in the app" list is integration work that no issue owns yet.
5. **The PR #83 code:** the files under `apps/api/src/`, `databricks/pipelines/steadyforum_sessions/*.py`, `databricks/setup.sql` and `rag/`. Read the header comment of each file; they list their stubs.
6. **The engine:** `docs/superpowers/specs/2026-10-10-form-engine-design.md` and `apps/mobile/src/engine/` (`types.ts`, `engine.ts`, `useFormEngine.ts`, `recording.ts`, `specs.ts`). AI-06 is in progress on branch `ai-06-form-engine`, and these files may not be on `main` yet. Check with `git status` and `git log`. `recording.ts` defines the recorded-clip format, which an end-to-end test can reuse. `apps/mobile/metro.config.js` adds `../../specs` to `watchFolders`, so specs are bundled into the app.
7. **The pose layer:** `docs/pose/pose-result-contract.md` and `apps/mobile/src/pose/` (`types.ts`, `mode.ts`, `usePoseMode.ts`, `usePoseOutput.ts`).
8. **The FE app:** `apps/mobile/src/app/` (expo-router tabs, `workout.tsx`), `src/screens/*`, `src/state/Training.tsx` and `src/data/workout.ts`. The FE issues say `src/screens/LiveSet/`, while the app actually routes through `src/app/`. The issues need to name the real location.
9. **The spec contract:** `docs/specs/exercise-spec-format.md`, `specs/exercises/*.json`, and `specs/validate.mjs` (`applyOverride` is the reference override merge).

## Draft issues

These are drafts, not final. Verify each one, merge or split where the code says otherwise, and keep the total between 5 and 10. Every issue must name real files, real sections and real issue keys.

**Key and label:**
- **Key:** `INT-NN`.
- **Title:** `[INT-NN] <title>`.
- **Labels:** `area: integration` plus a priority label (`priority: P0`, `P1` or `P2`).

**Body format:** match the existing issues exactly, with these sections:
- `**Area:** integration · **Priority:** P0 · **Suggested owner:** …`
- `## Goal`
- `## Acceptance criteria` (checkboxes)
- `## Depends on` (issue keys; also name the GitHub numbers where they exist)
- `## Where`
- `## Context` (Architecture § refs)
- `## Notes`

The existing issues have a section headed with a tool name. Don't copy that heading; use `## Notes` instead.

These issues should be more extensive than the feature issues, because each one spans areas. Each `## Notes` section should cover:
- what exists today, with paths
- the specific mismatches it resolves
- the decision it needs, if any
- how to verify it end to end

### INT-01 Shared set-record and identifier contract (P0)
One definition of the finished-set payload, shared by:
- the phone (AI-08's `setRecord.ts`)
- the API (`upload.ts` `FinishedSession`, `score.ts` `ScoreRep`, BE-04 request validation)
- Neon (DB-04 columns)
- Databricks (the `bronze.py` schemas)

Acceptance criteria:
- A single source, such as a JSON Schema under `specs/` plus TS types, checked by a `node --test` in the same style as `specs/validate.test.mjs`.
- `schema_version`, `set_index` and `rep_index` are defined once.
- One exercise-id vocabulary: the spec ids. The FE's `curl` and `press` are migrated.
- One `inference_mode` vocabulary. Decide whether `coreml`, `vision` and `cloud` are kept distinct, or collapsed to `on_device` and `cloud`. Keeping them distinct is likely better for analytics.
- One flag shape, `{ rule_id, severity, rep_index }`.
- The `upload.ts` and `score.ts` stubs are swapped for the shared type.
- A contract test fails when `bronze.py` drifts.

Depends on AI-06 (#46) and blocks AI-08 (#48), BE-04 (#15) and DB-04 (#4).

Decision for the user: where the contract lives. The repo has no shared package, and `apps/mobile` has its own pnpm workspace.

### INT-02 Live set on the device: camera → engine → rules → screen (P0)
Replace the manual flow in `apps/mobile/src/app/workout.tsx` with the live path:
- the pose stream (`usePoseOutput`, `usePoseMode`)
- `useFormEngine` (AI-06)
- AI-07 rules and flags
- FE-05's skeleton and rep counter
- FE-06's amber tint

Acceptance criteria:
- Set end is wired: still for 8 s, absent for 8 s, or the Done button (§6.1).
- On set end, the set record is built (AI-08, or a stub) and handed to INT-03.
- Inference pauses during rest (§4, battery).
- Modes `paused` and `unavailable` fall back to today's manual logger, so the logger becomes the fallback rather than being deleted.
- No sound or pop-ups during the set (§7).
- Done means a real curl or squat on an iPhone counts reps and tints a joint for a deliberate fault.

Depends on AI-06, AI-07, AI-08, FE-05 and FE-06. Note the `src/screens/LiveSet` vs `src/app/` routing question.

### INT-03 Mobile API client, auth session and offline set queue (P0)
Add a typed API client in `apps/mobile`:
- a base URL from config per environment (local, dev branch, deployed)
- the Neon Auth token from FE-02 on every call
- `401` handling

The session lifecycle calls `POST /sessions`, `POST /sessions/:id/sets` and `POST /sessions/:id/finish`, using the INT-01 types. Finished sets go into a persistent queue (MMKV is already used by `modeStore.ts`). The queue:
- survives app restarts
- replays in order when the network comes back
- is idempotent through client-generated ids, so a retry never double-saves

`Training.tsx` becomes a cache over server data rather than the source of truth.

Done means the §17 airplane-mode moment works: the set completes offline, the rest card shows the phone's own score, and the set syncs after airplane mode is turned off.

Depends on BE-01 (#12), BE-02 (#13), BE-04 (#15) and FE-02 (#27).

### INT-04 API boot wiring for the CONN integrations (P0)
Work through PR #83's follow-up list:
- add `@databricks/sql`, `@huggingface/inference` and `@neondatabase/serverless` to `apps/api`
- add a Zod env covering every variable in `apps/api/.env.example`, and have each integration read from it
- use one shared Neon client
- call `startInsightSync()` once on boot, on a single instance
- pass `neonExportStatusStore(sql)` to the uploader
- call `moderate()` from BE-10 and BE-11

Acceptance criteria:
- `GET /health` reports each integration's config status without leaking secrets.
- A missing optional integration degrades the app instead of crashing it.

Depends on BE-01 (#12), DB-04 (#4), DB-07 (#7) and DB-08 (#8). Done means the API boots locally against a Neon dev branch with every integration either live or reported as disabled.

### INT-05 Rest-time loop: set → score → rest note → rest card in about 1.5 s (P0)
This covers the §7 sequence diagram end to end:
1. The phone posts the set (INT-03).
2. The API calls `scoreSet()` (CONN-05, with a 1200 ms budget and the phone score as fallback).
3. The API builds the rest note (BE-07 and AI-11, with the banned-phrase guard and fixed `rest_note` fallback).
4. FE-07's rest card shows it, with the set medal.

Decide whether this is one response from `POST /sets` or a follow-up `GET /sets/:id/rest-note`. Write down the latency budget for each hop.

Acceptance criteria:
- A cold Databricks endpoint or slow Hugging Face never blocks the rest timer.
- The note is good news first, with at most one suggestion.
- Each fallback path has a test.

Depends on INT-03, INT-04, CONN-05 (#60, closed), BE-07 (#18), AI-11 (#51) and FE-07 (#32).

### INT-06 One definition of "clean", form score and medal (P0)
Reconcile:
- the rule flags (AI-07)
- the model labels (AI-10 and CONN-05)
- `pickMedal` in `score.ts`
- BE-05's workout medal
- `gold_workout_medals` in `gold.py`

Decide what "clean" means: no rule flags, model label `clean`, or both, and how a disagreement resolves. Also decide which medal the user sees and when: per set during rest, versus the workout medal on finish. Then document it in Architecture §8. Physio limits must count (§1.1: "clean means within what my physio allowed").

Acceptance criteria:
- One shared fixture of reps produces the same medal on the phone, the API and the pipeline.

This needs a user decision before any code. Ask it explicitly. Depends on AI-07, AI-10 (#50), BE-05 (#16) and CONN-03 (#58, closed).

### INT-07 Spec and injury-override delivery to the phone (P1)
Today specs are bundled through Metro `watchFolders`, and BE-06 (#17) plans to serve them from the database. Decide the precedence: bundled first with a version check against `GET /exercises/:id/spec`, or the reverse. Define how a spec update reaches the phone without a rebuild.

The user's injuries (BE-03, #14) must reach AI-07 so `applyOverride` runs on the phone with the same merge as `specs/validate.mjs`. Share one implementation, or add a parity test between the two.

The FE exercise catalogue (`src/data/workout.ts`) should come from the spec ids and the BE-06 list, not a hardcoded array.

Depends on AI-07, BE-03 and BE-06.

### INT-08 Session export and insights round trip (P1)
The flow is:
1. `POST /sessions/:id/finish`
2. CONN-02 upload, with `export_status`
3. Lakeflow pipeline (CONN-03)
4. gold tables
5. `syncInsights` (CONN-06)
6. `progress_daily` and `risk_insights` in Neon (DB-07; `progress_daily` isn't in DB-07's acceptance criteria yet, see the `syncInsights.ts` header)
7. BE-13
8. FE-14

Acceptance criteria:
- One real session recorded on a phone appears on the progress screen.
- The pseudonym mapping works for seeded demo users (DB-10 and the synthetic-data notebook use matching ids).
- Account deletion cascades in Neon and queues the Databricks delete job (§13). No issue owns that job today.

Depends on INT-04, CONN-02/03/06 (closed), DB-07, DB-10 (#10), BE-13 (#24) and FE-14 (#39).

### INT-09 End-to-end replay test on a recorded clip (P0)
Build a harness that replays a recorded clip through:
1. the engine (AI-06)
2. rules (AI-07)
3. the set record (AI-08)
4. the API (local, against a Neon branch or PGlite, as PR #83's tests did)

The clip uses AI-06's `recording.ts` format, recorded with the `PoseDebugScreen` recorder. Databricks and Hugging Face are mocked at the HTTP boundary.

Acceptance criteria:
- Golden outputs: rep count, partials, flags per rep, the stored rows, and the upload payload.
- At least one clean clip and one off-form clip per exercise that has a recording.
- Runs with a single command and in CI, if CI exists. Check whether it does.

This is also the "recorded test clip" that AI-06's own acceptance criteria call for. Depends on INT-01 and INT-04.

### INT-10 Demo environment and judging path (P1)
- **Environment checklist:** every env var and secret per app, and who holds them (§14).
- **Mobile build:** points at the deployed API (BE-14, #25) and the Neon `demo` branch.
- **Warm-up script:** run before judging. It wakes Neon, the Databricks serving endpoint (scale-to-zero can take minutes per `score.ts`), the SQL warehouse and the Hugging Face endpoint, and pre-runs the pipeline (§18).
- **Demo seed:** DB-10's seed is consistent with INT-08's pseudonyms.
- **Run-through:** a full pass of §17 on the demo build, with every fallback in §18 triggered once on purpose.

Depends on BE-14, DB-10 and PITCH-04 (#71). Its output feeds PITCH-04 and PITCH-05.

## Gaps to report, not file as integration issues

Check these, then list them for the user. They're missing feature issues, not integration work, so ask before filing anything:
- The §1.1 recovery features (physio plan, `rehab_plans` and `rehab_limits`, range-of-motion trend, physio report, back-to-gym milestone) have no DB, BE or FE issues. `grep -i rehab issues/issues.json` returns almost nothing.
- The account-deletion Databricks job (§13) has no owner.
- DB-07 doesn't list `progress_daily`, although CONN-06's sync writes to it.

## Questions to ask before creating anything

Ask these in one batch with AskUserQuestion, with a recommended option first on each:
1. **Contract location for INT-01:** a JSON Schema and TS types under `specs/` (recommended, matching AI-05), or a new `packages/contracts` workspace.
2. **INT-06 "clean":** rule flags only, with the model as advisory (recommended for the demo, given the model's bias noted in PR #83); the model only; or both must agree.
3. **Rest loop shape for INT-05:** `POST /sets` returns the score and note together (recommended, one round trip), or a separate `GET /sets/:id/rest-note`.
4. **`issues/issues.json`:** should the new issues also be appended there, so `create_issues.sh` stays the full record? The user wrote that file, so ask first.
5. **Updating existing issues:** should the "Depends on" lines of existing issues (AI-08, BE-04, CONN-02, FE-05, FE-07, PITCH-04) also be edited to point at the new INT issues? Editing other people's issues is visible to the team.
6. **Owners and priorities:** confirm the suggested owner and priority for each INT issue.

## Creating them

Do these steps after the user approves the final list and wording:
1. Create the label once, using the `name|color|description` format from `create_issues.sh`:
   `gh label create "area: integration" --repo Del0m/KnightHacks2026 --color 006b75 --description "Cross-area wiring: shared contracts, end-to-end flows, demo path"`
2. Before each create, check for an existing issue with the same title (the same check `create_issues.sh` does), then run `gh issue create --repo Del0m/KnightHacks2026 --title "[INT-NN] …" --label "area: integration" --label "priority: PN" --body-file <file>`.
3. Write each body to a file in the scratchpad first, so the user can review the exact text.
4. If the user approved it, append the issues to `issues/issues.json` in the same shape: `key`, `title`, `labels` and `body`.
5. At the end, report each created issue's number and URL, and anything skipped.

## Rules for this repo

- **No tool attribution:** no AI tool or assistant names in issue text, commits or files, and no co-author trailers or "generated with" lines.
- **Root `Architecture.md` is canonical.** If an INT decision changes the architecture (INT-01 ids, INT-06 medals), propose the edit to the root file only, and only after the user agrees.
- **Workflow:** ask in batches, state the plan, and wait for approval before doing anything outward-facing. Creating issues and labels is outward-facing.
