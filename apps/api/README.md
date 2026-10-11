# Spotter API

Express + TypeScript on Neon Postgres (Drizzle ORM, `@neondatabase/serverless`). See `Architecture.md` §9.

## Setup

```bash
cd apps/api
npm install
cp .env.example .env   # fill in DATABASE_URL and NEON_AUTH_JWKS_URL from the password manager
npm run db:migrate
npm run db:load-specs  # loads specs/exercises/*.json once AI-05 lands
npm run dev            # http://localhost:3000/health
```

| Script                                  | What it does                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Watch mode, reads `.env`                                                                                                                                               |
| `npm test`                              | Vitest. Runs the real migrations on in-memory Postgres (PGlite + pgvector), so no Neon needed                                                                          |
| `npm run typecheck` / `lint` / `format` | tsc (`tsconfig.check.json`), ESLint, Prettier                                                                                                                          |
| `npm start`                             | Run the server (through `tsx`, which the CONN files' extensionless imports need)                                                                                       |
| `npm run db:generate`                   | Diff `drizzle/schema/*` into a new SQL migration                                                                                                                       |
| `npm run db:migrate`                    | Apply migrations to the branch in `DATABASE_URL`                                                                                                                       |
| `npm run db:load-specs`                 | Upsert exercise specs into `exercises`                                                                                                                                 |
| `npm run db:seed:demo`                  | **Wipe** and reseed the branch in `DEMO_DATABASE_URL`                                                                                                                  |
| `npm run advice:samples`                | AI-13: answer the sample advice questions on gpt-oss (needs `HF_TOKEN`) and write a review to `docs/reviews/advice-<date>.md`. `--only id,id`, `--timeout-ms`, `--out` |

## Migrations on your own Neon branch

Every teammate works on their own branch (`dev-<name>`), so migrations never collide with the demo.

1. In the Neon console, open the `spotter` project, go to **Branches**, and copy the **pooled** connection string of `dev-<name>` into `DATABASE_URL` in `.env`.
2. Change a schema file in `drizzle/schema/`.
3. `npm run db:generate -- --name short_description` writes `drizzle/migrations/NNNN_short_description.sql`. Read it, then commit it with the schema change.
4. `npm run db:migrate` applies it to your branch. It's safe to re-run; applied migrations are tracked in `drizzle.__drizzle_migrations`.
5. `npm test` checks the whole migration chain applies to an empty database.

To start over, reset `dev-<name>` from `main` in the Neon console, then run `npm run db:migrate` again.
Before judging, set `DATABASE_URL` and `DEMO_DATABASE_URL` to `demo` and run `npm run db:migrate && npm run db:seed:demo`.

**Two branches adding a migration at once:** whichever merges second deletes its own migration file, its snapshot and its `_journal.json` entry, rebases, and runs `npm run db:generate` again. Regenerating (not just renaming) matters: Drizzle skips a migration whose timestamp is older than the newest one a database has already applied, so a renamed old migration would silently never run on branches that already have the other one.

`drizzle-kit` doesn't emit `CREATE EXTENSION`. pgvector is enabled at the top of `0000_init.sql`. If a later migration needs another extension, add it by hand the same way.

## Rehab plans (BE-15)

- `GET /me/limits` is the one read the phone needs (AI-16, INT-07). It's versioned (`version: 1`): `body_parts` drive the spec injury overrides, and `limits` holds the active plan's limits keyed by exercise id, exactly as entered.
- A limit's `angle` must be a `joint_angle` in that exercise's spec, and `max_range_deg` is flexion from straight (0-180).
- One active plan per user (enforced in the database). The API never edits limits on its own; only the user does.
- Every rehab route takes `?tz=` (the user's IANA time zone, default UTC). `started`, `review_due` and today's sets use the user's local date, not the server's.
- A plan's limits apply from its `start_on`: before that, `GET /me/limits` returns the plan with `started: false` and empty `limits`, and the Databricks export leaves `rehab_start_on` empty.
- Every response with plan data carries the fixed disclaimer. There's no public read path.

## Planner (AI-12, BE-08)

Code: `src/services/planner.ts` (search, rules plan, gpt-oss draft, safety check), `planHistory.ts` (six weeks of history), `preferences.ts` (likes, dislikes, taste vector). Architecture §10.1 has the why.

- `POST /plans/generate?tz=` makes this week's plan (201) and `GET /plans/current?tz=` returns it (404 before there is one). `tz` decides which Monday starts the week and which days have passed.
- Errors: 409 `rehab_plan_active` while a rehab plan is active; 422 `no_training_days` when none are left this week; 503 `no_exercises` when neither specs nor the library are loaded.
- Each item has `exercise { id, name, tracked }`, `sets`, `reps`, `reason`, `swap_note`, `safety_note`, `sources` (chunk ids and titles) and the user's `rating`. The plan has `source` (`llm` or `rules`), `notes` (physio, volume cap, left-out exercises) and `history` (the six-week summary it used).
- `PUT /me/exercise-preferences/:exerciseId` with `{ "rating": "like" | "dislike" | "neutral" }` works for tracked ids (`squat`) and library ids (`Dumbbell_Lunges`); `neutral` clears it.
- Needs `npm run db:load-specs` for the tracked exercises. `rag:ingest` (CONN-08) adds the library and injury notes; without it plans use the five tracked exercises only. Without `HF_TOKEN` every plan is a rules plan.
- A new spec in `specs/exercises` also needs an entry in `TRACKED` in `planner.ts` (movement pattern, joints it loads, library twin) before the planner uses it.

## Conventions

- JSON is **snake_case** on the wire, matching the shared set record (AI-08) and the Databricks payloads. TypeScript and Drizzle use camelCase; `send()` in `src/http.ts` converts responses.
- Every route except `/health*` and `/exercises*` needs `Authorization: Bearer <Neon Auth token>`. The first call from a new user creates their `users` and `profiles` rows.
- Per-frame joints are accepted on `POST /sessions/:id/sets` but never stored in Neon. They're held in memory until the session finishes, then uploaded to Databricks (CONN-02).

## Endpoints

| Method and path                                                                                                                                                                                                 | Issue        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `GET /health`, `GET /health/ready` (pings Neon)                                                                                                                                                                 | BE-01, BE-14 |
| `GET/PUT /me/profile`, `GET/POST /me/injuries`, `DELETE /me/injuries/:id`                                                                                                                                       | BE-03        |
| `POST /sessions`, `POST /sessions/:id/sets`, `POST /sessions/:id/finish`                                                                                                                                        | BE-04, BE-05 |
| `GET /exercises`, `GET /exercises/:id/spec`                                                                                                                                                                     | BE-06        |
| `GET /feed?cursor=`                                                                                                                                                                                             | BE-09        |
| `POST /posts`, `GET/POST /posts/:id/comments`, `POST/DELETE /posts/:id/kudos`, `POST/DELETE /follows/:userId`                                                                                                   | BE-10        |
| `GET /buddies/suggestions`, `GET /buddies`, `POST /buddies/:id/request`, `POST /buddies/:id/accept`, `POST /buddies/:id/decline`                                                                                | BE-12        |
| `GET /me/progress?days=`, `GET /me/insights`                                                                                                                                                                    | BE-13        |
| `POST /plans/generate?tz=`, `GET /plans/current?tz=`, `GET /me/exercise-preferences`, `PUT /me/exercise-preferences/:exerciseId`                                                                                | BE-08        |
| `GET/POST /me/rehab-plans`, `GET/PUT/DELETE /me/rehab-plans/:id`, `POST /me/rehab-plans/:id/limits`, `PUT/DELETE /me/rehab-plans/:id/limits/:limitId`, `GET /me/rehab-plans/active/today?tz=`, `GET /me/limits` | BE-15        |

## Environment (INT-04)

`src/env.ts` validates every variable once at boot; a missing required one stops the API with a readable list. Each integration takes its config from that validated env. Only `DATABASE_URL` and `NEON_AUTH_JWKS_URL` are required: everything else switches a feature on, and without it that feature uses the fallback below while the API still runs.

| Variable | Powers | Without it |
| --- | --- | --- |
| `DATABASE_URL` | **Required.** Neon (one pool for routes, export status and the insight sync) | API won't start |
| `NEON_AUTH_JWKS_URL` | **Required.** Verifying sign-in tokens (BE-02) | API won't start |
| `NEON_AUTH_ISSUER`, `NEON_AUTH_AUDIENCE` | Extra `iss` / `aud` checks on tokens | Those claims aren't checked |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | Server basics | `development`, `3000`, `info` |
| `CORS_ORIGINS` | Browser calls from the Expo web build | No CORS headers (native apps don't need them) |
| `DATABRICKS_HOST`, `_CLIENT_ID`, `_CLIENT_SECRET` | Service principal for every Databricks call | No uploads, scoring or sync |
| `SPOTTER_PSEUDONYM_SECRET` | Pseudonymous user ids for Databricks (CONN-02, CONN-06, CONN-13). Never rotate it | No uploads or sync; account deletion can't queue the Databricks delete |
| `DATABRICKS_OAUTH_SCOPES` | Scopes requested for the service principal | `all-apis`, which `spotter-api` doesn't have: set `files model-serving sql` |
| `DATABRICKS_VOLUME_PATH` | Where finished sessions upload (CONN-02) | `/Volumes/spotter/raw/sessions` |
| `DATABRICKS_SERVING_ENDPOINT`, `DATABRICKS_SCORE_TIMEOUT_MS` | Set scoring during rest (CONN-05) | The phone's rule score; 1200 ms budget. The endpoint scales to zero, so warm it before a demo |
| `DATABRICKS_WAREHOUSE_ID` | Insight sync reads (CONN-06). The id is in the warehouse URL (`/sql/warehouses/<id>`), not the `?o=` workspace id | No sync |
| `INSIGHT_SYNC_ENABLED` | Starts the 15-minute gold → Neon sync on this instance. Set `true` on **exactly one** deployed instance | Sync doesn't run here |
| `SYNC_LOOKBACK_DAYS` | Days of progress/risk each sync re-reads | 49 |
| `HF_TOKEN` | gpt-oss (rest notes, plans), Llama Guard and the threats/harassment check, bge-small embeddings, cloud pose | Fixed rest notes, rules planner, no moderation (everything allowed), tag-overlap buddy matching |
| `HF_LLM_CHAIN`, `HF_LLM_ATTEMPTS`, `HF_LLM_TIMEOUT_MS` | gpt-oss model:provider chain and budgets | Tested defaults in `llm.ts` |
| `HF_GUARD_MODEL`, `HF_GUARD_PROVIDER`, `HF_GUARD_TIMEOUT_MS` | Llama Guard model, provider and budget | Llama Guard 4 on DeepInfra, 5 s |
| `POSE_ENDPOINT_URL`, `POSE_ENDPOINT_TIMEOUT_MS` | Cloud pose mode, `/pose/stream` (CONN-11) | Cloud mode off; phones use on-device pose |
| `DEMO_DATABASE_URL`, `DEMO_PRESENTER_USER_ID` | Script-only: `npm run db:seed:demo` | Seeding refuses to run |
| `HF_WRITE_TOKEN` | Script-only: publishing models (CONN-10) and the dataset (CONN-12) | Can't publish |

### GET /health

Always 200 with `status: "ok"` for the host's liveness check, plus each integration's state. `live` means configured and its latest real call worked (or none has happened yet), `disabled` means its env isn't set, and `error` means its latest call failed, with a coarse `reason` (`timeout`, `http_403`, `partial`, `unreachable`, …) and times. It never includes env values or raw error messages.

```json
{
  "status": "ok",
  "uptime_s": 42,
  "integrations": {
    "neon": { "status": "live" },
    "databricks_export": { "status": "live", "last_ok_at": "2026-10-11T01:02:03.000Z" },
    "insight_sync": { "status": "error", "reason": "http_403", "last_error_at": "2026-10-11T01:00:00.000Z" },
    "set_scoring": { "status": "error", "reason": "timeout", "last_error_at": "2026-10-11T01:01:00.000Z" },
    "llm": { "status": "live" },
    "moderation": { "status": "live" },
    "embeddings": { "status": "live" },
    "cloud_pose": { "status": "disabled" }
  }
}
```

`GET /health/ready` only checks Neon and returns 503 when it's unreachable.

### Where each piece runs

| Piece | Called from | What happens |
| --- | --- | --- |
| CONN-02 upload | `POST /sessions/:id/finish`, after the response; retried every 10 min | Session uploads to the Volume; `sessions.export_status` tracks it |
| CONN-05 set scoring | `POST /sessions/:id/sets` (INT-05 rest-time result) | Databricks scores the set; on timeout or error, the phone's score |
| CONN-06 insight sync | Boot, then every 15 min, where `INSIGHT_SYNC_ENABLED=true` | Gold tables upserted into `progress_daily`, `risk_insights` and `rom_trend`; a table that can't be read is left as it was |
| CONN-07 LLM | Rest notes (INT-05), planner (AI-12), threats/harassment check | Falls back to the fixed note or the rules planner |
| CONN-08 RAG ingest | `npm run rag:ingest` in `rag/` | Writes `doc_chunks` for the planner and advice |
| CONN-08 profile embeddings | `PUT /me/profile` when goals or bio change; `npm run db:embed-profiles` backfills | Buddy matching ranks by goal similarity |
| CONN-09 moderation | `POST /posts`, `POST /posts/:id/comments` | Blocks with a friendly 422; self-harm returns `details.support`; blocks are logged to `moderation_blocks` |

`test/conn-compat.test.ts` runs the merged CONN-06/08/09 and AI-05 code against this schema.
