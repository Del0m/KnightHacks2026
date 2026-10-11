"""INT-06 parity: the shared medal fixtures give the same set and workout medals in the pipeline
as in the API (apps/api/test/medal-parity.test.ts). Rule flags decide clean; the model's labels in
the fixtures never reach the medal."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[4] / "specs" / "set-record" / "fixtures" / "medals"
NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)


def set_medal(clean: int, total: int, baseline: float) -> str:
    """pickMedal in apps/api/src/integrations/databricks/score.ts."""
    if total and clean == total:
        return "gold"
    return "silver" if round(clean / total * 1e4) >= round(baseline * 1e4) else "bronze"


def write_sessions(fixture: dict, volume: Path) -> list[str]:
    """Writes the fixture as the API uploads it (CONN-02 metadata), in time order."""
    ids = []
    for i, session in enumerate(fixture["sessions"]):
        finished = NOW - timedelta(days=session["days_ago"])
        session_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{fixture['name']}/{i}"))
        meta = {
            "schema_version": 1, "session_id": session_id, "user_id": fixture["user"],
            "started_at": (finished - timedelta(minutes=30)).isoformat(), "finished_at": finished.isoformat(),
            "device": "fixture", "inference_mode": "coreml", "medal": None, "form_score": None,
            "experience_level": None, "injury_groups": [], "rehab_start_on": None,
            "sets": [{
                "set_index": s, "exercise_id": set_["exercise_id"], "weight_kg": None, "medal": None,
                "frame_count": 0,
                "reps": [{"rep_index": r, "start_ms": None, "end_ms": None, "tempo_ms": rep["tempo_ms"],
                          "range_deg": rep["range_deg"], "quality": rep["model"]["quality"], "flags": rep["flags"]}
                         for r, rep in enumerate(set_["reps"])],
            } for s, set_ in enumerate(session["sets"])],
        }
        folder = volume / "meta" / finished.date().isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{session_id}.json").write_text(json.dumps(meta))
        ids.append(session_id)
    return ids


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.json")), ids=lambda p: p.stem)
def test_pipeline_medals_match_the_fixture(path, tmp_path, run_pipeline, spark):
    fixture = json.loads(path.read_text())
    session_ids = write_sessions(fixture, tmp_path)
    tables = run_pipeline(tmp_path)

    medals = {r.session_id: r for r in tables["gold_workout_medals"].collect()}
    from pyspark.sql import functions as F

    reps = tables["silver_reps"].groupBy("session_id", "set_index").agg(
        F.sum(F.col("is_clean").cast("int")).alias("clean"), F.count("*").alias("total")).collect()
    clean_by_set = {(r.session_id, r.set_index): (r.clean, r.total) for r in reps}

    for session_id, session in zip(session_ids, fixture["sessions"]):
        expected = session["expected"]
        row = medals[session_id]
        assert row.tier == expected["workout_medal"], f"{path.stem} {session['days_ago']}d ago: workout medal"
        assert row.clean_share == pytest.approx(expected["form_score"], abs=1e-4)
        assert row.baseline_share == pytest.approx(expected["baseline"], abs=1e-4)
        set_medals = [set_medal(*clean_by_set[(session_id, s)], row.baseline_share) for s in range(len(session["sets"]))]
        assert set_medals == expected["set_medals"], f"{path.stem} {session['days_ago']}d ago: set medals"
