# Injury-risk model (AI-14): plan of work

AI-14 (#54) trains an XGBoost model that forecasts the heuristic injury-risk flag a week ahead, registers it in MLflow, scores every lifter, and feeds that score to the app and an AI/BI dashboard with its feature importance. It's a **training-load and form-trend score, not a diagnosis**, and the labels are heuristic (Architecture §11.2). Branch `ai-14-injury-risk-model`, worktree `~/Developer/KnightHacks2026-ai14`, from `main` at `033bcf2`.

## What exists (CONN-03, CONN-06, BE-13)

- **Features and weak label:** `gold_injury_risk_scores` (`databricks/pipelines/steadyforum_sessions/gold.py`) has, per lifter × body part × day, 7- and 28-day windows of:
  - flag rate
  - range, using the smaller of left and right
  - asymmetry
  - volume, and from it the acute-to-chronic ratio (`acwr`), after 21 days of history
  - lowering time

  It also has a weighted score (`RISK_WEIGHTS`), `top_features` (the up-to-3 largest contributions) and `weak_label = score >= 0.5`.
- **Path to the app:** `apps/api/src/jobs/syncInsights.ts` copies `score` and `top_features` into Neon `risk_insights`. `explainRisk()` turns the feature names (`flag_rate_rising`, `range_shrinking`, `asymmetry`, `acute_chronic_load`, `tempo_speeding_up`) into text. `GET /me/insights` (`routes/progress.ts`) adds `INSIGHTS_DISCLAIMER` ("not a diagnosis").
- **Pattern to follow:** `databricks/notebooks/form_model.py` (CONN-04): MLflow with Unity Catalog registry, a `champion` alias moved only when held-out metrics are at least as good, and `steadyforum.ml` for models.
- **Missing:** the model, the scores it produces, a feature-importance table and any dashboard.

## Decisions (agreed)

1. **Label = a forecast.** For each lifter, body part and day D, the label is whether the heuristic flag (`weak_label`) is raised on any tracked day in (D, D+7]. Rows without 7 days of future data are scored but not trained on. Same-day labels would let the model relearn the rule it's computed from.
2. **The app shows the model score, with the heuristic as fallback.** The notebook writes `steadyforum.gold.gold_injury_risk_model_scores` with the heuristic table's columns. The Neon sync reads it first and falls back to `gold_injury_risk_scores` when it's missing or failing.
3. **Injured-side range lives in `gold.py`.** Range uses the injured side when `silver_reps.injured_side` knows it, and the smaller side otherwise, so the heuristic and the model share one definition.
4. **Verified for real.** The user adds Databricks workspace credentials to `apps/api/.env`. The notebook runs on serverless through the Jobs API, and the model, tables and dashboard are checked in the workspace.

## Work

### 1. `gold.py` (CONN-03): injured-side range

- In `gold_injury_risk_scores`, the daily aggregate's range uses `left_range_deg` or `right_range_deg` per `injured_side`, and the smaller of the two when `injured_side` is null. `range_7d` and `range_28d` keep their names; new column `range_side` is `injured` or `min`.
- `range_shrinking` and the score follow automatically.
- **Tests:** a local Spark test (`steadyforum_sessions/tests/test_risk_features.py`, needs Java 17 or 21: `brew install openjdk@21`) checks:
  - a lifter with `knee:left` whose left range shrinks gets `range_shrinking`, while the other side's range doesn't move it
  - a lifter with no injury uses the smaller side

### 2. `databricks/notebooks/risk_model.py` (AI-14)

Its sections:
- **Header:** the trend-score, not-a-diagnosis and heuristic-labels statement.
- **`%pip install xgboost==<pinned>`**, since serverless has no ML runtime.
- **Pure functions**, testable without Spark:
  - `build_features(df)` → the model's columns, grouped into the five §11.2 families:

    | Family (same names as `explainRisk`) | Columns |
    |---|---|
    | `flag_rate_rising` | `flag_rate_7d`, `flag_rate_28d`, their difference |
    | `range_shrinking` | `range_7d`, `range_28d`, relative change |
    | `asymmetry` | `asymmetry_7d` |
    | `acute_chronic_load` | `acwr`, `volume_7d` |
    | `tempo_speeding_up` | `lowering_ms_7d`, `lowering_ms_28d`, relative change |

    `body_part` is one-hot encoded, and missing values stay NaN (XGBoost handles them).
  - `forecast_labels(df, horizon_days=7)` → the label per decision 1, plus a `trainable` mask.
  - `split_by_user(df, test_size=0.2, seed)`: no lifter appears in both train and test.
  - `train(train_df, params)` → an XGBoost classifier, with `scale_pos_weight` for the class imbalance.
  - `evaluate(model, test_df)` → ROC-AUC, PR-AUC and Brier for the model **and for the heuristic's own score used as next week's predictor**, so the model's value over the rule is visible, not assumed.
  - `contributions(model, X)` → per-row XGBoost `pred_contribs`, summed per family; `top_features` = up to 3 families with positive contribution ≥ 0.01, largest first.
  - `importance(model)` → gain importance per feature and per family.
- **Run:**
  1. Read `steadyforum.gold.gold_injury_risk_scores`.
  2. Label, split, train and evaluate.
  3. Log to the MLflow experiment `/Users/<me>/steadyforum_injury_risk`: params, metrics (model and heuristic baseline), class balance, row counts, the importance table as an artifact, and the input dataset.
  4. Register `steadyforum.ml.injury_risk` with a signature, and move `champion` only if test PR-AUC is at least the current champion's.
- **Score:** with `champion`, score every row's latest state and write:
  - `steadyforum.gold.gold_injury_risk_model_scores` (overwrite): `user_id`, `body_part`, `date`, `score` (0–1 probability), `top_features`, `model_version`, `scored_at`. Table comment: "Training-load and form-trend score from a model trained on heuristic labels. Not a diagnosis."
  - `steadyforum.gold.gold_risk_feature_importance` (overwrite): `model_version`, `feature`, `family`, `gain`, `rank`, `trained_at`.
- **`databricks/notebooks/risk_model.job.json`:** a serverless daily job after the pipeline, like `delete_user.job.json`.

### 3. Dashboard: `databricks/dashboards/injury_risk.lvdash.json`

An AI/BI dashboard, "SteadyForum: injury-risk trends", built in the workspace through the Lakeview API and exported to the repo.
- **Contents:**
  - feature importance by family (bar)
  - model vs heuristic test metrics
  - score distribution by body part
  - share of lifters above 0.5 per week
  - a text tile: "A training-load and form-trend score from heuristic labels. Not a diagnosis."
- `GRANT SELECT` on the two new tables is added to `databricks/setup.sql` for the API's service principal.

### 4. `apps/api/src/jobs/syncInsights.ts` (CONN-06): model first, heuristic fallback

- Read `gold_injury_risk_model_scores`. If that read fails or returns no rows, read `gold_injury_risk_scores` as today.
- Same columns, same upsert, and `explainRisk()` keeps working because the model's `top_features` use the same family names.
- Log which source was used.
- **Tests:** vitest with a fake reader:
  - model rows are used when present
  - the heuristic is used when the model table is missing or empty
  - explanations come from the family names

### 5. Docs

- Root `Architecture.md` §11.2 (the forecast label, the model table, the fallback, the dashboard) and §11.1's gold table list.
- Notebook header and table comments.
- `Markdown/AI-14-Pull-Request.md`, closing #54.

## How it's built

- **Test-first.** Behavioural tests are committed and run to show they fail before each implementation; reruns leave them unchanged.
  - **Notebook tests:** `databricks/notebooks/tests/test_risk_model.py` (unittest, pure Python like `test_synthetic_sessions.py`: execs the notebook's functions before the Run section). It covers:
    - label window boundaries, and no future data in features
    - the excluded tail, and user-disjoint splits
    - family grouping and the `top_features` order
    - importance aggregation
    - an end-to-end fit on a small synthetic frame giving probabilities in [0, 1]
    - the not-a-diagnosis comment on the output tables
  - **Spark tests:** the `gold.py` change, under Java 21.
  - **API tests:** vitest for the sync.
- **Subagents** at medium effort, with separate files, after the tests are committed:
  - **A:** `risk_model.py`, `risk_model.job.json`
  - **B:** `gold.py`, `setup.sql`
  - **C:** `syncInsights.ts`
  - **Then:** a review subagent, with integration and checks by the coordinator.
- **Live run** once credentials are in:
  1. Upload the notebook.
  2. Run it on serverless through the Jobs API.
  3. Check that the registered version and alias, both tables and their row counts, and the logged metrics are all in place.
  4. Create and export the dashboard.
  5. Run the sync once against Neon. This needs a real `DATABASE_URL` and a SQL warehouse id.

## Needed from the user

- **Databricks credentials** in `apps/api/.env`: `DATABRICKS_HOST` plus either `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` (the existing service principal) or a personal access token. Add `DATABRICKS_WAREHOUSE_ID` for the dashboard and sync.
- **A real Neon `DATABASE_URL`** (still the template placeholder) for the sync check and the pending AI-13 re-ingest.
- **OK to `brew install openjdk@21`** for the local Spark tests.

## Risks

- **Class balance:** synthetic data may hold few forecast positives. The demo generator's injured users drive most heuristic flags. The run logs the balance; if positives are under about 5%, the plan is to report it and keep `scale_pos_weight`, not to tune the synthetic data to flatter the model.
- **Score drift for users:** the app's score changes meaning from a weighted rule to a forecast probability. Both are 0–1 and worded as trends; `INSIGHTS_DISCLAIMER` stays.
- **Scope:** `gold.py`, `setup.sql` and `syncInsights.ts` are outside AI-14's folder (CONN-03 and CONN-06); the PR says so.

## Not included

- A Neon `risk_insights.source` column (model vs heuristic), which would need a migration.
- FE-14 screen changes.
- Model Serving for live risk scoring. A daily batch is enough for a trend score.
