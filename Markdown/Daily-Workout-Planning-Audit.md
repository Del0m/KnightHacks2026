# Daily workout planning readiness — October 10, 2026

Reviewed all 102 open and closed issue records (52 open, 50 closed), planning-related acceptance criteria and dependencies, PR #120, current main's planner/API/schema/tests, and the local mobile planning and workout code. Issue state is an inventory, not proof of deployment or acceptance completion. No live generation request, production migration, or credential inspection was performed. Main was inspected remotely; the current feature branch was not pulled or modified.

## Finding

The backend needed to generate different workouts for scheduled days has landed on main in [PR #120](https://github.com/Del0m/KnightHacks2026/pull/120). AI-12 is closed. BE-08 remains open in the fetched issue inventory despite its implementation merging in the same PR. FE-09 remains open and is the main app delivery task.

The planner emits dated days containing ordered exercises, sets/reps, reasons, injury swap notes, source references and tracked/untracked status. It reads goals, level, weekly/interval schedules, structured injuries, six weeks of workout history and exercise preferences. It prefers variation when alternatives exist and has a rule-based fallback if the LLM fails. It is not a guarantee of entirely different exercises every day; the fallback penalizes repeated use rather than prohibiting it. With only the five tracked exercises, lower/push exercises have alternatives but bicep curl is the only tracked pull candidate.

## Dependency audit

| Capability | Issue | Evidence / readiness |
|---|---|---|
| Profile, schedule and injury storage | DB-03 #3, BE-03 #14, FE-03 #28 — closed | Implemented locally. Onboarding saves goals, level, PBs and weekly/interval schedule. Free-text injuries are saved with body part `other`. |
| Plan and item persistence | DB-05 #5 — closed | Main now also includes migration `0009_ai12_planner`, reasons, preferences and taste vectors. Migration application on the live DB remains unverified. |
| Exercise library / camera specs | BE-06 #17, AI-05 #45 — closed | Five camera-tracked movements exist. Library entries may lack specs. |
| Retrieval and ingestion | DB-08 #8, CONN-07 #62, CONN-08 #63 — closed | Retrieval/generation clients and ingestion code exist. Live library ingestion and provider availability remain unverified. |
| Plan generation | AI-12 #52 — closed; BE-08 #19 — open | PR #120 merged both. Routes registered on main: POST `/plans/generate?tz=`, GET `/plans/current?tz=`. |
| Weekly plan UI | FE-09 #34 — open | Local Planner shows schedule and a sample routine; no generated-plan API use. |
| Exercise identifiers | INT-12 #110 — open | UI aliases `curl` / `press`; spec IDs `bicep_curl` / `shoulder_press`. Unknown IDs currently fall back to curl. This must not happen for library plan items. |
| Plan-to-workout execution | INT-02 #86, FE-18 #111 — open | Camera workout exists locally, but routine comes from fixed `data/workout.ts`, not dated plan items. Selecting an existing routine exercise rotates the full sample routine. |
| Injury/physio limits on phone | INT-07 #91, AI-16 #101 — open | Planner filters structured injuries and notes adaptations; phone must receive/apply effective limits. Rehab backend BE-15 #96 is closed; rehab UI FE-16 #99 remains open. |
| Workout history for progression | BE-04 #15, BE-05 #16, INT-06 #90 — closed; INT-03 #87 — open | Local queue/history/upload code exists. Server planner can use synced history; unsynced phone workouts will not yet influence it. |
| Deployment and live readiness | BE-14 #25, INT-04 #88, INT-10 #94 — open | New API/migration, specs and library need deployment/configuration and a signed-in device check. Issue states alone do not verify live readiness. |

## Remaining app work

1. Integrate main's planner changes and check the API deployment/migration. PR #120's rollout requires migration, loading the five specs, and RAG ingestion for broader choices; it notes that PR #114's migration ordering needs attention.
2. Implement FE-09: fetch/generate the week using the user's IANA time zone, switch dates, show rest days, reasons/sources and swap notes. Cache per account and week for offline viewing. Handle missing plans, active rehab plans, no remaining training days and unavailable exercises.
3. Use the same dated plan in Train and Workout; preserve item order, sets and reps. Snapshot a started workout so plan regeneration cannot alter a session mid-set. Preserve planned/completed state when returning to Train.
4. Resolve IDs and distinguish tracked from untracked exercise execution. The local set API accepts lowercase spec-shaped IDs, while library IDs such as `Dumbbell_Lunges` do not fit that validator. Agree on a library logging contract rather than sending these to the curl fallback. Only the five tracked movements currently have model animations and camera specs.
5. Add structured injury body-part input alongside the optional note so the existing filters can operate. Apply effective injury/physio limits in camera sessions (INT-07 / AI-16). The backend refuses gym-plan generation while a rehab plan is active.
6. Keep Train and Plan usable for guests: the generation routes require authentication, so retain a clearly identified local routine or provide a deliberate guest planning path.
7. Add available-equipment preferences if plans must reflect what the user can actually access. The current planner knows candidate equipment but does not filter by a user's equipment inventory. PBs are saved but current plan prescriptions use level and recent history, and do not recommend weights.

## Verification limits

Read the 16 planner tests and the merged PR's reported checks. They cover schedule conversion, injuries, progression, volume caps, preferences, library retrieval, LLM checks/fallback, regeneration and error cases. I did not rerun main's suite or test live HF/Neon in this audit. No claim is made that every closed issue is fully verified or that every open issue is unimplemented; several local features are still awaiting merge/status updates.

## Complete issue inventory

GitHub state at audit time. All issue bodies were scanned; unrelated social, ML-training and presentation tasks are not dependencies of initial daily planning.

| Issue | State | Task |
|---|---|---|
| [#1](https://github.com/Del0m/KnightHacks2026/issues/1) | open | [DB-01] Create Neon project with main, dev and demo branches |
| [#2](https://github.com/Del0m/KnightHacks2026/issues/2) | closed | [DB-02] Set up Drizzle ORM and migration workflow |
| [#3](https://github.com/Del0m/KnightHacks2026/issues/3) | closed | [DB-03] Schema: users, profiles and injuries |
| [#4](https://github.com/Del0m/KnightHacks2026/issues/4) | closed | [DB-04] Schema: sessions, sets, reps, form flags |
| [#5](https://github.com/Del0m/KnightHacks2026/issues/5) | closed | [DB-05] Schema: exercises and workout plans |
| [#6](https://github.com/Del0m/KnightHacks2026/issues/6) | closed | [DB-06] Schema: social graph (posts, comments, kudos, follows) |
| [#7](https://github.com/Del0m/KnightHacks2026/issues/7) | closed | [DB-07] Schema: progress (PRs, goals, medals, risk insights) |
| [#8](https://github.com/Del0m/KnightHacks2026/issues/8) | closed | [DB-08] Enable pgvector and create doc_chunk table |
| [#9](https://github.com/Del0m/KnightHacks2026/issues/9) | closed | [DB-09] Profile embeddings and buddy_match table |
| [#10](https://github.com/Del0m/KnightHacks2026/issues/10) | closed | [DB-10] Seed script for the demo branch |
| [#11](https://github.com/Del0m/KnightHacks2026/issues/11) | open | [DB-11] Row-level security for read-only progress views |
| [#12](https://github.com/Del0m/KnightHacks2026/issues/12) | closed | [BE-01] Scaffold Express + TypeScript API |
| [#13](https://github.com/Del0m/KnightHacks2026/issues/13) | closed | [BE-02] Neon Auth JWT middleware |
| [#14](https://github.com/Del0m/KnightHacks2026/issues/14) | closed | [BE-03] Profile and injury endpoints |
| [#15](https://github.com/Del0m/KnightHacks2026/issues/15) | closed | [BE-04] Session lifecycle endpoints |
| [#16](https://github.com/Del0m/KnightHacks2026/issues/16) | closed | [BE-05] Medal and PR computation |
| [#17](https://github.com/Del0m/KnightHacks2026/issues/17) | closed | [BE-06] Exercise library and spec endpoints |
| [#18](https://github.com/Del0m/KnightHacks2026/issues/18) | open | [BE-07] Rest-note endpoint |
| [#19](https://github.com/Del0m/KnightHacks2026/issues/19) | open | [BE-08] Plan generation endpoints |
| [#20](https://github.com/Del0m/KnightHacks2026/issues/20) | closed | [BE-09] Feed endpoint with keyset pagination |
| [#21](https://github.com/Del0m/KnightHacks2026/issues/21) | closed | [BE-10] Posts, comments, kudos and follows |
| [#22](https://github.com/Del0m/KnightHacks2026/issues/22) | open | [BE-11] Advice questions with AI first answer |
| [#23](https://github.com/Del0m/KnightHacks2026/issues/23) | closed | [BE-12] Buddy matching endpoints |
| [#24](https://github.com/Del0m/KnightHacks2026/issues/24) | closed | [BE-13] Progress and insights endpoints |
| [#25](https://github.com/Del0m/KnightHacks2026/issues/25) | open | [BE-14] Deploy the API |
| [#26](https://github.com/Del0m/KnightHacks2026/issues/26) | closed | [FE-01] Scaffold Expo app with dev build and navigation |
| [#27](https://github.com/Del0m/KnightHacks2026/issues/27) | closed | [FE-02] Sign up and login with Neon Auth |
| [#28](https://github.com/Del0m/KnightHacks2026/issues/28) | closed | [FE-03] Onboarding: goals, level, schedule, injuries |
| [#29](https://github.com/Del0m/KnightHacks2026/issues/29) | closed | [FE-04] Camera framing guide |
| [#30](https://github.com/Del0m/KnightHacks2026/issues/30) | open | [FE-05] Live set screen: skeleton overlay and rep counter |
| [#31](https://github.com/Del0m/KnightHacks2026/issues/31) | open | [FE-06] Amber joint tint for form drift |
| [#32](https://github.com/Del0m/KnightHacks2026/issues/32) | open | [FE-07] Rest timer with rest-note card |
| [#33](https://github.com/Del0m/KnightHacks2026/issues/33) | open | [FE-08] Workout summary and medal screen |
| [#34](https://github.com/Del0m/KnightHacks2026/issues/34) | open | [FE-09] Weekly plan screen |
| [#35](https://github.com/Del0m/KnightHacks2026/issues/35) | open | [FE-10] Feed screen |
| [#36](https://github.com/Del0m/KnightHacks2026/issues/36) | open | [FE-11] Post detail, comments and kudos |
| [#37](https://github.com/Del0m/KnightHacks2026/issues/37) | open | [FE-12] Ask for advice flow |
| [#38](https://github.com/Del0m/KnightHacks2026/issues/38) | open | [FE-13] Gym buddies screen |
| [#39](https://github.com/Del0m/KnightHacks2026/issues/39) | open | [FE-14] Progress and insights screen |
| [#40](https://github.com/Del0m/KnightHacks2026/issues/40) | open | [FE-15] Cloud-mode consent and settings |
| [#41](https://github.com/Del0m/KnightHacks2026/issues/41) | closed | [AI-01] Export YOLOv8n-pose to Core ML and benchmark on iPhone |
| [#42](https://github.com/Del0m/KnightHacks2026/issues/42) | closed | [AI-02] Vision Camera frame-processor plugin for pose |
| [#43](https://github.com/Del0m/KnightHacks2026/issues/43) | closed | [AI-03] Basic-mode option with Apple Vision (Android uses cloud) |
| [#44](https://github.com/Del0m/KnightHacks2026/issues/44) | closed | [AI-04] On-device benchmark and mode selection |
| [#45](https://github.com/Del0m/KnightHacks2026/issues/45) | closed | [AI-05] Exercise JSON specs for the 5 MVP exercises |
| [#46](https://github.com/Del0m/KnightHacks2026/issues/46) | closed | [AI-06] Form engine: smoothing, angles and rep state machine |
| [#47](https://github.com/Del0m/KnightHacks2026/issues/47) | closed | [AI-07] Form rules evaluation and silent flags |
| [#48](https://github.com/Del0m/KnightHacks2026/issues/48) | open | [AI-08] Set record payload |
| [#49](https://github.com/Del0m/KnightHacks2026/issues/49) | open | [AI-09] Record and label form clips |
| [#50](https://github.com/Del0m/KnightHacks2026/issues/50) | open | [AI-10] Train the form-quality model |
| [#51](https://github.com/Del0m/KnightHacks2026/issues/51) | closed | [AI-11] Rest-note prompt and banned-phrase guard |
| [#52](https://github.com/Del0m/KnightHacks2026/issues/52) | closed | [AI-12] RAG planner: retrieval, generation and safety rules |
| [#53](https://github.com/Del0m/KnightHacks2026/issues/53) | open | [AI-13] Advice answer prompt |
| [#54](https://github.com/Del0m/KnightHacks2026/issues/54) | open | [AI-14] Injury-risk model |
| [#55](https://github.com/Del0m/KnightHacks2026/issues/55) | open | [AI-15] Optional YOLOv8n-pose fine-tune on gym footage |
| [#56](https://github.com/Del0m/KnightHacks2026/issues/56) | closed | [CONN-01] Databricks workspace, catalog and Volume |
| [#57](https://github.com/Del0m/KnightHacks2026/issues/57) | closed | [CONN-02] Upload finished sessions to the Databricks Volume |
| [#58](https://github.com/Del0m/KnightHacks2026/issues/58) | closed | [CONN-03] Lakeflow pipeline: bronze, silver, gold |
| [#59](https://github.com/Del0m/KnightHacks2026/issues/59) | closed | [CONN-04] MLflow tracking and registry for the form model |
| [#60](https://github.com/Del0m/KnightHacks2026/issues/60) | closed | [CONN-05] Model Serving endpoint for set scoring |
| [#61](https://github.com/Del0m/KnightHacks2026/issues/61) | closed | [CONN-06] Sync gold tables into Neon |
| [#62](https://github.com/Del0m/KnightHacks2026/issues/62) | closed | [CONN-07] Hugging Face Inference Providers client |
| [#63](https://github.com/Del0m/KnightHacks2026/issues/63) | closed | [CONN-08] Embeddings client and RAG ingest |
| [#64](https://github.com/Del0m/KnightHacks2026/issues/64) | closed | [CONN-09] Llama Guard moderation |
| [#65](https://github.com/Del0m/KnightHacks2026/issues/65) | closed | [CONN-10] Publish models to the Hugging Face Hub and app update check |
| [#66](https://github.com/Del0m/KnightHacks2026/issues/66) | closed | [CONN-11] HF Inference Endpoint for cloud mode |
| [#67](https://github.com/Del0m/KnightHacks2026/issues/67) | open | [CONN-12] Publish our dataset and Gradio Space |
| [#68](https://github.com/Del0m/KnightHacks2026/issues/68) | open | [PITCH-01] Pitch deck outline and story |
| [#69](https://github.com/Del0m/KnightHacks2026/issues/69) | open | [PITCH-02] Architecture slide |
| [#70](https://github.com/Del0m/KnightHacks2026/issues/70) | open | [PITCH-03] Per-challenge slides (HF, Databricks, Neon, Best AI) |
| [#71](https://github.com/Del0m/KnightHacks2026/issues/71) | open | [PITCH-04] Demo script and rehearsal |
| [#72](https://github.com/Del0m/KnightHacks2026/issues/72) | open | [PITCH-05] Backup demo video |
| [#73](https://github.com/Del0m/KnightHacks2026/issues/73) | open | [PITCH-06] Screenshots and visuals |
| [#74](https://github.com/Del0m/KnightHacks2026/issues/74) | open | [PITCH-07] Devpost write-up |
| [#75](https://github.com/Del0m/KnightHacks2026/issues/75) | open | [PITCH-08] Judge Q&A prep |
| [#85](https://github.com/Del0m/KnightHacks2026/issues/85) | open | [INT-01] Shared set-record and identifier contract |
| [#86](https://github.com/Del0m/KnightHacks2026/issues/86) | open | [INT-02] Live set on the device: camera, engine, rules and screen |
| [#87](https://github.com/Del0m/KnightHacks2026/issues/87) | open | [INT-03] Mobile API client, auth session and offline set queue |
| [#88](https://github.com/Del0m/KnightHacks2026/issues/88) | open | [INT-04] API boot wiring for the Databricks and Hugging Face integrations |
| [#89](https://github.com/Del0m/KnightHacks2026/issues/89) | closed | [INT-05] Rest-time loop: set, score, rest note and rest card in about 1.5 s |
| [#90](https://github.com/Del0m/KnightHacks2026/issues/90) | closed | [INT-06] One definition of clean rep, form score and medal |
| [#91](https://github.com/Del0m/KnightHacks2026/issues/91) | open | [INT-07] Spec, injury override and physio limit delivery to the phone |
| [#92](https://github.com/Del0m/KnightHacks2026/issues/92) | closed | [INT-08] Session export and insights round trip |
| [#93](https://github.com/Del0m/KnightHacks2026/issues/93) | open | [INT-09] End-to-end replay test on recorded clips, plus CI |
| [#94](https://github.com/Del0m/KnightHacks2026/issues/94) | open | [INT-10] Demo environment, warm-up and judging run-through |
| [#95](https://github.com/Del0m/KnightHacks2026/issues/95) | closed | [DB-12] Schema: rehab plans, physio limits and range-of-motion trend |
| [#96](https://github.com/Del0m/KnightHacks2026/issues/96) | closed | [BE-15] Rehab plan and effective limits endpoints |
| [#97](https://github.com/Del0m/KnightHacks2026/issues/97) | open | [BE-16] Range-of-motion trend and physio report endpoints |
| [#98](https://github.com/Del0m/KnightHacks2026/issues/98) | open | [BE-17] Back-to-gym milestone |
| [#99](https://github.com/Del0m/KnightHacks2026/issues/99) | open | [FE-16] Physio plan entry and today's rehab session |
| [#100](https://github.com/Del0m/KnightHacks2026/issues/100) | open | [FE-17] Range-of-motion chart, physio report sharing and milestone card |
| [#101](https://github.com/Del0m/KnightHacks2026/issues/101) | open | [AI-16] Physio limits in the form engine |
| [#102](https://github.com/Del0m/KnightHacks2026/issues/102) | closed | [CONN-13] Account deletion: Neon cascade and Databricks delete job |
| [#103](https://github.com/Del0m/KnightHacks2026/issues/103) | closed | [CONN-14] gold_rom_trend pipeline table and Neon sync |
| [#108](https://github.com/Del0m/KnightHacks2026/issues/108) | open | [AI-17] Cloud pose client on the phone |
| [#109](https://github.com/Del0m/KnightHacks2026/issues/109) | open | [INT-11] Workout screen turns on the camera in YOLOv8 or cloud mode |
| [#110](https://github.com/Del0m/KnightHacks2026/issues/110) | open | [INT-12] One exercise ID across app data and specs |
| [#111](https://github.com/Del0m/KnightHacks2026/issues/111) | open | [FE-18] Start a camera set from the exercise tapped on Train |
| [#115](https://github.com/Del0m/KnightHacks2026/issues/115) | open | Prevent unjudged reps from qualifying as clean for medals |
| [#116](https://github.com/Del0m/KnightHacks2026/issues/116) | open | Support intentional holds without automatic mid-rep set completion |
| [#117](https://github.com/Del0m/KnightHacks2026/issues/117) | open | Define safe range-rule merging for multiple injuries and physio limits |
| [#118](https://github.com/Del0m/KnightHacks2026/issues/118) | open | Define counter timing across transient pose jump rejections |
