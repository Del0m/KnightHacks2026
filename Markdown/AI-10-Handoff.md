# AI-10 handoff: form-quality model without new capture

Written for: a senior ML engineer picking up AI-10 cold. Read this, then `Architecture.md` §6.3, §8, §13 and §18, then `databricks/notebooks/form_model.py`.

## The task

Train the per-rep form-quality model (AI-10) without any new data collection at the hackathon. The model gives each rep a quality score in 0–1 and a label. It is advisory: rule flags on the phone decide "clean", the form score and the medal (Architecture §8). Your job is the model, its data and its evaluation, not the medal logic.

## Hard constraints

- **Joints only.** Inputs are joint positions. No video or frames are used for training (§13). Do not add any path that stores or uploads video.
- **Consent.** The only human-captured data is the AI-09 pilot, from one consenting participant (`consent_2b9637cb-…`, status active, allowed use true). Do not use anything else that a person has not consented to. Public data must be checked for license before use.
- **No Hub publication of data or the model** until the license check passes (see the open checks below).
- **Input shape** is fixed by §6.3: one rep resampled to 32 frames × 17 joints × 2 (normalised, x scaled by image aspect). The pilot already uses this preprocessing (`aspect-time-linear-v1`, in `ml/labelling/src/preprocess.ts`). Reuse it exactly, or the public data will not line up.

## What data exists

| Source | Status | Size | Notes |
|---|---|---|---|
| AI-09 cumulative export | `~/Downloads/labelling-export-all-bundle_a620b7b2-….json` (2026-10-10 22:14). It supersedes the earlier `ai09-pilot-2026-10-10/` folder (5 reps) and the 17:43 bundle, whose 5 reps are a subset of it. | **35 reps, 4 clips, one participant**: squat 10, push-up 20, shoulder press 5. Labels: 17 `clean`, 15 `fast_lowering`, 2 `wrists_off_stack`, 1 `forward_lean`. Bicep curl and lunge: none. | Human-labelled, with boundaries. Checksums are verified by `ml/form_classifier/dataset.py`. Too small to train a good model on; it is the first real labelled set, so use it for training experiments and cross-validation, not for claims. |
| Public landmark set | `Cuong2004/gym-exercise-landmarks` on Hugging Face | Unknown | **Not yet checked.** The licence, the exercises covered, the joint format (MediaPipe 33-point) and whether it has any form-error labels are all unknown. See open checks. |
| Rule flags on the phone | Produced by the rule engine (`specs/exercises/`), stored in `spotter.raw.silver_reps` | Any sessions in the app's Databricks tables | Used as labels only where no human label exists. |

The pilot's `manifest.json` records the remaining deficit: 35 squat, and 40 each for push-up, bicep curl, shoulder press and lunge. That collection is no longer planned for the hackathon.

## Open checks (do these first)

1. **Landmark set licence.** Open the dataset card on Hugging Face and read the licence in the README YAML. If it is research-only or unclear, do not publish models trained on it. Internal evaluation is the most we can claim.
2. **Landmark set labels.** Find out whether the set has form-error labels. Three cases:
   - **Human form labels exist:** use them as targets. This is the best case.
   - **Only exercise identity:** there are no quality labels. Every training target then comes from the rule flags, and the model learns to reproduce the rules. Say so in the model card. It is still an honest advisory score, but it is not a learned judgement of form.
   - **Unusable format:** drop it. Train on the pilot alone, which is too small to be useful, so the honest outcome is "rules only, model not evaluated".
3. **Joint format.** If the set is MediaPipe 33-point, map it to the 17 COCO joints (nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles). Document the mapping. Mismatched joint order will silently ruin the model.

## Target and label rules

- Quality target: the human quality score where one exists. Otherwise, `1.0` for a rep with no rule flags and a lower value for flagged reps. Write the exact formula into the model card. Do not invent a formula you cannot justify.
- Label target: `clean`, or the first failing rule in this order, matching `label_for` in `form_model.py`: `partial_range`, `knees_in`, `forward_lean`, `fast_lowering`. Extend the list to the other rule ids in the specs only if the data has them.
- Mark every label as `human` or `rule_derived` in the dataset. Report metrics separately for each.

## Model

- Keep the existing `train_models` interface in `form_model.py`: it returns a label classifier and a quality regressor, both pipelines with one-hot `exercise_id`. Replace the internals, not the signature.
- Options: a small GRU over the 32×17×2 input (matches §6.3), or the gradient-boosted baseline already in the stub. Start with the baseline, since it is already wired to MLflow and the registry. Move to a GRU only if the baseline is clearly weak and time allows.
- The model must stay convertible to ONNX (CONN-10). Do not use native categorical splits.

## Evaluation

