"""Cross-validated baseline for the AI-10 form-quality model, trained on an AI-09 export bundle.

Usage (keep the bundle outside the repo):

    python -m form_classifier.train --bundle ~/Downloads/labelling-export-all-bundle_<id>.json \
        --out ~/Downloads/ai10-report.json

The model is a standardised logistic regression on summary rep features (dataset.features). It is a
baseline to measure the data against, not the final AI-10 model. Folds are grouped by clip, so reps
from the same recording never sit in both train and test. The bundle has one participant, so
participant-level generalisation is not measured.
"""

import argparse
import json
from typing import Dict

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from form_classifier.dataset import Bundle, features, load_bundle

SEED = 7
MAX_FOLDS = 5


def build_model() -> object:
    return make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED),
    )


def cross_validate(bundle: Bundle) -> Dict[str, object]:
    """Return out-of-fold accuracy and macro-F1 next to a majority-class baseline."""
    X = np.stack([features(rep) for rep in bundle.reps])
    y = np.array([rep.label for rep in bundle.reps])
    groups = np.array([rep.clip_id for rep in bundle.reps])

    n_folds = min(MAX_FOLDS, len(set(groups)))
    if n_folds < 2:
        raise ValueError("need at least two clips to cross-validate")

    predictions = np.empty_like(y)
    for train_idx, test_idx in GroupKFold(n_splits=n_folds).split(X, y, groups):
        model = build_model()
        model.fit(X[train_idx], y[train_idx])
        predictions[test_idx] = model.predict(X[test_idx])

    majority = max(set(y.tolist()), key=y.tolist().count)
    baseline = np.array([majority] * len(y))
    return {
        "folds": n_folds,
        "accuracy": float(accuracy_score(y, predictions)),
        "macro_f1": float(f1_score(y, predictions, average="macro", zero_division=0)),
        "majority_baseline_accuracy": float(accuracy_score(y, baseline)),
        "majority_label": majority,
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
