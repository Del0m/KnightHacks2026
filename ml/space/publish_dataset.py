# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "pyarrow", "huggingface_hub"]
# ///
"""CONN-12: publish the labelled rep windows to the Hugging Face Hub as a dataset.

    uv run ml/space/publish_dataset.py --dry-run     # export to ml/space/dataset/ only
    uv run ml/space/publish_dataset.py               # export and push (private until you flip it)

Reads spotter.gold.gold_training_features through the SQL warehouse as the spotter-api service
principal (DATABRICKS_* in apps/api/.env), so it needs only read access to gold. Pushes with
HF_WRITE_TOKEN to SPOTTER_DATASET_REPO (default bubblesmal/spotter-form-reps).

Splits are by lifter (a stable hash of the pseudonym), so no lifter appears in both train and
test. When AI-09's consented recordings exist, they go in as a second config, `recorded`.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.ipc as ipc
import pyarrow.parquet as pq
import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "dataset"
CARD = Path(__file__).resolve().parent / "dataset_card.md"
REPO = os.environ.get("SPOTTER_DATASET_REPO", "bubblesmal/spotter-form-reps")
TEST_SHARE = 0.2

QUERY = """
SELECT
  f.rep_id,
  f.user_id                AS lifter_id,
  CAST(f.session_date AS STRING) AS session_date,
  f.exercise_id,
  f.experience_level,
  f.frame_count,
  f.window,
  f.flags,
  f.label
FROM spotter.gold.gold_training_features f
"""


def load_env() -> None:
    """apps/api/.env into os.environ, without overriding what's already set."""
    path = ROOT / "apps" / "api" / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def databricks_token() -> str:
    host = os.environ["DATABRICKS_HOST"].rstrip("/")
    res = requests.post(
        f"{host}/oidc/v1/token",
        auth=(os.environ["DATABRICKS_CLIENT_ID"], os.environ["DATABRICKS_CLIENT_SECRET"]),
        data={"grant_type": "client_credentials", "scope": os.environ.get("DATABRICKS_OAUTH_SCOPES", "sql")},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["access_token"]


def query_arrow(sql: str) -> pa.Table:
    """Runs a statement with EXTERNAL_LINKS + ARROW_STREAM, since the windows are too big inline."""
    host = os.environ["DATABRICKS_HOST"].rstrip("/")
    headers = {"Authorization": f"Bearer {databricks_token()}"}
    res = requests.post(
        f"{host}/api/2.0/sql/statements",
        headers=headers,
        json={
            "warehouse_id": os.environ["DATABRICKS_WAREHOUSE_ID"],
            "statement": sql,
            "disposition": "EXTERNAL_LINKS",
            "format": "ARROW_STREAM",
            "wait_timeout": "50s",
        },
        timeout=90,
    )
    res.raise_for_status()
    body = res.json()
    while body["status"]["state"] in ("PENDING", "RUNNING"):
        time.sleep(2)
        body = requests.get(f"{host}/api/2.0/sql/statements/{body['statement_id']}", headers=headers, timeout=60).json()
    if body["status"]["state"] != "SUCCEEDED":
        raise SystemExit(f"query failed: {body['status']}")

    statement_id = body["statement_id"]
    tables = []
    for index in range(body["manifest"]["total_chunk_count"]):
        chunk = body["result"] if index == 0 else requests.get(
            f"{host}/api/2.0/sql/statements/{statement_id}/result/chunks/{index}", headers=headers, timeout=60
        ).json()
        for link in chunk.get("external_links", []):
            data = requests.get(link["external_link"], timeout=120).content  # presigned: no auth header
            tables.append(ipc.open_stream(io.BytesIO(data)).read_all())
    return pa.concat_tables(tables)


def split_of(lifter_id: str) -> str:
    bucket = int(hashlib.sha256(lifter_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "test" if bucket < TEST_SHARE else "train"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="export locally, don't push")
    args = parser.parse_args()
    load_env()

    table = query_arrow(QUERY)
    print(f"read {table.num_rows} reps from gold_training_features")
    splits = pa.array([split_of(x) for x in table.column("lifter_id").to_pylist()])
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ("train", "test"):
        part = table.filter(pc.equal(splits, name))
        pq.write_table(part, OUT / f"{name}.parquet")
        labels = part.column("label").value_counts().to_pylist()
        print(f"  {name}: {part.num_rows} reps, {len(set(part.column('lifter_id').to_pylist()))} lifters,",
              ", ".join(f"{l['values']}={l['counts']}" for l in sorted(labels, key=lambda l: -l["counts"])))
    (OUT / "README.md").write_text(CARD.read_text())

    if args.dry_run:
        print(f"dry run: wrote {OUT}")
        return
    from huggingface_hub import HfApi

    token = os.environ.get("HF_WRITE_TOKEN") or os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("set HF_WRITE_TOKEN (write access) in apps/api/.env")
    api = HfApi(token=token)
    api.create_repo(REPO, repo_type="dataset", private=True, exist_ok=True)
    api.upload_folder(repo_id=REPO, repo_type="dataset", folder_path=str(OUT), path_in_repo="data",
                      allow_patterns=["*.parquet"], commit_message="Rep windows from gold_training_features")
    api.upload_file(repo_id=REPO, repo_type="dataset", path_or_fileobj=str(CARD), path_in_repo="README.md",
                    commit_message="Dataset card")
    print(f"pushed https://huggingface.co/datasets/{REPO} (private; make it public in its settings)")


if __name__ == "__main__":
    sys.exit(main())