- **Split by participant**, not by rep. The notebook already uses `GroupShuffleSplit` on user. Keep reps from one person out of train when they are in test.
- Report **held-out accuracy per exercise** and overall, with a macro-F1 for the label. Exercises with too few labelled reps are reported as **not evaluated**, not averaged in.
- Report the agreement between the model's `clean` and the phone's rule `clean` on the pilot. This is the number the demo will rely on.
- Log to MLflow (CONN-04) with the data sources, label provenance counts and licence status as params or tags.

## First baseline (cumulative export, 35 reps)

`ml/form_classifier/train.py`, standardised logistic regression on summary features, 4 clip-grouped folds:

- Out-of-fold accuracy **0.20**, macro-F1 **0.11**, against a majority-class baseline of **0.49** (always `clean`).
- The baseline is worse than predicting `clean` every time. With 35 reps, 4 clips, one participant and classes of 1 and 2 examples, this is what the data supports. It is not a model result to show anyone.
- The next steps are data (more labelled reps, more clips, a second participant, and the landmark set once checked), not model tuning on these folds.

## Rules against the human labels (same export)

`apps/mobile/scripts/check-rule-labels.ts` replays each labelled clip through the phone's engine and rules (current specs, the clip's recorded view). It pairs engine reps with the human reps by frame overlap and reports agreement per rule. Run it from `apps/mobile`:

```sh
npx --yes tsx@4.19.2 scripts/check-rule-labels.ts <bundle> <report.md> --ignore-label fast_lowering
```

Keep the report outside the repo.

**Decisions from the owner (2026-10-10):**

- **The `fast_lowering` labels in this export are disregarded.** The other labels on those reps still count. In the push-up clip, lowering time did not separate the reps labelled `fast_lowering` (334–534 ms) from those labelled `clean` (333–401 ms).
- **A push-up of about one second is the owner's normal pace.** At that pace the push-up `tempo` rule (lowering from 150° to the bottom) measured 333–534 ms against an 800 ms threshold, so it flagged every rep. The threshold is now **250 ms**. At about 15 fps lowering times come in ~67 ms steps, and a clean one-second push-up can measure 267 ms, so 250 is the step below that. A drop to the floor (133–200 ms) still flags. The rest note no longer gives a 2 s target, and the shoulder override stays at 1200 ms.

**Results with those decisions:**

- **Matching:** all 35 labelled reps match an engine rep. On squat and press, the replay flags the same rules as the capture-time suggestions on every rep, so the replay is faithful. On push-ups it differs on all 22 reps, because capture used the old 800 ms threshold.
- **Push-up `tempo`** flags 0/20 (it flagged 20/20 before).
- **Squat `tempo`** still flags 8/10 at its 800 ms threshold, with lowering at 0–866 ms. That threshold is unchanged and may have the same problem as the push-up one did.
- **Shoulder press `lockout` (`incomplete_lockout`)** flags all 5 reps (precision 1/5). Peak elbow angle is 140–150° against a 150° target in this front view.
- **`wrist_stack` (`wrists_off_stack`)** flags neither labelled rep. Forearm tilt overlaps between the labelled reps (20.5–27.2°) and the clean ones (18.6–29.1°).
- **Squat `trunk_lean` (`forward_lean`)** flags 3 reps, none of them the labelled one (36.4°, inside the 26–50° range of the others).
- **Push-up `depth`** flags 2 reps that nobody labelled `partial_range`.
- **Not judged for view:** `hip_sag`, `back_arch` and `knee_tracking` are judged only in the view these clips weren't recorded in.

**What this supports:** only the push-up `tempo` change, which rests on the owner's stated pace, not on fitting the labels. Push-up and press each have one clip, so a threshold fitted to them can't be checked on another clip. Every label is the participant's own, with no second opinion. Still open: the squat `tempo` threshold, and whether the press `lockout` target suits a front view.

## What to deliver

1. A training run in MLflow with the metrics above, registered as `spotter.ml.form_quality`.
2. A dataset card (even if internal) stating: sources, licences, the label provenance split, exercises covered, the preprocessing version, and the consent reference for the pilot.
3. An updated `form_model.py` `train_models` (the stub comment at the top is already updated).
4. A short note on the held-out numbers, written plainly. If an exercise has no real labels, say so.

## What not to do

- Do not add a capture flow, a video path, or a new consent-collection step.
- Do not describe rule-derived labels as independent human judgements, in the notebook, the card, the Space or the pitch.
- Do not let the model decide "clean", the form score or the medal. Those stay with the rules (§8).
- Do not publish the pilot joints or the model to the Hub without the consent and licence checks above.

## Related files

- `Architecture.md` §6.3 (model and data), §8 (what counts as clean), §13 (privacy), §17 step 6 (demo line), §18 (risks)
- `issues/issues.json` AI-10 entry (updated for this plan)
- `databricks/notebooks/form_model.py` (CONN-04 stub that AI-10 replaces)
- `ml/labelling/src/preprocess.ts` and `ml/labelling/src/export.ts` (the preprocessing and export that produce the pilot's training rows)
- `Markdown/AI-09-Labelling.md` (what the pilot export contains and how it was checked)
