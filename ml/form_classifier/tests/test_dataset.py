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

    def test_cross_validation_reports_metrics(self):
        bundle = load_bundle(self.write(make_bundle(reps_per_clip=3, clips=4)))
        result = cross_validate(bundle)
        self.assertEqual(result["folds"], 4)
        for key in ("accuracy", "macro_f1", "majority_baseline_accuracy", "majority_label"):
            self.assertIn(key, result)


if __name__ == "__main__":
    unittest.main()
