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

| Script                                  | What it does                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Watch mode, reads `.env`                                                                      |
| `npm test`                              | Vitest. Runs the real migrations on in-memory Postgres (PGlite + pgvector), so no Neon needed |
| `npm run typecheck` / `lint` / `format` | tsc (`tsconfig.check.json`), ESLint, Prettier                                                 |
| `npm start`                             | Run the server (through `tsx`, which the CONN files' extensionless imports need)              |
| `npm run db:generate`                   | Diff `drizzle/schema/*` into a new SQL migration                                              |
| `npm run db:migrate`                    | Apply migrations to the branch in `DATABASE_URL`                                              |
| `npm run db:load-specs`                 | Upsert exercise specs into `exercises`                                                        |
| `npm run db:seed:demo`                  | **Wipe** and reseed the branch in `DEMO_DATABASE_URL`                                         |

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
| `GET/POST /me/rehab-plans`, `GET/PUT/DELETE /me/rehab-plans/:id`, `POST /me/rehab-plans/:id/limits`, `PUT/DELETE /me/rehab-plans/:id/limits/:limitId`, `GET /me/rehab-plans/active/today?tz=`, `GET /me/limits` | BE-15        |

## How the CONN pieces are wired

Each one switches on when its env vars are set; without them the API still runs.

| Piece                      | Turns on with                                                                 | What happens                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CONN-02 upload             | `DATABRICKS_HOST`, `_CLIENT_ID`, `_CLIENT_SECRET`, `SPOTTER_PSEUDONYM_SECRET` | Finished sessions upload to the Volume; `sessions.export_status` tracks it                                                         |
| CONN-06 insight sync       | The above plus `DATABRICKS_WAREHOUSE_ID`                                      | Every 15 min, gold tables are upserted into `progress_daily` and `risk_insights` (`/me/insights`). Run it on one API instance only |
| CONN-09 moderation         | `HF_TOKEN`                                                                    | Llama Guard checks posts and comments; blocked content returns 422 with a friendly message                                         |
| CONN-08 RAG ingest         | `HF_TOKEN` (run `npm run rag:ingest` in `rag/`)                               | Writes `doc_chunks`; needs migration `0001` on the branch first                                                                    |
| CONN-05 set scoring        | Not wired yet (BE-07)                                                         | The phone can send `medal`, `clean_share`, `score_source` and per-rep `clean` on each set                                          |
| CONN-08 profile embeddings | Not written yet                                                               | When `profiles.embedding` is set, buddy matching ranks by it automatically                                                         |

`test/conn-compat.test.ts` runs the merged CONN-06/08/09 and AI-05 code against this schema.
