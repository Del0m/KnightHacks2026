Part of #50. This PR adds the data side of AI-10, not the model, so it doesn't close the issue.

It uses the AI-09 cumulative export (`labelling-export-all-bundle_a620b7b2-….json`, 2026-10-10 22:14) in three ways:

- **A loader and a learned baseline** (`ml/form_classifier/`). The evaluator scores only exercises with another training clip and exposes label coverage, imbalance and position bias. The baseline scores worse than always predicting `clean` on those scored reps.
- **A check of the phone's form rules against the human labels** (`apps/mobile/scripts/check-rule-labels.ts`). The labels mostly disagree with the rule flags.
- **One spec change from the owner's review:** the push-up `tempo` threshold drops from 800 ms to 250 ms, so a push-up of about one second (the owner's normal pace) is no longer flagged as fast lowering.

Targets `main` and includes the AI-09 capture, consent, labelling and export tooling from the closed, unmerged #124. These files provide the export schema and `preprocess.ts` required by AI-10, so this PR no longer depends on #124 being merged separately. AI-09 dataset collection targets remain incomplete. Current `main` is integrated; the push-up fixtures preserve its range/timing corrections with AI-10’s tempo threshold.

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

- **`ml/form_classifier/dataset.py`:** loads a bundle and refuses it on a checksum mismatch, inactive or disallowed consent, wrong joint shape, non-finite coordinates, missing human labels, duplicate reps, or an invalid `start_frame`. It adds position (0–1) from chronological rank within the clip, independent of export row order.
- **`ml/form_classifier/train.py`:** balanced logistic regression with leave-one-clip-out scoring, explicit unscored clips, per-class recall counts and training coverage, majority and stratified-random comparisons, plus a position-only model on the same folds and a per-clip position-bias table. One-class training folds use their sole class; bundles without eligible clips report null scores.
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

The evaluator now leaves one clip out and scores it only if training contains another clip of the same exercise. All other clips remain in training. Only the **two squat clips (10 reps)** are scored. Push-up (20 reps) and shoulder press (5 reps) are listed as unscored: **"only clip for this exercise"**. The logistic models keep `class_weight="balanced"`; no parameters were tuned on this bundle. The baseline still trains on `fast_lowering`.

| On the 10 scored reps | Accuracy | Macro-F1 |
|---|---|---|
| Summary-feature logistic regression | 0.40 | 0.22 |
| Position-only logistic regression, same folds | 0.40 | 0.24 |
| Always `clean` (majority of scored labels) | 0.70 | — |
| Stratified random, scored label proportions | 0.54 expected | 0.33 population expectation |

The scored labels are 7 `clean`, 2 `fast_lowering`, 1 `forward_lean`. Random accuracy is Σp² = 0.7² + 0.2² + 0.1² = 0.54; random macro-F1 is 1/K = 1/3, a population comparison rather than an exact finite-sample expectation. Majority and random baselines describe the scored label distribution; they are not classifiers fitted separately in each fold. Macro-F1 uses the scored truth labels (K=3 overall). The prior pooled result (0.20 accuracy, 0.11 macro-F1, 0.49 majority on 35 reps) is superseded and has a different denominator; this change does not establish an improvement.

| Scored class | Pose recall | Position-only recall | Label in training | Label in same-exercise training |
|---|---|---|---|---|
| `clean` | 4/7 | 4/7 | Yes | Yes |
| `fast_lowering` | 0/2 | 0/2 | Yes, from push-up | No |
| `forward_lean` | 0/1 | 0/1 | No | No |

The report includes per-clip recall counts and coverage flags. `in_training` means the label was available in training for every scored occurrence. `in_training_same_exercise` applies the same check within the exercise; counts record partial coverage if it differs between folds.

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

## Bias and limitations

- **One participant, self-reviewed:** every rep was labelled by the person performing it. There is no independent reviewer or participant holdout, so these numbers do not measure generalisation to another person.
- **One view per exercise:** squat is side view; push-up and shoulder press are front view. Camera-view robustness cannot be evaluated.
- **Clip/label confound:** among squat recordings, `forward_lean` appears only in `80b5ec1e` and `fast_lowering` only in `aa3ebcf8`. Holding out either removes that error label from same-exercise training. `fast_lowering` is still present globally through push-up, which is why the report distinguishes global and same-exercise label coverage. `forward_lean` is absent from training entirely in its scored fold.
- **Position confound:** labels may track recording order. Non-clean primary labels occupy push-up reps 1–13, squat `aa3ebcf8` reps 1–2, and press reps 1–2. The exception is squat `80b5ec1e`: its `forward_lean` is rep 3/5, not at the start. Position alone matches the pose model's 0.40 accuracy on the scored reps. This does not show that the pose model learns form rather than recording structure.
- **Imbalance:** the full bundle has 17 `clean`, 15 `fast_lowering`, 2 `wrists_off_stack`, 1 `forward_lean`; scored reps have 7/2/1. Balanced class weights cannot create missing examples. Both learned baselines are below the scored majority and stratified-random accuracy comparisons. `wrists_off_stack` has no scored examples, so it has no reported recall.

