# Databricks notebook source
# MAGIC %md
# MAGIC # CONN-13: delete deleted accounts from Databricks (Architecture §13)
# MAGIC
# MAGIC `DELETE /me` in the API deletes the user from Neon and writes their **pseudonym** to
# MAGIC `deletion_requests`. This notebook, run daily as the job in `delete_user.job.json`:
# MAGIC
# MAGIC 1. runs the `steadyforum_sessions` pipeline so every uploaded file is in bronze
# MAGIC 2. for each pending request, deletes that pseudonym's uploaded files under the sessions Volume
# MAGIC    (`meta/` and `joints/`), then its rows in the bronze streaming tables
# MAGIC 3. marks the request done in Neon
# MAGIC 4. runs the pipeline again, so the silver and gold materialized views (including
# MAGIC    `gold_training_features`, the training feature table) are rebuilt without the user
# MAGIC
# MAGIC Only data uploaded **before** the request is deleted: a new account made later with the same
# MAGIC login gets the same pseudonym. Re-running is harmless: missing files and rows are skipped.
# MAGIC Files go before rows so a failed run can still find them next time.
# MAGIC
# MAGIC Runbook: `docs/runbooks/account-deletion.md`.

# COMMAND ----------

# MAGIC %pip install "psycopg[binary]>=3.2"

# COMMAND ----------

import time

dbutils.widgets.text("pipeline_id", "325c516b-c907-4b0f-9320-4b0c93f3b51e", "steadyforum_sessions pipeline id")
dbutils.widgets.text("dry_run", "false", "dry run (true/false)")

PIPELINE_ID = dbutils.widgets.get("pipeline_id")
DRY_RUN = dbutils.widgets.get("dry_run").lower() == "true"
BRONZE_SESSIONS = "steadyforum.raw.bronze_sessions"
BRONZE_JOINTS = "steadyforum.raw.bronze_set_joints"

# COMMAND ----------

# MAGIC %md ## Deleting one pseudonym

# COMMAND ----------


def to_volume_path(source_file: str) -> str:
    """Auto Loader records dbfs:/Volumes/...; dbutils.fs.rm wants /Volumes/..."""
    return source_file.removeprefix("dbfs:")


def delete_pseudonym(spark, pseudonym: str, requested_at, rm, dry_run: bool = False) -> dict:
    """Deletes one pseudonym's uploaded files, then its bronze rows. Returns what was removed.

    `rm(path)` deletes one file and returns False if it was already gone.
    """
    args = {"p": pseudonym, "t": requested_at}
    sessions = spark.sql(
        f"SELECT session_id, source_file FROM {BRONZE_SESSIONS} "
        "WHERE user_id = :p AND (finished_at IS NULL OR finished_at <= :t)",
        args=args,
    )
    sessions.createOrReplaceTempView("_deletion_sessions")
    joints_files = spark.sql(
        f"SELECT DISTINCT j.source_file FROM {BRONZE_JOINTS} j "
        "JOIN _deletion_sessions s ON j.session_id = s.session_id"
    )
    files = sorted(
        {to_volume_path(r.source_file) for r in sessions.select("source_file").collect() if r.source_file}
        | {to_volume_path(r.source_file) for r in joints_files.collect() if r.source_file}
    )
    session_count = sessions.count()
    if dry_run:
        return {"sessions": session_count, "files": len(files), "files_removed": 0, "dry_run": True}

    removed = sum(1 for f in files if rm(f))
    # MERGE, not DELETE ... IN (subquery): Delta doesn't allow subqueries in DELETE conditions.
    spark.sql(
        f"MERGE INTO {BRONZE_JOINTS} j USING (SELECT DISTINCT session_id FROM _deletion_sessions) s "
        "ON j.session_id = s.session_id WHEN MATCHED THEN DELETE"
    )
    spark.sql(
        f"DELETE FROM {BRONZE_SESSIONS} WHERE user_id = :p AND (finished_at IS NULL OR finished_at <= :t)",
        args=args,
    )
    left = spark.sql(
        f"SELECT count(*) AS n FROM {BRONZE_SESSIONS} "
        "WHERE user_id = :p AND (finished_at IS NULL OR finished_at <= :t)",
        args=args,
    ).first()["n"]
    if left:
        raise RuntimeError(f"{left} bronze rows remain after delete")
    return {"sessions": session_count, "files": len(files), "files_removed": removed}


