# Session round trip (INT-08)

The path is phone → `POST /sessions/:id/finish` → Volume → Lakeflow → gold tables
→ insight sync → Neon → `GET /me/progress` and `GET /me/insights` → Me screen.
Use a dev branch for real workouts and the demo branch for synthetic accounts.

## Prepare

1. In `apps/api`, configure `DATABASE_URL`, Neon Auth settings, `DATABRICKS_HOST`,
   `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `STEADYFORUM_PSEUDONYM_SECRET`,
   and `DATABRICKS_WAREHOUSE_ID`. Optional `DATABRICKS_VOLUME_PATH` defaults to
   `/Volumes/steadyforum/raw/sessions`; OAuth scopes must allow files and SQL.
2. Run `npm run db:migrate`. DB-07 already creates `progress_daily` and
   `risk_insights` in migration 0001; 0006 adds export attempt counts and leases.
3. Run `databricks/setup.sql` as an administrator and configure its service principal
   and warehouse permissions. Import `databricks/pipelines/steadyforum_sessions/pipeline.json`,
   replacing `<repo-path>` in all three library paths. Default schema is `steadyforum.raw`;
   gold decorators publish explicitly into `steadyforum.gold`.
4. Start the API with `npm run dev`. Set the phone's `EXPO_PUBLIC_API_URL` to that API
   and `EXPO_PUBLIC_NEON_AUTH_URL` to the same branch's auth service. Sign in.

## Finish and process a workout

Finish a workout and keep the session UUID from the API response or logs. The finish
transaction commits before enqueueing: the HTTP response does not wait for Databricks.
Status is `pending → uploading → exported`; exhausted HTTP retries set `failed` and
`export_error`. Joints upload first, metadata last, under the UTC finish date:

- `joints/YYYY-MM-DD/<session-id>.ndjson.gz`
- `meta/YYYY-MM-DD/<session-id>.json`

The current workout UI is manual tracking. Signed-in saves create a session, send each
set with an explicit index, and call finish. Failed saves can be retried while the screen
is open. Guests keep local history. Manual reps carry `manual_unscored`: gold retains
rep counts but returns null range/quality/clean share and excludes them from form risk.
For measured form, submit an AI-08 set record (including rule flags, angles, quality,
and optional joints/rep bounds) to the same sessions endpoints. Pose-engine wiring
into the manual workout UI remains a separate dependency.

In Databricks, open **Jobs & Pipelines**, select `steadyforum_sessions`, and choose **Start**
for a normal update. The pipeline is triggered, not continuous: an operator or a
Databricks schedule must start it. Do not use a full refresh for routine new sessions.
Wait for the update to finish successfully.

The API starts one insight sync immediately and then every **15 minutes**, without
self-overlap. Default progress/risk lookback is **49 days**, enough for the six-week
demo; `SYNC_LOOKBACK_DAYS` overrides it. ROM uses at least 120 days. For a manual sync:

```sh
cd apps/api
npm run session:roundtrip -- sync
```

This command reads `DATABASE_URL`; point it to the intended dev/demo branch. Gold
user IDs must be the HMAC-SHA256 pseudonym of a Neon user, first 32 hex characters,
computed with the same secret. Unknown IDs are skipped and counted in job logs.
Upserts use `(user_id, date, exercise_id)` and `(user_id, body_part, as_of)` keys.

Open Me → Training progress. It reloads on focus, polls every minute while focused,
and has a Refresh progress button. `exercise_daily` contains the synced breakdown;
existing `daily`, `form_trend`, medals and PRs remain available before processing.
The form insights section shows the latest risk row per body part with its disclaimer.

## Retry uploads

Every **10 minutes**, the configured API retries up to 50 finished sessions: `failed`,
`pending` finished more than 15 minutes ago, and `uploading` whose lease is older than
15 minutes. Atomic database claims stop concurrent workers uploading the same session.
There is no lifetime attempt cap; persistent failures stay visible and retryable.
Oldest last attempt goes first so failing sessions do not starve newer sessions.

```sh
cd apps/api
npm run session:roundtrip -- retry
```

Payloads with joints stay in API memory until success (bounded to 500 sessions / 24 hours).
After restart or eviction, retry rebuilds metadata and rep aggregates from Neon and
uploads empty joints. Rep counts/form flags still process; joint-derived ROM cannot be
recovered. The standalone retry command has no access to the running API's joints cache.
Run scheduled sync on one API instance; the in-process timer is not an external scheduler.

## Demo users and six weeks of history

`data/demo-user-ids.json` is the single account manifest consumed by both DB-10 and the
synthetic notebook. Default is 30 users. User counts must be 1–30.

1. Migrate the demo branch, then set `DEMO_DATABASE_URL` and run `npm run db:seed:demo`
   in `apps/api`. The seed resets that branch's per-user data. It never falls back to
   `DATABASE_URL`. Set `STEADYFORUM_PSEUDONYM_SECRET` to populate stored pseudonyms too.
2. To use your signed-in presenter account, set `DEMO_PRESENTER_USER_ID` to its Neon
   Auth subject. This replaces the first manifest user, rather than adding an account.
3. Import `databricks/notebooks/generate_synthetic_sessions.py`. Set widget
   `seed_user_ids_path` to the checked-out repo's `data/demo-user-ids.json` path,
   `users` to the same count, `weeks=6`, and `presenter_user_id` to the same presenter
   override (or leave blank in both). Use the same Volume as the pipeline.
4. Store the API's exact `STEADYFORUM_PSEUDONYM_SECRET` in Databricks secret
   `steadyforum/pseudonym_secret`. Run the notebook, start the pipeline, then run sync with
   `DATABASE_URL` pointing to the demo branch. Notebook sessions are separate synthetic
   sessions from Neon seed history; their IDs are deterministic. Reuse the same configuration
   when rerunning, since changing presenter/secret leaves older Volume files behind.
5. Sign in as the presenter. The Me screen shows the synced per-exercise history spanning
   six weeks. The remaining manifest accounts are application seed rows, not Neon Auth
   sign-in credentials; use a real Auth subject via the presenter override to demonstrate.

## Where to look when data is missing

In Neon, inspect the known session (replace the UUID):

```sql
SELECT id, user_id, finished_at, export_status, export_error,
       export_attempts, export_started_at, exported_at
