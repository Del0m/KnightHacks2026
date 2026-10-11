"""Leave-one-clip-out baseline and bias diagnostics for an AI-09 export bundle.

Usage (keep the bundle and report outside the repo):

    python -m form_classifier.train --bundle /path/to/bundle.json --out /path/to/report.json

A clip is scored only when training contains another clip of its exercise. Both the summary-feature
and position-only models use the same folds, with all other clips in training. These diagnostics
cannot measure participant-level generalisation when the bundle contains only one participant.
"""

import argparse
import json
from collections import Counter
from typing import Dict

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from form_classifier.dataset import Bundle, features, load_bundle

SEED = 7


def build_model() -> object:
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED),
    )


def _predict(X, y, train_idx, test_idx):
    labels = np.unique(y[train_idx])
    if len(labels) == 1:
        # Logistic regression cannot fit one class; the only learned prediction is that class.
        return np.full(len(test_idx), labels[0])
    model = build_model()
    model.fit(X[train_idx], y[train_idx])
    return model.predict(X[test_idx])


def _metrics(y, predictions, in_training, in_training_same_exercise):
    per_class = {}
    for label in sorted(set(y.tolist())):
        mask = y == label
        total = int(mask.sum())
        correct = int((predictions[mask] == label).sum())
        trained = int(in_training[mask].sum())
        same_exercise = int(in_training_same_exercise[mask].sum())
        per_class[label] = {
            "correct": correct,
            "total": total,
            "recall_count": f"{correct}/{total}",
            "in_training": trained == total,
            "in_training_reps": trained,
            "in_training_same_exercise": same_exercise == total,
            "in_training_same_exercise_reps": same_exercise,
        }
    return {
        "scored_reps": len(y),
        "accuracy": float(accuracy_score(y, predictions)) if len(y) else None,
        # Fix K to the scored truth labels, also used for the stratified-random comparison.
        "macro_f1": float(f1_score(y, predictions, labels=sorted(per_class), average="macro",
                                   zero_division=0)) if len(y) else None,
        "per_class": per_class,
    }


def _position_bias(bundle):
    rows = []
    for clip_id in sorted({rep.clip_id for rep in bundle.reps}):
        reps = [rep for rep in bundle.reps if rep.clip_id == clip_id]
        row = {"clip_id": clip_id, "exercise_id": reps[0].exercise_id}
        for name, half in (("first_half", [rep for rep in reps if rep.position < 0.5]),
                           ("second_half", [rep for rep in reps if rep.position >= 0.5])):
            non_clean = sum(rep.label != "clean" for rep in half)
            row[name] = {"non_clean": non_clean, "total": len(half),
                         "share": non_clean / len(half) if half else None}
        rows.append(row)
    return rows


def cross_validate(bundle: Bundle) -> Dict[str, object]:
    """Score eligible held-out clips and expose imbalance, label coverage and position bias.

    Majority and stratified-random baselines describe the scored label distribution, rather than
    fitted fold-specific classifiers. Random macro-F1 is the population expectation 1/K, not an
    exact finite-sample expectation. Aggregate in_training is true only if the label was available
    in training for every scored occurrence. The same-exercise flags distinguish exposure through
    other exercises from exposure through another recording of the held-out exercise.
    """
    X = np.stack([features(rep) for rep in bundle.reps])
    positions = np.array([[rep.position] for rep in bundle.reps])
    y = np.array([rep.label for rep in bundle.reps])
    groups = np.array([rep.clip_id for rep in bundle.reps])
    exercises = np.array([rep.exercise_id for rep in bundle.reps])
    predictions = np.empty_like(y)
    position_predictions = np.empty_like(y)
    in_training = np.zeros(len(y), dtype=bool)
    in_training_same_exercise = np.zeros(len(y), dtype=bool)
    scored = np.zeros(len(y), dtype=bool)
    clips, unscored = [], []

    for clip_id in sorted(set(groups.tolist())):
        test_idx = np.flatnonzero(groups == clip_id)
        train_idx = np.flatnonzero(groups != clip_id)
        exercise = exercises[test_idx[0]]
        if not np.any(exercises[train_idx] == exercise):
            unscored.append({"clip_id": clip_id, "exercise_id": str(exercise),
                             "reps": len(test_idx), "reason": "only clip for this exercise"})
            continue
        predictions[test_idx] = _predict(X, y, train_idx, test_idx)
        position_predictions[test_idx] = _predict(positions, y, train_idx, test_idx)
        in_training[test_idx] = np.isin(y[test_idx], y[train_idx])
        same_exercise_idx = train_idx[exercises[train_idx] == exercise]
        in_training_same_exercise[test_idx] = np.isin(y[test_idx], y[same_exercise_idx])
        scored[test_idx] = True
        clips.append({
            "clip_id": clip_id,
            "exercise_id": str(exercise),
            "training_clips": sorted(set(groups[train_idx].tolist())),
            "training_labels": sorted(set(y[train_idx].tolist())),
            **_metrics(y[test_idx], predictions[test_idx], in_training[test_idx], in_training_same_exercise[test_idx]),
            "position_only": _metrics(y[test_idx], position_predictions[test_idx], in_training[test_idx], in_training_same_exercise[test_idx]),
        })

    counts = Counter(y[scored].tolist())
    total = int(scored.sum())
    majority = min(counts, key=lambda label: (-counts[label], label)) if total else None
    return {
        "folds": len(clips),
        **_metrics(y[scored], predictions[scored], in_training[scored], in_training_same_exercise[scored]),
        "majority_baseline_accuracy": counts[majority] / total if total else None,
        "majority_label": majority,
        "stratified_random_expected_accuracy": sum((n / total)**2 for n in counts.values()) if total else None,
        "stratified_random_expected_macro_f1": 1 / len(counts) if total else None,
        "clips": clips,
        "unscored_clips": unscored,
        "position_only": _metrics(y[scored], position_predictions[scored], in_training[scored], in_training_same_exercise[scored]),
        "position_bias": _position_bias(bundle),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bundle", required=True, help="path to a labelling export bundle (JSON)")
    parser.add_argument("--out", help="optional path for the JSON report (keep it outside the repo)")
    args = parser.parse_args()

    bundle = load_bundle(args.bundle)
    result = {
        "reps": len(bundle.reps),
        "clips": len({rep.clip_id for rep in bundle.reps}),
        "by_exercise": bundle.counts_by_exercise,
        "by_label": bundle.counts_by_label,
        "cross_validation": cross_validate(bundle),
    }

    print(json.dumps(result, indent=2, sort_keys=True))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, sort_keys=True)


if __name__ == "__main__":
    main()
