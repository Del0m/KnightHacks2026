# AI-10 form-quality data and baseline

Loads an AI-09 labelling export bundle, checks it, and runs a grouped cross-validation baseline. Brief for the full model: `Markdown/AI-10-Handoff.md`.

## Run

```sh
cd ml
pip install -r form_classifier/requirements.txt
python3 -m unittest form_classifier.tests.test_dataset -v
python3 -m form_classifier.train --bundle /path/to/labelling-export-all-bundle_<id>.json --out /path/to/report.json
```

Keep the bundle and the report outside the repo. Participant data and consent evidence must never be committed. The tests use synthetic bundles only.

## What the loader checks

- Checksums for `training_jsonl` and `clips_jsonl` match the manifest.
- Every rep's consent is in the manifest, active, allowed for training, and belongs to the rep's participant.
- Joints are 32 × 17 × 2, finite, and use `aspect-time-linear-v1`.
- Every rep has a human label and a known exercise, and each `rep_id` appears once.

A failed check raises `BundleError` naming the rep or field. Nothing is skipped silently.

## Not in this change

- The model is a logistic regression baseline, not the GRU or the MLflow-registered model. The Databricks notebook (`databricks/notebooks/form_model.py`) is unchanged.
- No quality regressor yet.
- No participant-level split: the current bundle has one participant.
