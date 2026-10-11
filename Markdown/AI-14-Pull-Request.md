Closes #54.

This adds the injury-risk model: an XGBoost classifier in `databricks/notebooks/risk_model.py` that forecasts whether the heuristic injury-risk flag will be raised for a lifter and body part in the next 7 days. It runs daily on serverless after the `steadyforum_sessions` pipeline. It:
- logs each run to MLflow, with the heuristic's own score as a baseline
- keeps a champion run
- scores every lifter's latest day
- writes the scores, feature importance and test metrics to gold tables

The Neon sync now reads the model scores first and falls back to the heuristic. An AI/BI dashboard shows the trends and the importance.

It's a **training-load and form-trend score, not a diagnosis**, and its labels are heuristic (Architecture §11.2). Every output table says so in its comment.

The heuristic and the model now share one range definition: range uses the injured side when it's known (`gold.py`). The synthetic generator now produces lifters whose injured side declines, so the heuristic flag has positives to forecast.

Branched from `main` at `033bcf2`. Built in a separate worktree, so the AI-09 labelling checkout was not touched.

## What it produces

| Output | Where | Contents |
|---|---|---|
| Model | MLflow experiment `/Users/<owner>/steadyforum_injury_risk`, artifact `runs:/<run_id>/model` | XGBoost 2.1.3 classifier with a signature and input example. The champion is the run tagged `champion=true`. |
| `steadyforum.gold.gold_injury_risk_model_scores` | Notebook, overwritten daily | One row per lifter × body part (latest day): `score` (0–1, prior-corrected), `top_features`, `model_version` (champion run id), `scored_at` |
| `steadyforum.gold.gold_risk_feature_importance` | Notebook, overwritten daily | Gain per feature and family, ranked, for the champion |
| `steadyforum.gold.gold_risk_model_metrics` | Notebook, overwritten daily | Two rows, `model` and `heuristic`: test ROC-AUC, PR-AUC, Brier, test positives and rows |
| `range_side` on `gold_injury_risk_scores` | Pipeline | `injured` when the lifter's injured side is known, else `min` |
| Risk scores in Neon `risk_insights` | `syncInsights.ts` | Model scores when fresh, heuristic scores otherwise |
| Dashboard "SteadyForum: injury-risk trends" | `databricks/dashboards/injury_risk.lvdash.json` | Importance by family, model vs heuristic metrics, model score distribution by body part, share of lifters with a heuristic score ≥ 0.5 per week, a "not a diagnosis" note |

## Changes

- **`databricks/notebooks/risk_model.py` (new).** The full contract is in `docs/superpowers/specs/2026-10-10-injury-risk-model-design.md`.
  - **Label:** whether the heuristic flag (`weak_label`) is raised on any tracked day in (D, D+7]. Rows without 7 days of later data are scored but not trained on. A same-day label would let the model relearn the rule.
  - **Features:** the 7- and 28-day flag rate, range, lowering time and their changes, plus asymmetry, `acwr`, `volume_7d` and a one-hot body part. They're grouped into the five families `explainRisk()` already knows: `flag_rate_rising`, `range_shrinking`, `asymmetry`, `acute_chronic_load` and `tempo_speeding_up`.
  - **Split:** by lifter, 80/20, so no lifter is in both.
  - **Training:** `scale_pos_weight` = negatives / positives. Scores are prior-corrected (`p / (p + (1 − p) · spw)`) so they read as probabilities at the real class balance.
  - **Evaluation:** ROC-AUC, PR-AUC and Brier for the model **and for the heuristic score used as next week's predictor**, plus the PR-AUC lift.
  - **Single-class guard:** if either split has a single class, training is skipped and the run is tagged `insufficient_labels`. The existing champion still scores, then the job fails so the skip shows up.
  - **`top_features`:** up to 3 families whose summed XGBoost contribution is ≥ 0.01, largest first.
  - **Champion:** a run tag, moved only when the new test PR-AUC is at least the champion's.
  - **Unity Catalog:** registration of `steadyforum.ml.injury_risk` is opt-in (`register_uc` widget, default `false`). A failure tags the run `uc_registration=skipped` with the reason and deletes the `PENDING_REGISTRATION` version it left. When registration works, the `champion` alias follows.
  - **Model logging:** `log_model` uses `artifact_path`, since serverless runs MLflow 2.x.
  - **Table comments:** escaped, and every output table's comment ends "Not a diagnosis."
