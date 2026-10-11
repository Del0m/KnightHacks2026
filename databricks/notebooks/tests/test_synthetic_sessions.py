"""Pure Python contract checks; no Databricks or Spark required."""
import hashlib
import hmac
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ns = {"__name__": "synthetic_contract"}
source = (ROOT / "databricks/notebooks/generate_synthetic_sessions.py").read_text()
exec(compile(source.split('dbutils.widgets.text(')[0], str(ROOT / 'databricks/notebooks/generate_synthetic_sessions.py'), 'exec'), ns)


class SyntheticContract(unittest.TestCase):
    def test_shared_manifest_and_presenter(self):
        path = str(ROOT / "data/demo-user-ids.json")
        ids = ns["load_seed_user_ids"](path, 30)
        self.assertEqual(ids, json.loads(Path(path).read_text()))
        self.assertEqual(ns["load_seed_user_ids"](path, 2, "presenter"), ["presenter", ids[1]])
        with self.assertRaises(ValueError):
            ns["load_seed_user_ids"](path, 31)

    def test_six_weeks_use_hmac_ids_and_valid_payloads(self):
        ids = ns["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 2, "presenter")
        now = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
        rows = list(ns["generate"](ids, 6, "test-secret", {}, now))
        expected = {hmac.new(b"test-secret", u.encode(), hashlib.sha256).hexdigest()[:32] for u in ids}
        self.assertEqual({row[2]["user_id"] for row in rows}, expected)
        self.assertGreater((max(datetime.fromisoformat(r[0]) for r in rows) - min(datetime.fromisoformat(r[0]) for r in rows)).days, 35)
        self.assertEqual(len({r[1] for r in rows}), len(rows))
        self.assertTrue(all(r[2]["inference_mode"] == "coreml" for r in rows))
        self.assertTrue(all(len(f["kp"]) == 51 for r in rows for line in r[3] for f in json.loads(line)["frames"]))
        with tempfile.TemporaryDirectory() as volume:
            self.assertEqual(ns["write_sessions"](rows, volume), len(rows))
            self.assertEqual(len(list(Path(volume).glob("meta/*/*.json"))), len(rows))

    def test_exports_match_the_shared_schema(self):
        rows = list(ns["generate"](["demo-user-01"], 1, "test-secret",
                                  {"demo-user-01": ("knee", "left")},
                                  datetime(2026, 10, 10, 12, tzinfo=timezone.utc)))
        payloads = [{"def": "ExportMeta", "value": row[2]} for row in rows]
        payloads += [{"def": "ExportJointsLine", "value": json.loads(line)}
                     for row in rows for line in row[3]]
        script = '''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSchema } from './specs/validate.mjs';
const schema = JSON.parse(readFileSync('specs/set-record/schema.json', 'utf8'));
for (const payload of JSON.parse(readFileSync(0, 'utf8'))) {
  assert.deepEqual(validateSchema(payload.value, schema.$defs[payload.def], schema), []);
}
'''
        result = subprocess.run(["node", "--input-type=module", "-e", script],
                                input=json.dumps(payloads), text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)


# ---- Injured lifters (AI-14): tags silver_reps reads, and a gradual decline for some ----

import math
import re
from collections import defaultdict
from datetime import timedelta

NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
SECRET = "test-secret"
# silver.py: exercise -> primary angle, and the body parts each angle reflects (ANGLE_BODY_PARTS).
ELBOW_EXERCISES = {"shoulder_press", "bench_press", "overhead_press", "push_up", "bicep_curl", "row", "dip"}
ANGLE_PARTS = {"knee": {"knee"}, "hip": {"hip", "lower_back"}, "elbow": {"elbow", "shoulder", "wrist"}}
JOINTS = {"knee": {"left": (11, 13, 15), "right": (12, 14, 16)},
          "elbow": {"left": (5, 7, 9), "right": (6, 8, 10)}}


def _angle(kp, a, b, c):
    ax, ay, cx, cy = kp[3 * a] - kp[3 * b], kp[3 * a + 1] - kp[3 * b + 1], kp[3 * c] - kp[3 * b], kp[3 * c + 1] - kp[3 * b + 1]
    cos = (ax * cx + ay * cy) / (math.hypot(ax, ay) * math.hypot(cx, cy))
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _rep_stats(meta, joints_lines, side):
    """[(day, exercise, range on `side`, lowering share, flagged)] per rep, measured from the joints."""
    out = []
    frames_by_set = {json.loads(line)["set_index"]: json.loads(line)["frames"] for line in joints_lines}
    day = datetime.fromisoformat(meta["started_at"]).date()
    for s in meta["sets"]:
        angle = "elbow" if s["exercise_id"] in ELBOW_EXERCISES else "knee"
        for rep in s["reps"]:
            fr = [f for f in frames_by_set[s["set_index"]] if rep["start_ms"] <= f["t_ms"] <= rep["end_ms"]]
            angles = [(f["t_ms"], _angle(f["kp"], *JOINTS[angle][side])) for f in fr]
            bottom_t = min(angles, key=lambda a: a[1])[0]
            out.append((day, s["exercise_id"], max(a for _, a in angles) - min(a for _, a in angles),
                        (bottom_t - rep["start_ms"]) / (rep["end_ms"] - rep["start_ms"]), bool(rep["flags"])))
    return out


class SyntheticInjuries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ids = ns["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 30)
        cls.plan = ns["plan_injuries"](cls.ids, {}, 6)
        cls.rows = list(ns["generate"](cls.ids, 6, SECRET, {}, NOW))
        cls.by_user = defaultdict(list)
        pseudonyms = {ns["pseudonymize"](u, SECRET): u for u in cls.ids}
        for row in cls.rows:
            cls.by_user[pseudonyms[row[2]["user_id"]]].append(row)
        cls.start = min(datetime.fromisoformat(r[2]["started_at"]).date() for r in cls.rows)
        cls.start -= timedelta(days=cls.start.weekday())

    def test_plan_injures_a_minority_and_some_decline(self):
        self.assertEqual(self.plan, ns["plan_injuries"](self.ids, {}, 6))  # deterministic
        courses = [p["course"] for p in self.plan.values()]
        self.assertTrue(0.2 <= len(self.plan) / len(self.ids) <= 0.4, len(self.plan))
        self.assertGreaterEqual(courses.count("decline"), 3)
        self.assertGreaterEqual(courses.count("stable"), 3)
        for p in self.plan.values():
            self.assertIn(p["side"], ("left", "right"))
        # Recovery users keep their §17 story and aren't re-rolled.
        plan = ns["plan_injuries"](self.ids, {self.ids[0]: ("knee", "left")}, 6)
        self.assertEqual((plan[self.ids[0]]["part"], plan[self.ids[0]]["side"], plan[self.ids[0]]["course"]),
                         ("knee", "left", "recovery"))

    def test_injured_sessions_carry_side_tags_silver_reads(self):
        for user_id, rows in self.by_user.items():
            injury = self.plan.get(user_id)
            for _, _, meta, _ in rows:
                if injury is None:
                    self.assertEqual(meta["injury_groups"], [])
                    continue
                self.assertEqual(meta["injury_groups"], [f"{injury['part']}:{injury['side']}"])
                part, side = meta["injury_groups"][0].split(":")
                self.assertRegex(meta["injury_groups"][0], r"^[a-z_]+:(left|right)$")
                angles = {"elbow" if s["exercise_id"] in ELBOW_EXERCISES else "knee" for s in meta["sets"]}
                self.assertTrue(any(part in ANGLE_PARTS[a] for a in angles), (part, angles))

    def _early_late(self, user_id, side):
        onset = self.start + timedelta(days=self.plan[user_id]["onset_day"])
        stats = [s for row in self.by_user[user_id] for s in _rep_stats(row[2], row[3], side)]
        last = max(s[0] for s in stats)
        early = [s for s in stats if s[0] < onset]
        late = [s for s in stats if s[0] > last - timedelta(days=7)]
        mean = lambda xs, i: sum(x[i] for x in xs) / len(xs)  # noqa: E731
        return early, late, mean

    def test_decliners_worsen_on_the_injured_side(self):
        decliners = [u for u, p in self.plan.items() if p["course"] == "decline"]
        for user_id in decliners:
            injury = self.plan[user_id]
            healthy_side = "left" if injury["side"] == "right" else "right"
            early, late, mean = self._early_late(user_id, injury["side"])
            self.assertTrue(early and late)
            self.assertLess(mean(late, 2), 0.85 * mean(early, 2), "injured-side range shrinks")
            self.assertLess(mean(late, 3), 0.8 * mean(early, 3), "lowering gets faster")
            self.assertGreater(mean(late, 4), mean(early, 4) + 0.2, "more flagged reps")
            h_early, h_late, _ = self._early_late(user_id, healthy_side)
            self.assertGreater(mean(h_late, 2), 0.9 * mean(h_early, 2), "healthy side holds")

    def test_decliners_spike_their_training_load(self):
        for user_id, p in self.plan.items():
            if p["course"] != "decline":
                continue
            weekly = defaultdict(float)
            for _, _, meta, _ in self.by_user[user_id]:
                week = (datetime.fromisoformat(meta["started_at"]).date() - self.start).days // 7
                for s in meta["sets"]:
                    weekly[week] += len(s["reps"]) * (s["weight_kg"] or 1.0)
            onset_week = p["onset_day"] // 7
            before = [weekly[w] for w in range(onset_week) if w in weekly]
            self.assertGreater(weekly[onset_week], 1.3 * sum(before) / len(before), user_id)

    def test_stable_injured_lifters_stay_steady(self):
        for user_id, p in self.plan.items():
            if p["course"] != "stable":
                continue
            stats = [s for row in self.by_user[user_id] for s in _rep_stats(row[2], row[3], p["side"])]
            first = min(s[0] for s in stats)
            early = [s[2] for s in stats if s[0] < first + timedelta(days=14)]
            late = [s[2] for s in stats if s[0] >= first + timedelta(days=28)]
            self.assertGreater(sum(late) / len(late), 0.9 * sum(early) / len(early), user_id)


class ClearSynthetic(unittest.TestCase):
    def test_clear_removes_only_earlier_synthetic_sessions(self):
        ids = ns["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 2)
        rows = list(ns["generate"](ids, 2, SECRET, {}, NOW))
        with tempfile.TemporaryDirectory() as volume:
            ns["write_sessions"](rows, volume)
            other = Path(volume, "meta", "2026-09-01")
            other.mkdir(parents=True, exist_ok=True)
            (other / "phone.json").write_text(json.dumps({"session_id": "p", "device": "ios"}))
            Path(volume, "meta", "loose.json").write_text(json.dumps({"session_id": "x", "device": "ios"}))
            self.assertEqual(ns["clear_synthetic"](volume), len(rows))
            self.assertEqual(sorted(p.name for p in Path(volume, "meta").rglob("*.json")), ["loose.json", "phone.json"])
            self.assertEqual(list(Path(volume, "joints").rglob("*.gz")), [])


class ReplaceSynthetic(unittest.TestCase):
    def test_lazy_failure_preserves_existing_files(self):
        def broken():
            yield "2026-09-01", "new", {"device": "synthetic"}, ["{}"]
            raise ValueError("invalid generation input")

        with tempfile.TemporaryDirectory() as volume:
            ns["write_sessions"]([("2026-09-01", "old", {"device": "synthetic", "joints_path": "joints/2026-09-01/old.ndjson.gz"}, ["old"])], volume)
            before = {str(p.relative_to(volume)): p.read_bytes() for p in Path(volume).rglob("*") if p.is_file()}
            for sessions in (broken(), iter(())):
                with self.assertRaises(ValueError):
                    ns["replace_sessions"](sessions, volume)
                self.assertEqual(before, {str(p.relative_to(volume)): p.read_bytes() for p in Path(volume).rglob("*") if p.is_file()})
            self.assertEqual(ns["replace_sessions"]([("2026-09-02", "new", {"device": "synthetic"}, ["new"])], volume), 1)
            self.assertFalse(Path(volume, "meta/2026-09-01/old.json").exists())
            self.assertFalse(Path(volume, "joints/2026-09-01/old.ndjson.gz").exists())
            self.assertTrue(Path(volume, "meta/2026-09-02/new.json").exists())


    def test_notebook_input_failures_preserve_existing_files(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        for failure in ("manifest", "secret"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as volume:
                ns["write_sessions"]([("2026-09-01", "old", {"device": "synthetic"}, ["old"])], volume)
                before = {str(p.relative_to(volume)): p.read_bytes() for p in Path(volume).rglob("*") if p.is_file()}
                values = {"seed_user_ids_path": "" if failure == "manifest" else str(ROOT / "data/demo-user-ids.json"),
                          "presenter_user_id": "", "users": "1", "weeks": "1", "recovery": "",
                          "volume": volume, "replace": "true", "injured_share": "0.3", "decline_share": "0.5"}
                widgets = SimpleNamespace(text=Mock(), dropdown=Mock(), get=values.__getitem__)
                dbutils = SimpleNamespace(widgets=widgets, secrets=SimpleNamespace(get=Mock(side_effect=RuntimeError("secret unavailable"))))
                with self.assertRaises((IsADirectoryError, RuntimeError)):
                    exec(compile(source, "synthetic-notebook", "exec"), {"dbutils": dbutils})
                self.assertEqual(before, {str(p.relative_to(volume)): p.read_bytes() for p in Path(volume).rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main()
