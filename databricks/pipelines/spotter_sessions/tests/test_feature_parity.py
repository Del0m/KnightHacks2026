"""CONN-05 parity: silver_reps computes the same frame-derived features from the shared fixtures
as the API does before calling Model Serving (apps/api/test/score-features.test.ts), so the
served model sees the inputs it was trained on."""
from __future__ import annotations

import gzip
import json
import uuid
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[4] / "specs" / "set-record" / "fixtures" / "features"
FEATURES = ["lowering_ms", "rising_ms", "asymmetry", "max_trunk_angle", "min_knee_ankle_ratio"]


def write_session(fixture: dict, volume: Path) -> str:
    """Writes the fixture as the API uploads it (CONN-02 metadata and joints)."""
    session_id = str(uuid.uuid5(uuid.NAMESPACE_URL, fixture["name"]))
    meta = {
        "schema_version": 1, "session_id": session_id, "user_id": "fixture-features",
        "started_at": "2026-10-10T11:00:00+00:00", "finished_at": "2026-10-10T11:30:00+00:00",
        "device": "fixture", "inference_mode": "coreml", "medal": None, "form_score": None,
        "experience_level": None, "injury_groups": [], "rehab_start_on": None,
        "sets": [{
            "set_index": s, "exercise_id": set_["exercise_id"], "weight_kg": None, "medal": None,
            "frame_count": len(set_["frames"]),
            "reps": [{"rep_index": r, **{k: rep[k] for k in ("start_ms", "end_ms", "tempo_ms", "range_deg", "flags")},
                      "quality": None} for r, rep in enumerate(set_["reps"])],
        } for s, set_ in enumerate(fixture["sets"])],
    }
    for folder in ("meta", "joints"):
        (volume / folder / "2026-10-10").mkdir(parents=True, exist_ok=True)
    (volume / "meta" / "2026-10-10" / f"{session_id}.json").write_text(json.dumps(meta))
    with gzip.open(volume / "joints" / "2026-10-10" / f"{session_id}.ndjson.gz", "wt") as f:
        for s, set_ in enumerate(fixture["sets"]):
            f.write(json.dumps({"session_id": session_id, "set_index": s, "exercise_id": set_["exercise_id"],
                                "fps": 10.0, "frames": set_["frames"]}) + "\n")
    return session_id


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.json")), ids=lambda p: p.stem)
def test_pipeline_features_match_the_fixture(path, tmp_path, run_pipeline):
    fixture = json.loads(path.read_text())
    session_id = write_session(fixture, tmp_path)
    tables = run_pipeline(tmp_path)

    rows = {(r.set_index, r.rep_index): r for r in tables["silver_reps"].collect() if r.session_id == session_id}
    for s, set_ in enumerate(fixture["sets"]):
        for r, rep in enumerate(set_["reps"]):
            row = rows[(s, r)]
            for name in FEATURES:
                expected = rep["expected"][name]
                actual = getattr(row, name)
                where = f"{path.stem} set {s} rep {r} {name}"
                if expected is None:
                    assert actual is None, where
                else:
                    assert actual == pytest.approx(expected, abs=1e-6), where