- **`databricks/notebooks/risk_model.job.json` (new).** A daily serverless job at 05:00 UTC: refresh the pipeline (one retry), then train and score (no retries).
- **`databricks/dashboards/injury_risk.lvdash.json` (new).** The AI/BI dashboard "SteadyForum: injury-risk trends", built in the workspace and exported. It reads the three notebook tables and the heuristic history in `gold_injury_risk_scores`.
- **`databricks/pipelines/steadyforum_sessions/gold.py` (CONN-03).**
  - `gold_injury_risk_scores` takes range from the injured side when `silver_reps.injured_side` knows it, and from the smaller side otherwise.
  - The side is resolved once per lifter and body part, from the latest session that names it, so a tag that comes or goes mid-window can't mix sides in the 7- and 28-day ranges.
  - New column `range_side`. The table comment says which range is used.
- **`databricks/setup.sql` (CONN-03).** `GRANT SELECT` on the three new tables for the API's service principal. They fail until the notebook has run once.
- **`apps/api/src/jobs/syncInsights.ts` (CONN-06).**
  - New `readRiskRows()` reads `gold_injury_risk_model_scores` first.
  - It falls back to `gold_injury_risk_scores` when the model read fails or returns no rows, or when its latest `scored_at` is more than 36 hours old (`MODEL_MAX_AGE_HOURS`). The age is computed on Databricks' clock.
  - It logs which source was used and why.
  - Only a failed heuristic read counts as a failed table.
- **`databricks/notebooks/generate_synthetic_sessions.py`.**
  - **`plan_injuries`:** besides the recovery users, `injured_share` (0.3) of the others get a side-tagged injury (`knee:left` style), and `decline_share` (0.5) of those decline.
  - **Decline:** from an onset day in week 3 or 4, these lifters add two sessions a week and about 40% load. Over 14 days their injured side loses up to about 30° of range, the lowering speeds up, and more reps are flagged.
  - **Stable injuries:** a small, steady deficit.
  - **Healthy lifters:** no flags.
  - **`replace` widget:** deletes earlier synthetic files first. It defaults to `true`; the live run used `false`.
- **`data/synthetic-training-ids.json` (new).** 100 ids: the 30 demo accounts plus 70 training-only ids with no Neon accounts.
- **Docs:**
  - Root `Architecture.md` §11.1: the gold table list, with the three new tables and `range_side`.
  - Root `Architecture.md` §11.2: the forecast label, model, champion, UC registration, outputs, sync fallback, dashboard and synthetic data.
  - Design contract: `docs/superpowers/specs/2026-10-10-injury-risk-model-design.md`.

### Decisions taken

- **Forecast label.** The label is next week's heuristic flag, not today's.
- **Model first, heuristic fallback.** The app shows the model score, and falls back to the heuristic when the model's scores are missing or stale.
- **One range definition in `gold.py`,** shared by the heuristic and the model.
- **Champion as a run tag.** Unity Catalog registration doesn't work on Free Edition (see "Live run"), so the model stays a run artifact. UC registration is opt-in.
- **Honest class balance.** The synthetic data was fixed to produce real heuristic positives, not tuned to flatter the model. The run logs the balance.

## Validation

**Test-first.** Behavioural tests were committed before each implementation:

| Tests | Implementation |
|---|---|
| `67102cb` (risk model, injured-side range, model-first sync) | `3b040ca`, `f243d1c`, `30f693b` |
| `305f0f9` (review cases: comments, score correction, side mixing, stale model scores) | `5cfb444`, `db84b3c`, `22e8f7b` |
| `7604ed5` (side tags and decline in synthetic data) | `6338a1f` |
| `6c4bc6b`, `8a6fe85` (champion tag, opt-in UC registration) | `e5c639e`, `3efcc16` |
| `527469d` (metrics table) | `ad37539` |

