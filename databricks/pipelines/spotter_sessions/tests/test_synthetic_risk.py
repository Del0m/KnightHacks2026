"""AI-14: lifters from generate_synthetic_sessions.py, pushed through bronze/silver/gold.

Injured lifters carry tags silver_reps resolves to a side, the declining ones raise the heuristic
weak label (score >= 0.5) on some days, and everyone else stays below it.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
GENERATOR = ROOT / "databricks/notebooks/generate_synthetic_sessions.py"
NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
SECRET = "test-secret"


@pytest.fixture(scope="module")
def generator():
    ns = {"__name__": "synthetic_generator"}
    exec(compile(GENERATOR.read_text().split("dbutils.widgets.text(")[0], str(GENERATOR), "exec"), ns)
    return ns


@pytest.fixture
def scored(tmp_path, run_pipeline, generator):
    ids = generator["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 30)
    # The notebook's default recovery users, so the §17 story is covered too.
    recovery = {ids[0]: ("knee", "left"), ids[3]: ("shoulder", "right"), ids[6]: ("knee", "right")}
    plan = generator["plan_injuries"](ids, recovery, 6)
    generator["write_sessions"](generator["generate"](ids, 6, SECRET, recovery, NOW), str(tmp_path))
    tables = run_pipeline(tmp_path)
    by_pseudonym = {generator["pseudonymize"](u, SECRET): plan.get(u) for u in ids}
    return by_pseudonym, tables


def test_injured_lifters_resolve_a_side_and_decliners_raise_the_weak_label(scored):
    lifters, tables = scored

    sides = defaultdict(set)
    for r in tables["silver_reps"].select("user_id", "injured_side").distinct().collect():
        sides[r.user_id].add(r.injured_side)
    for user_id, injury in lifters.items():
        assert sides[user_id] == ({injury["side"]} if injury else {None}), (user_id, injury)

    rows = tables["gold_injury_risk_scores"].select("user_id", "score", "weak_label").collect()
    max_score, labelled = defaultdict(float), defaultdict(int)
    for r in rows:
        max_score[r.user_id] = max(max_score[r.user_id], r.score)
        labelled[r.user_id] += r.weak_label

    course = {u: (i["course"] if i else "healthy") for u, i in lifters.items()}
    decliners = [u for u, c in course.items() if c == "decline"]
    crossed = [u for u in decliners if max_score[u] >= 0.5]
    assert len(crossed) >= max(2, len(decliners) // 2), {u: round(max_score[u], 2) for u in decliners}
    for u in crossed:  # raised on some days, not all of them
        assert 0 < labelled[u] < sum(1 for r in rows if r.user_id == u)
    others = {u: round(max_score[u], 2) for u, c in course.items() if c != "decline"}
    assert max(others.values()) < 0.5, others

    positive = sum(r.weak_label for r in rows) / len(rows)
    assert 0.005 <= positive <= 0.10, positive
