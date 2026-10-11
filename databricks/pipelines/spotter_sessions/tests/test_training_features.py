"""CONN-12: gold_training_features keeps each rep's session provenance (`device`), so the dataset
publisher (ml/space/publish_dataset.py) can release synthetic reps without real people's."""
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FIXTURES = ROOT / "specs/set-record/fixtures/valid"
PUBLISHER = ROOT / "ml/space/publish_dataset.py"


def _write_session(volume: Path, session_id: str, device: str, record: dict) -> None:
    template = json.loads((FIXTURES / "ExportMeta/minimal.json").read_text())
    meta_set = {key: record[key] for key in ("exercise_id", "weight_kg", "end_reason", "partial_reps", "reps")}
    meta_set.update(set_index=0, medal=None, frame_count=len(record["frames"]))
    joints = {"session_id": session_id, "set_index": 0, "exercise_id": record["exercise_id"],
              "fps": record["fps"], "frames": record["frames"]}
    joints_path = volume / "joints/2026-10-10" / f"{session_id}.ndjson.gz"
    joints_path.parent.mkdir(parents=True, exist_ok=True)
    joints_path.write_bytes(gzip.compress((json.dumps(joints) + "\n").encode()))
    meta = dict(template, session_id=session_id, device=device, joints_path=str(joints_path), sets=[meta_set])
    meta_path = volume / "meta/2026-10-10" / f"{session_id}.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta))


def test_training_windows_keep_provenance_and_the_publisher_keeps_only_synthetic(tmp_path, run_pipeline, spark):
    record = json.loads((FIXTURES / "SetRecord/squat_clean.json").read_text())
    _write_session(tmp_path, "synthetic-session", "synthetic", record)
    _write_session(tmp_path, "phone-session", "iPhone 15", record)

    tables = run_pipeline(tmp_path)
    rows = tables["gold_training_features"].select("rep_id", "device").collect()
    assert {r.device for r in rows} == {"synthetic", "iPhone 15"}

    # The publisher's own SELECT, run against this pipeline's output: phone reps never come back.
    query = re.search(r'QUERY = f"""(.*?)"""', PUBLISHER.read_text(), re.S).group(1)
    query = query.replace("{SYNTHETIC_DEVICE}", "synthetic").replace("spotter.gold.gold_training_features", "gold_training_features")
    published = spark.sql(query).collect()
    synthetic_reps = [r for r in rows if r.device == "synthetic"]
    assert len(published) == len(synthetic_reps) > 0
    assert {r.rep_id for r in published} == {r.rep_id for r in synthetic_reps}
