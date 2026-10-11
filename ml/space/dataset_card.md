---
license: cc-by-4.0
pretty_name: Spotter form reps
tags:
  - time-series-classification
  - pose-estimation
  - fitness
  - exercise
  - form-feedback
  - synthetic
size_categories:
  - 1K<n<10K
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/train.parquet
      - split: test
        path: data/test.parquet
---

# Spotter form reps

Rep-level body-pose windows from **Spotter**, a phone app that counts reps and checks form for people getting back to the gym after an injury (KnightHacks 2026). Each row is one rep of a gym exercise as 32 frames of 17 body joints, with the form rules' verdict as a label. It's the training data for Spotter's form-quality model ([`bubblesmal/spotter-models`](https://huggingface.co/bubblesmal/spotter-models), `form/`).

**There is no video and no real person in this dataset.** The current release is entirely synthetic (see *Collection*).

## At a glance

| Split | Reps | Lifters | Labels |
|---|---|---|---|
| train | 7,102 | 24 | clean 6,993 · partial_range 109 |
| test | 1,864 | 7 | clean 1,784 · partial_range 77 · fast_lowering 3 |

Exercises: bicep curl (1,773), shoulder press (1,742), push-up (1,432), squat (1,218), lunge (937). Levels: beginner, intermediate and advanced. Splits are **by lifter** (a stable hash of the lifter id), so no lifter appears in both.

## Columns

| Column | Type | Meaning |
|---|---|---|
| `rep_id` | string | Unique rep id |
| `lifter_id` | string | Pseudonymous lifter id (HMAC). Use it to group reps by person |
| `session_date` | string | `YYYY-MM-DD` |
| `exercise_id` | string | `squat`, `lunge`, `push_up`, `shoulder_press` or `bicep_curl` |
| `experience_level` | string | `beginner`, `intermediate` or `advanced` |
| `frame_count` | int | Frames the rep originally had, before resampling |
| `window` | 32 × 34 floats | The rep resampled to 32 frames (nearest frame). Each frame is the 17 COCO keypoints as `x0, y0, x1, y1, …`, **centred on the mid-hip and divided by torso length**, so it doesn't depend on where the lifter stood or how far the camera was |
| `flags` | list of strings | Form rules that failed on this rep (e.g. `depth`, `tempo`) |
| `label` | string | `clean` (no flags) or the first matching flag's label: `partial_range` (depth), `knees_in` (knee tracking), `forward_lean` (trunk lean), `fast_lowering` (tempo), else `other` |

Keypoint order is COCO: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles (left before right).

```python
from datasets import load_dataset
import numpy as np

ds = load_dataset("bubblesmal/spotter-form-reps")
x = np.array(ds["train"][0]["window"]).reshape(32, 17, 2)   # frames x joints x (x, y)
```

## Collection

1. **Sessions.** A generator notebook (`databricks/notebooks/generate_synthetic_sessions.py` in the Spotter repo) writes six weeks of workouts for 30 synthetic lifters in exactly the format the app uploads: per-rep aggregates plus per-frame joints. Joint positions come from a simple body model driven by each exercise's joint-angle curve, with noise and lifter-to-lifter variation. Three lifters follow a knee or shoulder recovery story.
2. **Pipeline.** A Databricks medallion pipeline (bronze → silver → gold) parses the uploads, cuts the frames into reps, normalises the joints and resamples each rep to 32 frames (`gold_training_features`).
3. **Labels.** Each rep is labelled by Spotter's **form rules** (the same spec-driven rules the app runs on the phone), not by people. They're weak labels: consistent, but only as good as the rules.

## Limitations

- **Synthetic only.** Real movement is messier than the generator: occlusion, odd camera angles, loose clothing and lighting don't appear here. Don't expect a model trained on this alone to work on real video.
- **Heavily imbalanced.** About 98% of reps are `clean`, and `knees_in` and `forward_lean` don't occur yet. A classifier trained on this will mostly learn "clean". Weight the classes or treat it as anomaly detection.
- **Rule labels.** The labels reproduce the rules, so a model trained on them can at best match the rules.

## Roadmap

A `recorded` config will add real, consented recordings of team members doing clean and deliberately off-form reps, labelled by hand (joints only, no video). That's the data that fixes the imbalance.

## License and privacy

CC BY 4.0. No images or video. Lifter ids are pseudonyms of synthetic accounts. Spotter never uploads video, only joints, and only under a pseudonymous id.