The implementations made the tests pass without changing them.

Notebook tests, from `databricks/pipelines`, `uv run --no-project --with pytest --with xgboost==2.1.3 --with scikit-learn --with pandas --with numpy python -m pytest ../notebooks/tests -q`:

```
........................................                                 [100%]
40 passed in 4.49s
```

There are 32 in `test_risk_model.py` and 8 in `test_synthetic_sessions.py`. They cover:
- label window boundaries, the excluded tail and user-disjoint splits
- family grouping, the `top_features` order and importance aggregation
- prior correction
- the single-class skip
- the champion rule
- opt-in UC registration
- the metrics rows
- comment escaping and the not-a-diagnosis comments
- an end-to-end fit
- the generator's injury plan and decline

Spark tests, from `databricks/pipelines`, `JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH uv run pytest steadyforum_sessions -q`:

```
..........                                                               [100%]
10 passed in 31.79s
```

These include:
- the injured-side range: a `knee:left` lifter whose left range shrinks gets `range_shrinking`, while the other side doesn't move it
- the smaller-side fallback
- a mid-window tag not mixing sides
- generated declining lifters crossing the heuristic flag

API, from `apps/api`, `npx vitest run`:

```
 Test Files  27 passed (27)
      Tests  370 passed (370)
```

`npx tsc -p tsconfig.check.json` shows no output.

### Live run (Databricks Free Edition, serverless, 2026-10-10/11)

**1. Data.**
- The deployed pipeline's `gold.py` was updated to this branch's version.
- The fixed generator ran with `data/synthetic-training-ids.json`, `users=100` and `replace=false`. The earlier synthetic files were kept, at the owner's choice.
- Then a plain pipeline update ran, not a full refresh.

**2. Why there were few positives at first.**
- 200 of the original 231 live lifters come from an external upload that isn't in this repo.
- Their injuries are in `user_context.injuries`, which the bronze schema doesn't read (it lands in `_rescued_data`).
- They also have no joints files.
- So they can't reach a heuristic score of 0.5. This is not fixed here.

**3. Gold after the update.** 9,033 rows from 301 lifters. 65 `weak_label` rows come from 14 lifters, all with `range_side = injured`.

**4. Training.** 7,081 trainable rows.

| Split | Lifters | Positives / trainable rows |
|---|---|---|
| Train | 241 | 48 / 5,706 |
| Test | 60 | 11 / 1,375 |

| Predictor (test) | ROC-AUC | PR-AUC | Brier |
|---|---|---|---|
| Model | 0.9967 | 0.8292 | 0.0028 |
| Heuristic score as next week's predictor | 0.9282 | 0.6442 | 0.0086 |

PR-AUC lift over the heuristic: +0.185. **With only 11 test positives this is noisy, and the labels are heuristic**, so the lift shows the model forecasts the rule better than the rule's own score does today. It says nothing about injuries.

**5. Unity Catalog.**
- Registering `steadyforum.ml.injury_risk` fails on Free Edition: S3 explicitly denies the artifact upload to the catalog's default storage.
- Each attempt left a `PENDING_REGISTRATION` version. These were cleaned up, and the notebook now deletes them itself.
- That's why the model is a run artifact with a champion tag, and why UC registration is opt-in.

**6. Champion.** The first champion run was `5ea63fad…`. Later runs were promoted on PR-AUC ties (the rule is `>=`): `f713f522…`, then the current champion, `954cc64ed9194d11a8ee1b27aabf3f28`.

**7. Scores.** `gold_injury_risk_model_scores` has:
- 711 rows (latest per lifter × body part) from 301 lifters
- an average score of 0.028, with 20 rows at or above 0.5
- `model_version` = the champion run id