Position is the chronological rank by `start_frame`, divided by n−1 within each clip (singleton: 0). It is computed over exported labelled reps, not all detected repetitions. The first half uses position < 0.5, the second ≥ 0.5; with five reps, the middle rep belongs to the second half. The position-only model uses this one feature, with its scaler fitted only on training clips. The pose model does not receive position.

| Clip (exercise) | Non-clean / first half | Non-clean / second half |
|---|---|---|
| `6596070d` (push-up) | 10/10 (100%) | 3/10 (30%) |
| `aa3ebcf8` (squat) | 2/2 (100%) | 0/3 (0%) |
| `80b5ec1e` (squat) | 0/2 (0%) | 1/3 (33%) |
| `12f3520a` (shoulder press) | 2/2 (100%) | 0/3 (0%) |

These diagnostics expose the limitations of this data; they do not remove them. The next steps are more independently reviewed reps, more clips and another participant, plus the public landmark set once its licence and labels are checked. The owner's rule-check decision to disregard `fast_lowering` does not relabel or drop it from baseline training.

## Validation

Actual command output from this continuation:

```text
$ cd ml && python3 -m unittest form_classifier.tests.test_dataset
..................
----------------------------------------------------------------------
Ran 18 tests in 0.249s

OK

$ cd apps/mobile && npx jest
Test Suites: 47 passed, 47 total
Tests:       628 passed, 628 total
Snapshots:   0 total
Time:        8.754 s, estimated 14 s
Ran all test suites.

$ npx tsc --noEmit
```

TypeScript exited 0 with no output. Additional checks:

```text
$ npm run lint
✖ 8 problems (0 errors, 8 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

$ node --test specs/validate.test.mjs
ℹ tests 62
ℹ suites 8
ℹ pass 62
ℹ fail 0

$ cd apps/api && npx vitest run test/medal-parity.test.ts test/set-record-contract.test.ts
 Test Files  2 passed (2)
      Tests  163 passed (163)
```

Lint exited 0; its eight warnings are in unchanged mobile test files.

The synthetic bias tests were committed first (`95bb72e`) and run before implementation:

```text
Ran 17 tests in 0.242s
FAILED (failures=7, errors=6)
```

`test_cross_validation_reports_metrics` was **rewritten for the new output**. The tests cover unscored single-clip exercises, per-class recall counts and in-training flags, both comparisons on scored reps, planted position bias, and chronological position with shuffled rows. Additional cases cover invalid start frames, no eligible clips and one-class training folds. The committed tests passed unchanged after implementation (17 tests). A separate synthetic test for global versus same-exercise label coverage was committed first (`82a009a`), failed with a missing coverage field (18 tests, 1 error), then passed unchanged after implementation (the 18-test output above).

The real-bundle CLI ran successfully with `--out /private/tmp/ai10-pr127-bias-report.json`, outside the repo. Its results are summarised above; the raw report and bundle are not committed.

Earlier work was also test-first: the rule check, the per-label timing table, the one-label cross-clip guard, disregarding a label, and one-second push-ups passing `tempo`. The "a drop to the floor still flags" test already passed at 800 ms and guards the new threshold.

## Not included

- **Other spec changes.** The squat `tempo` threshold (800 ms, flags 8/10) and the press `lockout` target (150°, flags 5/5 in a front view) look strict on this data but are unchanged. Each needs the owner's call, and push-up and press have one clip each.
- **Baseline relabelling.** The baseline still trains on the `fast_lowering` labels.
- **The model work:** the GRU, the quality regressor, MLflow logging and the Databricks notebook swap.
- **The public landmark set:** its licence and labels are still unchecked.
- **A participant-level split.** There is one participant.

## Unchecked

- **The Databricks pipeline test** (`databricks/pipelines/steadyforum_sessions/tests/test_set_record.py`) reads the regenerated SetRecord fixtures but needs `pyspark` and `pytest`, which aren't installed locally. It wasn't run.
- **The capture rate.** It runs at about 15 fps, so lowering times come in ~67 ms steps. The 250 ms threshold sits one step under the shortest clean one-second push-up seen (267 ms in synthetic data, 333 ms in real data). A faster capture rate would measure finer, but hasn't been tried.
- **The device.** The app has not been run on a phone with the new spec.
- **The `tsx` runner.** It's fetched by `npx` at a pinned version, not added as a dependency.
