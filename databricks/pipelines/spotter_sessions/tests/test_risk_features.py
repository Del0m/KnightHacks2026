"""CONN-03 / AI-14: gold_injury_risk_scores measures range on the injured side when silver_reps
knows it (injured_side from tags like "knee:left"), and on the smaller side otherwise."""
from __future__ import annotations

import gzip
import json
import math
from datetime import date, timedelta
from pathlib import Path

import pytest

START = date(2026, 9, 1)
SESSION_DAYS = list(range(0, 28, 3))  # days 0..27; the 7-day window on day 27 holds days 21, 24 and 27
SHRINK_FROM = 21
LAST = START + timedelta(days=SESSION_DAYS[-1])
REPS = 3
FRAME_OFFSETS = [0, 300, 600, 900, 1200, 1500]  # bottom at 600 ms
DEPTH = [0.0, 0.5, 1.0, 0.5, 0.0, 0.0]  # share of the rep's range reached at each frame


def knee_frame(t_ms: int, left_bend: float, right_bend: float) -> dict:
    """17 COCO joints with each knee bent `bend` degrees from straight (knee angle = 180 - bend)."""
    kp = [[0.5, 0.1, 0.9] for _ in range(17)]
    kp[5], kp[6] = [0.45, 0.2, 0.9], [0.55, 0.2, 0.9]  # shoulders
    for hip, knee, ankle, x, bend in ((11, 13, 15, 0.45, left_bend), (12, 14, 16, 0.55, right_bend)):
        kp[hip] = [x, 0.5, 0.9]
        kp[knee] = [x, 0.7, 0.9]
        rad = math.radians(bend)
        kp[ankle] = [x + 0.2 * math.sin(rad), 0.7 + 0.2 * math.cos(rad), 0.9]
    return {"t_ms": t_ms, "kp": [v for joint in kp for v in joint]}


def write_lifter(volume: Path, user_id: str, injury_groups: list[str], ranges) -> None:
    """Squat sessions every 3 days for 4 weeks; ranges(day) -> (left_range_deg, right_range_deg)."""
    for day in SESSION_DAYS:
        on = START + timedelta(days=day)
        left, right = ranges(day)
        session_id = f"{user_id}-{on.isoformat()}"
        reps, frames = [], []
        for r in range(REPS):
            start = r * 2000
            reps.append({"rep_index": r, "start_ms": start, "end_ms": start + FRAME_OFFSETS[-1],
                         "tempo_ms": FRAME_OFFSETS[-1], "range_deg": max(left, right), "quality": None,
                         "flags": []})
            frames += [knee_frame(start + t, left * d, right * d) for t, d in zip(FRAME_OFFSETS, DEPTH)]
        meta = {
            "schema_version": 1, "session_id": session_id, "user_id": user_id,
            "started_at": f"{on}T11:00:00+00:00", "finished_at": f"{on}T11:30:00+00:00",
            "device": "test", "inference_mode": "coreml", "medal": None, "form_score": None,
            "experience_level": None, "injury_groups": injury_groups, "rehab_start_on": None,
            "sets": [{"set_index": 0, "exercise_id": "squat", "weight_kg": 60.0, "medal": None,
                      "frame_count": len(frames), "reps": reps}],
        }
        for folder in ("meta", "joints"):
            (volume / folder / on.isoformat()).mkdir(parents=True, exist_ok=True)
        (volume / "meta" / on.isoformat() / f"{session_id}.json").write_text(json.dumps(meta))
        with gzip.open(volume / "joints" / on.isoformat() / f"{session_id}.ndjson.gz", "wt") as f:
            f.write(json.dumps({"session_id": session_id, "set_index": 0, "exercise_id": "squat",
                                "fps": 10.0, "frames": frames}) + "\n")


@pytest.fixture
def risk(tmp_path, run_pipeline):
    # Injured left knee; the left side shrinks 100 -> 60 while the right stays at 60 (the smaller side).
    write_lifter(tmp_path, "left-shrinks", ["knee:left"],
                 lambda d: (60.0 if d >= SHRINK_FROM else 100.0, 60.0))
    # Injured left knee; only the healthy right side shrinks 90 -> 50.
    write_lifter(tmp_path, "right-shrinks", ["knee:left"],
                 lambda d: (100.0, 50.0 if d >= SHRINK_FROM else 90.0))
    # No injury; the right side is the smaller one throughout.
    write_lifter(tmp_path, "no-injury", [], lambda d: (100.0, 80.0))
    tables = run_pipeline(tmp_path)

    sides = {r.user_id: {r.injured_side} for r in tables["silver_reps"].collect()}
    assert sides == {"left-shrinks": {"left"}, "right-shrinks": {"left"}, "no-injury": {None}}

    rows = tables["gold_injury_risk_scores"].filter("body_part = 'knee'").collect()
    return {(r.user_id, r.date): r for r in rows}


def test_injured_side_range_drives_range_shrinking(risk):
    row = risk[("left-shrinks", LAST)]
    assert row.range_7d == pytest.approx(60.0, abs=0.5)  # left side over days 21-27
    assert row.range_28d == pytest.approx((7 * 100 + 3 * 60) / 10, abs=0.5)
    assert "range_shrinking" in row.top_features
    assert row.range_side == "injured"


def test_healthy_side_shrinking_does_not_move_range(risk):
    row = risk[("right-shrinks", LAST)]
    assert row.range_7d == pytest.approx(100.0, abs=0.5)  # still the injured left side
    assert row.range_28d == pytest.approx(100.0, abs=0.5)
    assert "range_shrinking" not in row.top_features
    assert row.range_side == "injured"


def test_no_injury_uses_the_smaller_side(risk):
    row = risk[("no-injury", LAST)]
    assert row.range_7d == pytest.approx(80.0, abs=0.5)
    assert row.range_28d == pytest.approx(80.0, abs=0.5)
    assert "range_shrinking" not in row.top_features
    assert row.range_side == "min"


def test_dropped_injury_tag_keeps_the_injured_side(tmp_path, run_pipeline):
    # knee:left is tagged early, then later sessions lack the tag. Ranges never change, so the
    # range must stay on the injured left side every day and nothing should look like shrinking.
    write_lifter(tmp_path, "tag-dropped", ["knee:left"], lambda d: (100.0, 60.0))
    for day in SESSION_DAYS:
        if day < SHRINK_FROM:
            continue
        on = (START + timedelta(days=day)).isoformat()
        path = tmp_path / "meta" / on / f"tag-dropped-{on}.json"
        meta = json.loads(path.read_text())
        meta["injury_groups"] = []
        path.write_text(json.dumps(meta))
    tables = run_pipeline(tmp_path)

    rows = {r.date: r for r in tables["gold_injury_risk_scores"]
            .filter("user_id = 'tag-dropped' AND body_part = 'knee'").collect()}
    assert len(rows) == len(SESSION_DAYS)
    for on, row in rows.items():
        assert row.range_side == "injured", on
        assert row.range_7d == pytest.approx(100.0, abs=0.5), on
        assert row.range_28d == pytest.approx(100.0, abs=0.5), on
        assert "range_shrinking" not in row.top_features, on