def volume_rm(path: str) -> bool:
    try:
        dbutils.fs.rm(path)
        return True
    except Exception as err:  # already deleted (a retry, or a duplicate request)
        if "FileNotFound" in type(err).__name__ or "not found" in str(err).lower() or "does not exist" in str(err).lower():
            return False
        raise


# COMMAND ----------

# MAGIC %md ## Pipeline and Neon

# COMMAND ----------


def run_pipeline(pipeline_id: str, full_refresh: bool = False, timeout_s: int = 3600) -> str:
    """Starts an update (or waits for the running one) and waits until it finishes."""
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient()
    try:
        update_id = w.pipelines.start_update(pipeline_id, full_refresh=full_refresh).update_id
    except Exception as err:  # an update is already running: wait for that one instead
        if "already" not in str(err).lower() and "conflict" not in str(err).lower():
            raise
        update_id = w.pipelines.get(pipeline_id).latest_updates[0].update_id
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        state = str(w.pipelines.get_update(pipeline_id, update_id).update.state)
        if any(s in state for s in ("COMPLETED", "FAILED", "CANCELED")):
            if "COMPLETED" not in state:
                raise RuntimeError(f"pipeline update {update_id} ended {state}")
            return update_id
        time.sleep(20)
    raise TimeoutError(f"pipeline update {update_id} still running after {timeout_s} s")


def neon():
    import psycopg

    return psycopg.connect(dbutils.secrets.get(scope="steadyforum", key="neon_database_url"), autocommit=True)


# COMMAND ----------

# MAGIC %md ## Run

# COMMAND ----------

with neon() as conn:
    pending = conn.execute(
        "SELECT id, pseudonym, requested_at FROM deletion_requests WHERE status = 'pending' ORDER BY requested_at"
    ).fetchall()
print(f"{len(pending)} pending deletion request(s){' (dry run)' if DRY_RUN else ''}")

if pending:
    run_pipeline(PIPELINE_ID)  # ingest anything uploaded but not yet in bronze

    done, failed = 0, 0
    for request_id, pseudonym, requested_at in pending:
        try:
            result = delete_pseudonym(spark, pseudonym, requested_at, volume_rm, dry_run=DRY_RUN)
            print(f"request {request_id}: {result}")  # counts only, never the pseudonym
            if not DRY_RUN:
                with neon() as conn:
                    conn.execute(
                        "UPDATE deletion_requests SET status = 'done', done_at = now(), "
                        "attempts = attempts + 1, last_error = NULL WHERE id = %s",
                        (request_id,),
                    )
            done += 1
        except Exception as err:
            failed += 1
            print(f"request {request_id}: failed with {type(err).__name__}; will retry next run")
            with neon() as conn:
                conn.execute(
                    "UPDATE deletion_requests SET attempts = attempts + 1, last_error = %s WHERE id = %s",
                    (type(err).__name__, request_id),  # error type only, never row data
                )

    if done and not DRY_RUN:
        # The bronze tables use deletion vectors: DELETE hides rows at once, but their bytes stay in
        # data files until the files are rewritten (PURGE) and the old ones vacuumed after Delta's
        # 7-day retention. If PURGE isn't allowed on pipeline tables, the pipeline's own maintenance
        # (OPTIMIZE + VACUUM, within about a day of an update) does the same job.
        for table in (BRONZE_SESSIONS, BRONZE_JOINTS):
            try:
                spark.sql(f"REORG TABLE {table} APPLY (PURGE)")
                print(f"purged deleted rows from {table}'s data files")
            except Exception as err:
                print(f"PURGE not run on {table} ({type(err).__name__}); pipeline maintenance will")
        run_pipeline(PIPELINE_ID)  # rebuild silver and gold without the deleted users
    print(f"done: {done}, failed: {failed}")
    if failed:
        raise RuntimeError(f"{failed} deletion request(s) failed; the job retries them")
