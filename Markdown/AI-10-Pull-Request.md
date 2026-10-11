Part of #50. This PR adds the data side of AI-10, not the model, so it doesn't close the issue.

It uses the AI-09 cumulative export (`labelling-export-all-bundle_a620b7b2-….json`, 2026-10-10 22:14) in three ways:

- **A loader and a learned baseline** (`ml/form_classifier/`). The baseline scores worse than always predicting `clean`.
- **A check of the phone's form rules against the human labels** (`apps/mobile/scripts/check-rule-labels.ts`). The labels mostly disagree with the rule flags.
- **One spec change from the owner's review:** the push-up `tempo` threshold drops from 800 ms to 250 ms, so a push-up of about one second (the owner's normal pace) is no longer flagged as fast lowering.

Stacked on #124 (`codex/ai09-labelling`), which provides the export schema and `preprocess.ts`. Retarget to `main` once #124 merges.

## The data

| | |
|---|---|
| Reps | 35, all from one consenting participant (`consent_2b9637cb-…`, active, allowed for training) |
| Clips | 4 labelled: squat ×2 (side), push-up ×1 (front), shoulder press ×1 (front). 2 more clips have no labels. |
| Labels (primary) | 17 `clean`, 15 `fast_lowering`, 2 `wrists_off_stack`, 1 `forward_lean`. One press rep also carries `incomplete_lockout`. |
| Reviewer | The participant, on every rep, so no label has a second opinion |
| Not covered | Bicep curl and lunge |

The owner has since disregarded the 15 `fast_lowering` labels. The rule check sets them aside, while the other labels on those reps still count.

No bundle, report or participant data is committed. All tests use synthetic data.

## Changes

- **`ml/form_classifier/dataset.py`:** loads a bundle and refuses it on a checksum mismatch, inactive or disallowed consent, wrong joint shape, non-finite coordinates, missing human labels, or duplicate reps.
- **`ml/form_classifier/train.py`:** a logistic-regression baseline with clip-grouped folds, meant as a yardstick for the data.
- **`apps/mobile/src/engine/__fixtures__/labelCheck.ts`:** the rule check. It:
  - replays each export clip through the real engine and rules, the way the labelling screen does (current spec, the clip's recorded view, set ended after the last frame);
  - maps engine reps to frames the way capture does, and pairs them with the human reps one to one (frame IoU ≥ 0.5);
  - scores each rule against its label, and finds the threshold range, if any, that separates the labels;
  - for exercises with more than one clip, fits a threshold on one clip and tests it on the other;
  - can disregard a label; the rule for that label is then shown but not scored.
- **`apps/mobile/scripts/check-rule-labels.ts`:** runs the check on a bundle path (`--ignore-label <label>`, repeatable) and writes a Markdown report outside the repo.
- **`specs/exercises/push_up.json`:**
  - The `tempo` threshold drops from 800 to 250 ms. At about 15 fps, a clean one-second push-up can measure 267 ms of lowering, and a drop to the floor measures 133–200 ms.
  - The rest note drops its 2 s target and now reads "A steady lowering gives you more control."
  - The shoulder override stays at 1200 ms.
- **Fixtures:**
  - The two push-up synthetic clips (`push_up_lockout`, `push_up_hip_sag`) no longer list `tempo` flags. Their reps lower over 0.6 s.
  - Their committed clip JSON and `specs/set-record/fixtures/valid/SetRecord/` records are regenerated. The only change is the removed `tempo` flags.
- **Docs:**
  - Architecture §6.3, the AI-10 issue and the Databricks stub comment.
  - `Markdown/AI-10-Handoff.md`, including the owner's decisions and the results below.
  - `ml/form_classifier/README.md`.

## Results

### Learned baseline

With 4 clip-grouped folds, out-of-fold accuracy is **0.20** and macro-F1 **0.11**. Always predicting `clean` scores **0.49**. That's expected from 35 reps, 4 clips and one participant. Nothing was tuned toward a better number, and this run still includes the `fast_lowering` labels.

### Rules against the labels (`fast_lowering` disregarded, new push-up threshold)

All 35 labelled reps match an engine rep. On squat and press, the replay flags the same rules as the capture-time suggestions on every rep. On push-ups it differs on all 22 reps, because capture ran with the old 800 ms threshold.

| Exercise | Rule (label) | Flagged | Precision | Recall | What the values show |
|---|---|---|---|---|---|
| push-up | `tempo` | 0/20 (was 20/20) | — | — | Lowering takes 333–534 ms at the owner's ~1 s pace; the threshold is now 250 ms. |
| push-up | `depth` (`partial_range`) | 2/20 | 0/2 | — | Flags 2 reps that nobody labelled `partial_range`. |
| squat | `tempo` | 8/10 | — | — | Unchanged at 800 ms. Lowering takes 0–866 ms. |
| squat | `trunk_lean` (`forward_lean`) | 3/10 | 0/3 | 0/1 | The labelled rep leans 36.4°, inside the 26–50° range of the others. |
| press | `lockout` (`incomplete_lockout`) | 5/5 | 1/5 | 1/1 | Peak elbow angle is 140–150° against a 150° target, front view. |
| press | `wrist_stack` (`wrists_off_stack`) | 0/5 | — | 0/2 | Forearm tilt is 20.5–27.2° on labelled reps and 18.6–29.1° on clean ones, so the two overlap. |

`hip_sag`, `back_arch` and `knee_tracking` aren't judged, because these clips were recorded in the other view.

## Validation

```
$ cd ml && python3 -m unittest form_classifier.tests.test_dataset
Ran 9 tests in 0.074s
OK

$ cd apps/mobile && npx jest
Test Suites: 47 passed, 47 total
Tests:       628 passed, 628 total

$ npx tsc --noEmit    # exit 0

$ node --test specs/validate.test.mjs
ℹ pass 62
ℹ fail 0

$ cd apps/api && npx vitest run test/medal-parity.test.ts test/set-record-contract.test.ts
Test Files  2 passed (2)
     Tests  163 passed (163)

$ npx --yes tsx@4.19.2 scripts/check-rule-labels.ts <export> <report outside repo> --ignore-label fast_lowering
```

Each behaviour was test-first: the tests were committed and shown failing, then implemented with the tests unchanged. That covers the rule check, the per-label timing table, the one-label cross-clip guard, disregarding a label, and one-second push-ups passing `tempo`. The "a drop to the floor still flags" test already passed at 800 ms and guards the new threshold.

## Not included

- **Other spec changes.** The squat `tempo` threshold (800 ms, flags 8/10) and the press `lockout` target (150°, flags 5/5 in a front view) look strict on this data but are unchanged. Each needs the owner's call, and push-up and press have one clip each.
- **Baseline relabelling.** The baseline still trains on the `fast_lowering` labels.
- **The model work:** the GRU, the quality regressor, MLflow logging and the Databricks notebook swap.
- **The public landmark set:** its licence and labels are still unchecked.
- **A participant-level split.** There is one participant.

## Unchecked

- **The Databricks pipeline test** (`databricks/pipelines/spotter_sessions/tests/test_set_record.py`) reads the regenerated SetRecord fixtures but needs `pyspark` and `pytest`, which aren't installed locally. It wasn't run.
- **The capture rate.** It runs at about 15 fps, so lowering times come in ~67 ms steps. The 250 ms threshold sits one step under the shortest clean one-second push-up seen (267 ms in synthetic data, 333 ms in real data). A faster capture rate would measure finer, but hasn't been tried.
- **The device.** The app has not been run on a phone with the new spec.
- **The `tsx` runner.** It's fetched by `npx` at a pinned version, not added as a dependency.
