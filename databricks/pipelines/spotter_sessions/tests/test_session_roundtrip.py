"""INT-08: shared demo IDs and unscored phone records survive the real pipeline."""
import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def test_demo_sessions_reach_bronze_silver_and_gold(tmp_path, run_pipeline):
    ns = {"__name__": "synthetic_roundtrip"}
    source = (ROOT / "databricks/notebooks/generate_synthetic_sessions.py").read_text()
    exec(compile(source.split('dbutils.widgets.text(')[0], "synthetic.py", "exec"), ns)
    user_ids = ns["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 1, "presenter")
    secret = "test-roundtrip-secret"
    rows = list(ns["generate"](user_ids, 6, secret, {}, datetime(2026, 10, 10, 12, tzinfo=timezone.utc)))
    ns["write_sessions"](rows, str(tmp_path))
    tables = run_pipeline(tmp_path)
    assert tables["bronze_sessions"].count() == len(rows)
    expected_reps = sum(len(s["reps"]) for r in rows for s in r[2]["sets"])
    assert tables["silver_reps"].count() == expected_reps
    progress = tables["gold_user_progress_daily"].collect()
    expected_id = hmac.new(secret.encode(), b"presenter", hashlib.sha256).hexdigest()[:32]
    assert {r.user_id for r in progress} == {expected_id}
    assert sum(r.reps for r in progress) == expected_reps
    assert (max(r.session_date for r in progress) - min(r.session_date for r in progress)).days > 35


def test_manual_reps_count_without_invented_form_or_risk(tmp_path, run_pipeline):
    meta = {
        "schema_version": 1, "session_id": "manual-session", "user_id": "pseudo",
        "started_at": "2026-10-10T12:00:00Z", "finished_at": "2026-10-10T12:30:00Z",
        "exported_at": "2026-10-10T12:30:00Z", "inference_mode": "on_device",
        "sets": [{"set_index": 0, "exercise_id": "squat", "weight_kg": None, "frame_count": 0,
                  "reps": [{"rep_index": i, "start_ms": None, "end_ms": None, "tempo_ms": 0,
                            "range_deg": 0, "quality": None,
                            "flags": [{"rule_id": "manual_unscored", "severity": "info"}]} for i in range(10)]}],
    }
    folder = tmp_path / "meta/2026-10-10"
    folder.mkdir(parents=True)
    (folder / "manual-session.json").write_text(json.dumps(meta))
    tables = run_pipeline(tmp_path)
    row = tables["gold_user_progress_daily"].first()
    assert row.reps == 10
    assert row.clean_reps is None
    assert row.clean_share is None
    assert row.avg_range_deg is None
    assert row.avg_quality is None
    assert tables["gold_injury_risk_scores"].count() == 0
