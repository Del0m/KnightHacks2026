# Account deletion (CONN-13)

Architecture §13: *"Account deletion cascades in Neon and queues a delete job in Databricks."* This is how that works, how to set it up, and how to check a deletion went through.

## The flow

```
App: Settings → Delete account
  └─ DELETE /me (apps/api/src/routes/me.ts → services/accountDeletion.ts), one transaction:
       1. read users.pseudonym (the HMAC id Databricks knows the user by)
       2. INSERT deletion_requests (pseudonym, requested_at, status = pending)
       3. DELETE users row → ON DELETE CASCADE removes everything else in Neon
  └─ 204, the app signs the user out

Databricks, daily 04:00 UTC (job spotter-delete-users → databricks/notebooks/delete_user.py):
  1. run the spotter_sessions pipeline, so every uploaded file is in bronze
  2. per pending request: delete the uploaded files, then the bronze rows (data uploaded before requested_at only)
  3. mark the request done in Neon
  4. purge deleted rows from the bronze data files, run the pipeline again → silver and gold rebuilt without the user
```

`deletion_requests` exists because the pseudonym can't be recomputed once the user id is gone. It holds only the pseudonym, timestamps, a status, an attempt count and an error *type*.

## What is deleted, and when

| Where | What | When |
|---|---|---|
| **Neon** | `users` and everything that references it: profiles, injuries, sessions → sets → reps → form flags, posts (and comments on them), comments, kudos, follows, blocks, buddy matches, plans → plan items, goals, medals, personal records, progress_daily, risk_insights. Future tables (rehab plans, rom_trend) are covered as long as their user foreign key is `ON DELETE CASCADE`; `test/account-deletion.test.ts` fails if one isn't. | Immediately, in the `DELETE /me` transaction |
| **Volume** `/Volumes/spotter/raw/sessions/{meta,joints}/` | The user's uploaded session files | Next job run (≤ 24 h) |
| **Bronze** `spotter.raw.bronze_sessions`, `bronze_set_joints` | The user's rows | Next job run |
| **Silver and gold** (all materialized views, incl. `spotter.gold.gold_training_features`, the training feature table) | Everything derived from those rows | The pipeline update at the end of the same job run |
| **Neon synced tables** | `progress_daily`, `risk_insights` | Immediately (cascade). The insight sync (CONN-06) can't bring them back: it skips pseudonyms that no longer belong to a user. |

**When the bytes are physically gone.** The bronze tables use Delta deletion vectors, so a `DELETE` hides rows at once but the old data files remain for time travel. The job runs `REORG TABLE … APPLY (PURGE)` to rewrite them; if Databricks refuses that on pipeline-owned tables, the pipeline's automatic maintenance (OPTIMIZE + VACUUM, within about a day of an update) does it. VACUUM then removes the old files once they are older than Delta's default retention of **7 days** (no custom `delta.deletedFileRetentionDuration` is set on these tables). So: invisible within 24 hours, physically removed within about **8 days**.

**Not deleted, on purpose:**

- **Hub datasets (CONN-12)** contain only clips from team members who consented to publishing them (§6.3), never app users' data, so there is nothing to delete there.
- **Trained models** (`spotter.ml.form_quality`, on the Hub) aren't per-user records and can't "unlearn" one person. The next retrain uses the rebuilt `gold_training_features`, which no longer contains the user.
- **MLflow runs** log the training dataset's schema, row count and digest (`mlflow.data.from_pandas` in CONN-04), not its rows.
- **The Neon Auth login** is separate from the app's data. The app signs the user out; deleting the login itself happens in Neon Auth. If a still-valid token calls the API again, it gets a fresh, empty account. Because it has the same pseudonym, the job only deletes Databricks data uploaded *before* the request, so the new account's data is left alone.

## Setup (once)

1. **Migration:** `cd apps/api && npm run db:migrate` on each Neon branch (adds `deletion_requests`, migration `0002`).
2. **Secret with the Neon connection string** (the job reads and updates `deletion_requests`), with the Databricks CLI logged in:
   ```bash
   printf '%s' "$DATABASE_URL" | databricks secrets put-secret spotter neon_database_url
   ```
   Use the `demo` branch's URL for the demo workspace.
3. **Notebook:** Workspace → your folder → Import `databricks/notebooks/delete_user.py` (it imports as the notebook `delete_user`).
4. **Job:** replace `<workspace-folder>` in `databricks/notebooks/delete_user.job.json` and create it: `databricks jobs create --json @delete_user.job.json`.
5. **Dry run first:** run the job once with `dry_run = true` (Run now with different parameters). It counts what it would delete and changes nothing.

## Checking that a deletion worked

You need the user's pseudonym, which is in `deletion_requests` (the Neon user row is gone).

**Neon** (SQL editor on the branch):
```sql
SELECT pseudonym, status, requested_at, done_at, attempts, last_error
FROM deletion_requests ORDER BY requested_at DESC LIMIT 20;
```
`status = done` with a `done_at` means the job handled it.

**Databricks** (SQL editor), replacing `:p`:
```sql
SELECT 'bronze_sessions' AS t, count(*) FROM spotter.raw.bronze_sessions WHERE user_id = :p
UNION ALL SELECT 'silver_reps', count(*) FROM spotter.raw.silver_reps WHERE user_id = :p
UNION ALL SELECT 'gold_user_progress_daily', count(*) FROM spotter.gold.gold_user_progress_daily WHERE user_id = :p
UNION ALL SELECT 'gold_workout_medals', count(*) FROM spotter.gold.gold_workout_medals WHERE user_id = :p
UNION ALL SELECT 'gold_training_features', count(*) FROM spotter.gold.gold_training_features WHERE user_id = :p
UNION ALL SELECT 'gold_injury_risk_scores', count(*) FROM spotter.gold.gold_injury_risk_scores WHERE user_id = :p;
```
All zero after the job's final pipeline update. To find any other table with a `user_id` column (e.g. one added later), list them with:
```sql
SELECT table_schema, table_name FROM spotter.information_schema.columns WHERE column_name = 'user_id';
```

**Job run output** shows, per request, how many sessions and files it removed, never the pseudonym itself.

## When something fails

- A request that fails stays `pending`, with `attempts` and `last_error` (the error type only) updated. The job retries twice within the same run, and the next daily run tries again. Deleting twice is harmless: files and rows that are already gone are skipped.
- `attempts` above 3 means it needs a look: run the notebook by hand with `dry_run = true` and read the output.
- If the pipeline update at the start fails, nothing is deleted and nothing is marked done; fix the pipeline and re-run the job.