A typical `top_features` is `["asymmetry","range_shrinking","flag_rate_rising"]`.

**8. Importance.** `gold_risk_feature_importance`, gain by family:

| Family | Gain |
|---|---|
| `asymmetry` | 0.569 |
| `range_shrinking` | 0.210 |
| `flag_rate_rising` | 0.101 |
| `acute_chronic_load` | 0.074 |
| `tempo_speeding_up` | 0.045 |

Both tables carry the "Not a diagnosis" comment.

**9. Metrics table.** `gold_risk_model_metrics` has two rows, matching the run's logged metrics, with 11 positives out of 1,375 test rows:

| Predictor | ROC-AUC | PR-AUC | Brier |
|---|---|---|---|
| `model` | 0.9967 | 0.8292 | 0.0028 |
| `heuristic` | 0.9282 | 0.6442 | 0.0086 |

**10. Dashboard.** "SteadyForum: injury-risk trends" (id `01f1c51e3553182c9969fd45dc0690a7`) is published with `embed_credentials` off and exported to `databricks/dashboards/injury_risk.lvdash.json`. Its tiles:
- a not-a-diagnosis text tile
- feature importance by family (bar)
- held-out model vs heuristic metrics (grouped bar, from `gold_risk_model_metrics`)
- the model score distribution by body part (latest day)
- the share of lifters with a heuristic score ≥ 0.5 per week. This uses the heuristic history, because the model table holds only the latest day.

All four datasets ran, returning 5, 6, 9 and 7 rows.

**11. Sync.** `readGold` ran twice, read-only, against the warehouse.
- **Before the model table existed:** it fell back to the heuristic table, as designed, and read 6,988 rows.
- **After:** it read the model table:

```
[insights] risk scores from steadyforum.gold.gold_injury_risk_model_scores (711 rows)
{ progress: 10571, risk: 711, rom: 1988, failed: [] }
```

## Not checked

- **Neon write:** the sync's upsert into Neon wasn't run, because `STEADYFORUM_PSEUDONYM_SECRET` is empty in the local `.env`.
- **Dashboard rendering:** the dashboard's queries ran, but its widgets weren't checked visually.
- **The daily job:** the notebook ran live from a copy in the owner's user folder, but no job was created from `risk_model.job.json`. Its notebook path is still the `<workspace-folder>` placeholder.
- **Variability:** one training set and one split. With 11 test positives, a different seed could move PR-AUC a lot.

## Known limits

Found in review and deliberately not fixed:
- **Champion comparisons across test sets:** the champion rule compares PR-AUC across runs whose test sets differ as the data grows, so it isn't a like-for-like comparison.
- **Mixed sources in Neon:** Neon `risk_insights` history mixes heuristic and model scores, with no `source` column to tell them apart. Adding one needs a migration.
- **Job placeholder:** `risk_model.job.json` keeps the `<workspace-folder>` placeholder until it's filled in.

Other limits:
- **Labels are heuristic.** The model learns to forecast a rule, not injuries. The score is a training-load and form-trend signal, and the app keeps `INSIGHTS_DISCLAIMER`.
- **Externally uploaded lifters:** the 200 externally uploaded lifters can't produce positives until bronze reads `user_context.injuries` and they have joints files.
- **Score meaning changes:** the app's score changes from a weighted rule to a forecast probability. Both are 0–1, but model scores are much lower on average (0.028), since most lifters aren't flagged next week.
- **Old synthetic sessions remain:** they were left in the Volume (`replace=false`), so gold mixes the old and new generator's lifters.

## Also on this branch

These files belong to other tickets and changed here because the model depends on them:
- `gold.py` and `setup.sql` (CONN-03)
- `syncInsights.ts` (CONN-06)
- the synthetic generator and `data/synthetic-training-ids.json`

## Not included

- A Neon `risk_insights.source` column (model vs heuristic).
- FE-14 screen changes.
- Model Serving for live risk scoring. A daily batch is enough for a trend score.
- Reading `user_context.injuries` in bronze for the externally uploaded lifters.
