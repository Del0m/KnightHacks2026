# AI-10 form-quality data and baseline

Loads an AI-09 labelling export bundle, checks it, and runs leave-one-clip-out baselines with bias diagnostics. Brief for the full model: `Markdown/AI-10-Handoff.md`.

## Run

```sh
cd ml
pip install -r form_classifier/requirements.txt
python3 -m unittest form_classifier.tests.test_dataset -v
python3 -m form_classifier.train --bundle /path/to/labelling-export-all-bundle_<id>.json --out /path/to/report.json
```

Keep the bundle and the report outside the repo. Participant data and consent evidence must never be committed. The tests use synthetic bundles only.

## Checking the rules against the labels

The rule check reuses the phone's engine, so it lives in `apps/mobile`:

```sh
cd apps/mobile
npx jest src/engine/__tests__/labelCheck.test.ts
npx --yes tsx@4.19.2 scripts/check-rule-labels.ts /path/to/labelling-export-all-bundle_<id>.json /path/to/rule-report.md --ignore-label fast_lowering
```

## What the loader checks

- Checksums for `training_jsonl` and `clips_jsonl` match the manifest.
- Every rep's consent is in the manifest, active, allowed for training, and belongs to the rep's participant.
- Joints are 32 × 17 × 2, finite, and use `aspect-time-linear-v1`.
- Every rep has a human label and a known exercise, each `rep_id` appears once, and `start_frame` is a non-negative integer.

A failed check raises `BundleError` naming the rep or field. Nothing is skipped silently.

## Evaluation and report

`Rep.position` is chronological rank by `start_frame`, divided by n−1 within its clip (singleton: 0). Equal starts are ordered by `rep_id`, independently of input row order. Position is not added to the pose features.

Each held-out clip is scored only if training has another clip of its exercise. Training uses all other clips. The summary-feature and position-only models use identical folds, train-only scaling and balanced logistic regression. A one-class fold predicts its sole training class. Unscorable clips are listed with the reason "only clip for this exercise"; if none can be scored, metrics are null.

The JSON `cross_validation` object reports:

- `scored_reps`, eligible `folds`, accuracy and macro-F1 over scored truth labels.
- `clips`, including training clip IDs and labels, metrics and per-class recall counts (`k/n`).
- `per_class` aggregate recall counts, `in_training` and `in_training_same_exercise` flags, and counts of scored reps whose label was available in each kind of training. Aggregate flags are true only when coverage is complete.
- `majority_baseline_accuracy` and stratified-random expected accuracy Σp² and population macro-F1 1/K, using scored label proportions. These are descriptive comparisons, not fold-fitted classifiers or exact finite-sample random macro-F1 expectations.
- `position_only` metrics on the same scored reps and per-clip `position_bias`: non-clean primary-label share at position < 0.5 versus ≥ 0.5 (the middle of an odd-length clip goes in the second half).

The baseline retains `fast_lowering`; only the rule check disregards it. For the current bundle, only 10 squat reps are scored. Pose and position-only accuracy are both 0.40; majority accuracy is 0.70. See the handoff for bias and limitations. These are data diagnostics, not evidence of participant or camera-view generalisation.

## Not in this change

- The model is a logistic regression baseline, not the GRU or the MLflow-registered model. The Databricks notebook (`databricks/notebooks/form_model.py`) is unchanged.
- No quality regressor yet.
- No participant-level split: the current bundle has one participant.
