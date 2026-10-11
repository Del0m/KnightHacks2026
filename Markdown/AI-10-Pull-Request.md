Part of #50. This PR adds the data side of AI-10, not the model, so it doesn't close the issue.

It uses the AI-09 cumulative export (`labelling-export-all-bundle_a620b7b2-….json`, 2026-10-10 22:14) in two ways:

- **A loader and a learned baseline** (`ml/form_classifier/`). The baseline scores worse than always predicting `clean`.
- **A check of the phone's form rules against the human labels** (`apps/mobile/scripts/check-rule-labels.ts`). The labels mostly disagree with the rule flags. No spec values are changed.

Stacked on #124 (`codex/ai09-labelling`), which provides the export schema and `preprocess.ts`. Retarget to `main` once #124 merges.

## The data

| | |
|---|---|
| Reps | 35, all from one consenting participant (`consent_2b9637cb-…`, active, allowed for training) |
| Clips | 4 labelled: squat ×2 (side), push-up ×1 (front), shoulder press ×1 (front). 2 more clips have no labels. |
| Labels (primary) | 17 `clean`, 15 `fast_lowering`, 2 `wrists_off_stack`, 1 `forward_lean`. One press rep also carries `incomplete_lockout`. |
| Reviewer | The participant, on every rep, so no label has a second opinion |
| Not covered | Bicep curl and lunge |

No bundle, report or participant data is committed. All tests use synthetic data.

## Changes

- **`ml/form_classifier/dataset.py`:** loads a bundle and refuses it on a checksum mismatch, inactive or disallowed consent, wrong joint shape, non-finite coordinates, missing human labels, or duplicate reps.
- **`ml/form_classifier/train.py`:** a logistic-regression baseline with clip-grouped folds, meant as a yardstick for the data.
- **`apps/mobile/src/engine/__fixtures__/labelCheck.ts`:** the rule check. It:
  - replays each export clip through the real engine and rules, the way the labelling screen does (base spec, the clip's recorded view, set ended after the last frame);
  - maps engine reps to frames the way capture does, and pairs them with the human reps one to one (frame IoU ≥ 0.5);
  - scores each rule against its label, and finds the threshold range, if any, that separates the labels;
  - for exercises with more than one clip, fits a threshold on one clip and tests it on the other.
- **`apps/mobile/scripts/check-rule-labels.ts`:** runs the check on a bundle path and writes a Markdown report outside the repo.
- **Docs:**
  - Architecture §6.3, the AI-10 issue and the Databricks stub comment.
  - `Markdown/AI-10-Handoff.md`, including both results below.
  - `ml/form_classifier/README.md`.

## Results

### Learned baseline

With 4 clip-grouped folds, out-of-fold accuracy is **0.20** and macro-F1 **0.11**. Always predicting `clean` scores **0.49**. That's expected from 35 reps, 4 clips and one participant, and nothing was tuned toward a better number.

### Rules against the labels

All 35 labelled reps match an engine rep. On the 37 engine reps in these clips, the replay flags the same rules as the capture-time suggestions every time.

| Exercise | Rule (label) | Flagged | Precision | Recall | What the values show |
|---|---|---|---|---|---|
| push-up | `tempo` (`fast_lowering`) | 20/20 | 13/20 | 13/13 | Lowering takes 334–534 ms when labelled fast and 333–401 ms when labelled clean, all under the 800 ms threshold. No threshold separates the two. |
| push-up | `depth` (`partial_range`) | 2/20 | 0/2 | — | Flags 2 reps that nobody labelled `partial_range`. |
| squat | `tempo` (`fast_lowering`) | 8/10 | 2/8 | 2/2 | Fitted on the clip with both labels (≥ 634 ms), it gets 4/5 on the other clip. |
| squat | `trunk_lean` (`forward_lean`) | 3/10 | 0/3 | 0/1 | The labelled rep leans 36.4°, inside the 26–50° range of the others. |
| press | `lockout` (`incomplete_lockout`) | 5/5 | 1/5 | 1/1 | Peak elbow angle is 140–150° against a 150° target, front view. |
| press | `wrist_stack` (`wrists_off_stack`) | 0/5 | — | 0/2 | Forearm tilt is 20.5–27.2° on labelled reps and 18.6–29.1° on clean ones, so the two overlap. |

`hip_sag`, `back_arch` and `knee_tracking` aren't judged, because these clips were recorded in the other view.

## Validation

```
$ cd ml && python3 -m unittest form_classifier.tests.test_dataset
Ran 9 tests in 0.074s
OK

$ cd apps/mobile && npx jest src/engine/__tests__/labelCheck.test.ts
Tests:       17 passed, 17 total

$ npx jest
Test Suites: 47 passed, 47 total
Tests:       624 passed, 624 total

$ npx tsc --noEmit    # exit 0

$ npx --yes tsx@4.19.2 scripts/check-rule-labels.ts <export> <report outside repo>
```

The rule-check tests were committed first and shown failing (missing module), then implemented with the tests unchanged. The same was done for the per-label timing table and the one-label cross-clip guard.

## Not included

- **Spec threshold changes.** Push-up and press have one clip each, so any new threshold can't be checked on a second clip. The push-up labels also don't follow lowering time.
- **The model work:** the GRU, the quality regressor, MLflow logging and the Databricks notebook swap.
- **The public landmark set:** its licence and labels are still unchecked.
- **A participant-level split.** There is one participant.

## Unchecked

- **Label consistency.** In the push-up clip, reps 1–13 are labelled `fast_lowering` and reps 14–20 `clean`, but their lowering times overlap. Either the label reflects something other than lowering time, or it isn't consistent. A second reviewer would settle which.
- **The capture rate.** It runs at about 15 fps, so lowering times are quantised to roughly 67 ms. One squat rep measures 0 ms of lowering, probably a frame-rate artefact.
- **The `tsx` runner.** It's fetched by `npx` at a pinned version, not added as a dependency.
