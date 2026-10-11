"""Tests for the AI-10 bundle loader and baseline. They use synthetic bundles only; no participant data."""

import copy
import hashlib
import json
import os
import tempfile
import unittest

import numpy as np

from form_classifier.dataset import BundleError, FRAMES, JOINTS, PREPROCESSING_VERSION, features, load_bundle
from form_classifier.train import cross_validate

PARTICIPANT = "participant_test"
CONSENT = "consent_test"


def _sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _rep(index, clip_id, exercise, label, rng):
    return {
        "schema_version": 1,
        "rep_id": f"rep_{index}",
        "clip_id": clip_id,
        "participant_id": PARTICIPANT,
        "consent_reference": CONSENT,
        "exercise_id": exercise,
        "human_labels": [label],
        "primary_label": label,
        "normalization": {"preprocessing_version": PREPROCESSING_VERSION},
        "duration_ms": 1000 + index,
        "start_frame": index * FRAMES,
        "joints": rng.uniform(0.0, 1.0, size=(FRAMES, JOINTS, 2)).round(6).tolist(),
        "validity": [[True] * JOINTS for _ in range(FRAMES)],
    }


def make_bundle(reps_per_clip=3, clips=4, seed=0):
    rng = np.random.default_rng(seed)
    clip_rows, rep_rows = [], []
    labels = ["clean", "fast_lowering", "clean"]
    index = 0
    for c in range(clips):
        clip_id = f"clip_{c}"
        clip_rows.append({"schema_version": 1, "clip_id": clip_id})
        for r in range(reps_per_clip):
            rep_rows.append(_rep(index, clip_id, "squat" if c % 2 == 0 else "push_up", labels[r % 3], rng))
            index += 1
    training = "\n".join(json.dumps(r) for r in rep_rows) + "\n"
    clips = "\n".join(json.dumps(c) for c in clip_rows) + "\n"
    manifest = {
        "schema_version": 1,
        "checksums": {"training_jsonl": _sha256(training), "clips_jsonl": _sha256(clips)},
        "consents": [{"reference": CONSENT, "participant_id": PARTICIPANT, "status": "active", "allowed_use": True}],
    }
    return {"schema_version": 1, "training_jsonl": training, "clips_jsonl": clips, "manifest": manifest}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def write(self, bundle):
        path = os.path.join(self._tmp.name, "bundle.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(bundle, handle)
        return path

    def test_loads_valid_bundle(self):
        bundle = load_bundle(self.write(make_bundle()))
        self.assertEqual(len(bundle.reps), 12)
        self.assertEqual(bundle.counts_by_exercise, {"squat": 6, "push_up": 6})
        self.assertEqual(bundle.reps[0].joints.shape, (FRAMES, JOINTS, 2))

    def test_rejects_checksum_mismatch(self):
        bundle = make_bundle()
        bundle["training_jsonl"] = bundle["training_jsonl"].replace("clean", "forward_lean", 1)
        with self.assertRaisesRegex(BundleError, "training_jsonl does not match"):
            load_bundle(self.write(bundle))

    def test_rejects_inactive_consent(self):
        bundle = make_bundle()
        bundle["manifest"]["consents"][0]["status"] = "withdrawn"
        with self.assertRaisesRegex(BundleError, "not active"):
            load_bundle(self.write(bundle))

    def test_rejects_consent_not_allowed_for_training(self):
        bundle = make_bundle()
        bundle["manifest"]["consents"][0]["allowed_use"] = False
        with self.assertRaisesRegex(BundleError, "not active"):
            load_bundle(self.write(bundle))

    def test_rejects_wrong_joint_shape(self):
        bundle = make_bundle()
        rows = [json.loads(line) for line in bundle["training_jsonl"].splitlines()]
        rows[0]["joints"] = rows[0]["joints"][:-1]
        bundle["training_jsonl"] = "\n".join(json.dumps(r) for r in rows) + "\n"
        bundle["manifest"]["checksums"]["training_jsonl"] = _sha256(bundle["training_jsonl"])
        with self.assertRaisesRegex(BundleError, "joints have shape"):
            load_bundle(self.write(bundle))

    def test_rejects_non_finite_coordinates(self):
        bundle = make_bundle()
        rows = [json.loads(line) for line in bundle["training_jsonl"].splitlines()]
        rows[0]["joints"][0][0][0] = float("nan")
        bundle["training_jsonl"] = "\n".join(json.dumps(r) for r in rows) + "\n"
        bundle["manifest"]["checksums"]["training_jsonl"] = _sha256(bundle["training_jsonl"])
        with self.assertRaisesRegex(BundleError, "non-finite"):
            load_bundle(self.write(bundle))

    def test_rejects_duplicate_rep_ids(self):
        bundle = make_bundle()
        rows = [json.loads(line) for line in bundle["training_jsonl"].splitlines()]
        rows[1]["rep_id"] = rows[0]["rep_id"]
        bundle["training_jsonl"] = "\n".join(json.dumps(r) for r in rows) + "\n"
        bundle["manifest"]["checksums"]["training_jsonl"] = _sha256(bundle["training_jsonl"])
        with self.assertRaisesRegex(BundleError, "duplicate rep_id"):
            load_bundle(self.write(bundle))

    def test_feature_vector_is_stable_length(self):
        bundle = load_bundle(self.write(make_bundle()))
        lengths = {features(rep).shape[0] for rep in bundle.reps}
        self.assertEqual(lengths, {len(("squat", "push_up", "bicep_curl", "shoulder_press", "lunge")) + 1 + JOINTS * 6})

    def load_rows(self, rows):
        raw = make_bundle()
        raw["training_jsonl"] = "\n".join(json.dumps(row) for row in rows) + "\n"
        raw["clips_jsonl"] = "\n".join(
            json.dumps({"schema_version": 1, "clip_id": clip})
            for clip in sorted({row["clip_id"] for row in rows})
        ) + "\n"
        for name in ("training_jsonl", "clips_jsonl"):
            raw["manifest"]["checksums"][name] = _sha256(raw[name])
        return load_bundle(self.write(raw))

    def confounded_bundle(self):
        rng = np.random.default_rng(2)
        return self.load_rows([
            _rep(0, "squat_a", "squat", "forward_lean", rng),
            _rep(1, "squat_a", "squat", "clean", rng),
            _rep(2, "squat_b", "squat", "fast_lowering", rng),
            _rep(3, "squat_b", "squat", "clean", rng),
            _rep(4, "push", "push_up", "clean", rng),
            _rep(5, "press", "shoulder_press", "clean", rng),
        ])

    def test_cross_validation_reports_metrics(self):
        bundle = load_bundle(self.write(make_bundle(reps_per_clip=3, clips=4)))
        result = cross_validate(bundle)
        self.assertEqual(result["folds"], 4)
        self.assertEqual(result["scored_reps"], 12)
        self.assertEqual(result["unscored_clips"], [])
        for key in ("accuracy", "macro_f1", "majority_baseline_accuracy", "majority_label",
                    "stratified_random_expected_accuracy", "stratified_random_expected_macro_f1",
                    "per_class", "clips", "position_only", "position_bias"):
            self.assertIn(key, result)

    def test_single_clip_exercises_are_unscored(self):
        result = cross_validate(self.confounded_bundle())
        self.assertEqual(result["folds"], 2)
        self.assertEqual(result["scored_reps"], 4)
        self.assertEqual({row["clip_id"] for row in result["clips"]}, {"squat_a", "squat_b"})
        self.assertEqual(result["unscored_clips"], [
            {"clip_id": "press", "exercise_id": "shoulder_press", "reps": 1,
             "reason": "only clip for this exercise"},
            {"clip_id": "push", "exercise_id": "push_up", "reps": 1,
             "reason": "only clip for this exercise"},
        ])

    def test_per_class_recall_counts_and_training_coverage(self):
        result = cross_validate(self.confounded_bundle())
        self.assertEqual(set(result["per_class"]), {"clean", "fast_lowering", "forward_lean"})
        for label, total in (("clean", 2), ("fast_lowering", 1), ("forward_lean", 1)):
            row = result["per_class"][label]
            self.assertEqual(row["total"], total)
            self.assertEqual(row["recall_count"], f'{row["correct"]}/{total}')
            self.assertEqual(row["in_training"], label == "clean")
            self.assertEqual(row["in_training_reps"], total if label == "clean" else 0)
            if label != "clean":
                self.assertEqual(row["correct"], 0)
        folds = {fold["clip_id"]: fold for fold in result["clips"]}
        self.assertFalse(folds["squat_a"]["per_class"]["forward_lean"]["in_training"])
        self.assertFalse(folds["squat_b"]["per_class"]["fast_lowering"]["in_training"])
        self.assertTrue(folds["squat_a"]["per_class"]["clean"]["in_training"])

    def test_baselines_use_only_scored_reps(self):
        result = cross_validate(self.confounded_bundle())
        self.assertEqual(result["majority_label"], "clean")
        self.assertAlmostEqual(result["majority_baseline_accuracy"], 2 / 4)
        self.assertAlmostEqual(result["stratified_random_expected_accuracy"], (2 / 4)**2 + 2 * (1 / 4)**2)
        self.assertAlmostEqual(result["stratified_random_expected_macro_f1"], 1 / 3)

    def test_position_is_ranked_by_start_frame_even_with_shuffled_rows(self):
        rng = np.random.default_rng(3)
        rows = [_rep(i, "a" if i < 3 else "b", "squat", "clean", rng) for i in range(4)]
        rows[0]["start_frame"], rows[1]["start_frame"], rows[2]["start_frame"] = 90, 10, 50
        bundle = self.load_rows([rows[2], rows[0], rows[3], rows[1]])
        positions = {rep.rep_id: rep.position for rep in bundle.reps}
        self.assertEqual(positions, {"rep_0": 1.0, "rep_1": 0.0, "rep_2": 0.5, "rep_3": 0.0})
        self.assertEqual({rep.rep_id: rep.start_frame for rep in bundle.reps},
                         {"rep_0": 90, "rep_1": 10, "rep_2": 50, "rep_3": 96})

    def test_rejects_invalid_start_frame(self):
        rng = np.random.default_rng(4)
        for value in (None, -1, 1.5, float("nan"), True):
            with self.subTest(value=value):
                row = _rep(0, "a", "squat", "clean", rng)
                row["start_frame"] = value
                with self.assertRaisesRegex(BundleError, "start_frame"):
                    self.load_rows([row])

    def test_position_only_model_detects_planted_bias(self):
        rng = np.random.default_rng(5)
        rows = []
        for clip in range(3):
            for rank in range(20):
                row = _rep(clip * 20 + rank, f"clip_{clip}", "squat",
                           "fast_lowering" if rank < 10 else "clean", rng)
                # Identical pose and duration: position is the only predictive signal.
                row["joints"] = np.zeros((FRAMES, JOINTS, 2)).tolist()
                row["duration_ms"] = 1000
                rows.append(row)
        result = cross_validate(self.load_rows(list(reversed(rows))))
        self.assertEqual(result["position_only"]["accuracy"], 1.0)
        self.assertEqual(result["position_only"]["macro_f1"], 1.0)
        self.assertEqual(result["position_only"]["scored_reps"], 60)
        self.assertLessEqual(result["accuracy"], 0.5)
        for row in result["position_bias"]:
            self.assertEqual(row["first_half"], {"non_clean": 10, "total": 10, "share": 1.0})
            self.assertEqual(row["second_half"], {"non_clean": 0, "total": 10, "share": 0.0})

    def test_no_eligible_clips_reports_no_scores(self):
        bundle = load_bundle(self.write(make_bundle(clips=2)))
        result = cross_validate(bundle)
        self.assertEqual(result["scored_reps"], 0)
        self.assertEqual(result["folds"], 0)
        self.assertEqual(len(result["unscored_clips"]), 2)
        self.assertEqual(len(result["position_bias"]), 2)
        self.assertEqual(result["per_class"], {})
        for key in ("accuracy", "macro_f1", "majority_baseline_accuracy",
                    "stratified_random_expected_accuracy", "stratified_random_expected_macro_f1"):
            self.assertIsNone(result[key])
        self.assertIsNone(result["position_only"]["accuracy"])
        self.assertIsNone(result["position_only"]["macro_f1"])

    def test_single_training_class_can_be_scored(self):
        rng = np.random.default_rng(6)
        result = cross_validate(self.load_rows([
            _rep(0, "a", "squat", "forward_lean", rng),
            _rep(1, "b", "squat", "clean", rng),
        ]))
        self.assertEqual(result["scored_reps"], 2)
        self.assertEqual(result["accuracy"], 0.0)
        self.assertEqual(result["position_only"]["accuracy"], 0.0)
        self.assertTrue(all(not row["in_training"] for row in result["per_class"].values()))


if __name__ == "__main__":
    unittest.main()