FROM sessions WHERE id = '<session-uuid>';
```

- No `finished_at`: the phone never completed finish. Check its save error/API logs.
- `pending`: check startup `databricksExport`, configuration, and retry timing.
- `failed`: inspect `export_error` and `[databricks]` / `[exports]` logs; check OAuth,
  Volume grants and host/path. `exported` means file upload completed, not pipeline completion.
- Uploaded but missing in bronze: check the Volume/date/path and pipeline update history.
  Inspect rescued data and schema expectations in the update's data-quality results.

```sql
-- Databricks SQL: uploaded session and resulting reps
SELECT * FROM steadyforum.raw.bronze_sessions WHERE session_id = '<session-uuid>';
SELECT * FROM steadyforum.raw.silver_reps WHERE session_id = '<session-uuid>';
-- Use the pseudonym from bronze, never the raw Neon ID in Databricks.
SELECT * FROM steadyforum.gold.gold_user_progress_daily WHERE user_id = '<pseudonym>';
SELECT * FROM steadyforum.gold.gold_injury_risk_scores WHERE user_id = '<pseudonym>';
```

- Bronze but no silver: inspect rep range/quality/boundary expectations and empty sets.
  Missing joints do not prevent aggregate reps from processing.
- Gold but no Neon row: check `[insights]` failures, warehouse access, missing tables,
  lookback dates, unknown-user count, correct Neon branch, and matching HMAC secrets.
  Confirm the `steadyforum.gold.gold_rom_trend` table exists too; sync reads all three gold tables.
- Neon populated but screen stale: refresh Me; inspect authenticated API responses and
  ensure the phone uses the same API/Auth branch. API responses use snake_case fields.

```sql
-- Neon: raw Auth subject, not the pseudonym
SELECT * FROM progress_daily WHERE user_id = '<neon-user-id>' ORDER BY date;
SELECT * FROM risk_insights WHERE user_id = '<neon-user-id>' ORDER BY as_of;
```

Account deletion is owned by CONN-13; see `account-deletion.md`.
