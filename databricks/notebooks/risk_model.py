# Databricks notebook source
# MAGIC %md
# MAGIC # AI-14: injury-risk model (training-load and form-trend score, not a diagnosis)
# MAGIC
# MAGIC Trains an XGBoost classifier on `steadyforum.gold.gold_injury_risk_scores` (CONN-03) that forecasts
# MAGIC whether the **heuristic** risk flag (`weak_label`) is raised for a lifter and body part on any
# MAGIC tracked day in the next 7 days. The labels are heuristic (Architecture §11.2): they come from the
# MAGIC weighted rule in `gold.py`, not from injuries, so this is a training-load and form-trend score.
# MAGIC **It is not a diagnosis** and must never be presented as one.
# MAGIC
# MAGIC - Logs the run to MLflow (`/Users/<me>/steadyforum_injury_risk`) with the heuristic's own score as a
# MAGIC   baseline, so the model's value over the rule is measured, not assumed.
# MAGIC - Logs the model as a run artifact (`runs:/<run_id>/model`). The champion is the experiment run
# MAGIC   tagged `champion=true`, moved only when the held-out PR-AUC is at least the current champion's.
# MAGIC - Also tries to register **`steadyforum.ml.injury_risk`** in Unity Catalog. On Databricks Free Edition
# MAGIC   the upload to the catalog's storage is denied, so the run gets `uc_registration=skipped` and
# MAGIC   carries on; when registration works, the `champion` alias is set as well.
# MAGIC - Scores each lifter and body part's latest day with the champion run's model into
# MAGIC   `steadyforum.gold.gold_injury_risk_model_scores` (read by the Neon sync, heuristic fallback) and
# MAGIC   writes gain importance to `steadyforum.gold.gold_risk_feature_importance`.
# MAGIC
# MAGIC Run on serverless compute, after the `steadyforum_sessions` pipeline (`risk_model.job.json`).

# COMMAND ----------

# MAGIC %pip install xgboost==2.1.3

# COMMAND ----------

dbutils.library.restartPython()

# COMMAND ----------

import numpy as np
import pandas as pd
import xgboost
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

MODEL_NAME = "steadyforum.ml.injury_risk"
SOURCE_TABLE = "steadyforum.gold.gold_injury_risk_scores"
MODEL_SCORES_TABLE = "steadyforum.gold.gold_injury_risk_model_scores"
IMPORTANCE_TABLE = "steadyforum.gold.gold_risk_feature_importance"
MODEL_TABLE_COMMENT = ("Training-load and form-trend score from a model trained on heuristic labels. "
                       "Not a diagnosis.")
IMPORTANCE_TABLE_COMMENT = ("Gain importance of the injury-risk model's features and feature families. "
                            "The model is trained on heuristic labels. Not a diagnosis.")
METRICS_TABLE = "steadyforum.gold.gold_risk_model_metrics"
METRICS_TABLE_COMMENT = ("Held-out metrics of the champion injury-risk model and of the heuristic score used as "
                         "next week's predictor. Labels are heuristic. Not a diagnosis.")
ALIAS = "champion"
CHAMPION_TAG = "champion"  # run tag: "true" on the champion run only
MODEL_ARTIFACT_PATH = "model"
SEED = 7
HORIZON_DAYS = 7
TEST_SIZE = 0.2

PARAMS = {
    "n_estimators": 300,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 1.0,
    "objective": "binary:logistic",
    "eval_metric": "aucpr",
    "tree_method": "hist",
    "random_state": SEED,
}

# gold.py BODY_PART keys, plus "general" for exercises without one.
BODY_PARTS = ["general", "knee", "lower_back", "shoulder"]

# Same family names as gold.py's RISK_WEIGHTS and the API's explainRisk().
FAMILIES = {
    "flag_rate_rising": ["flag_rate_7d", "flag_rate_28d", "flag_rate_change"],
    "range_shrinking": ["range_7d", "range_28d", "range_change"],
    "asymmetry": ["asymmetry_7d"],
    "acute_chronic_load": ["acwr", "volume_7d"],
    "tempo_speeding_up": ["lowering_ms_7d", "lowering_ms_28d", "lowering_ms_change"],
}
BODY_PART_COLUMNS = [f"body_part_{p}" for p in BODY_PARTS]
FEATURE_COLUMNS = [c for cols in FAMILIES.values() for c in cols] + BODY_PART_COLUMNS
FEATURE_FAMILIES = {c: fam for fam, cols in FAMILIES.items() for c in cols}
FEATURE_FAMILIES.update({c: "body_part" for c in BODY_PART_COLUMNS})

RAW_NUMERIC = ["flag_rate_7d", "flag_rate_28d", "range_7d", "range_28d", "asymmetry_7d",
               "volume_7d", "lowering_ms_7d", "lowering_ms_28d", "acwr"]

OUTPUT_COLUMNS = ["user_id", "body_part", "date", "score", "top_features", "model_version", "scored_at"]

# COMMAND ----------

# MAGIC %md ## Features and labels

# COMMAND ----------


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce").astype("float64")


def _relative_change(recent: pd.Series, baseline: pd.Series) -> pd.Series:
    base = baseline.where(baseline != 0)  # 0 or NaN baseline -> NaN
    return (recent - base) / base


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Model inputs from one row each (no other rows, no score / weak_label / top_features)."""
    raw = {c: _num(df, c) for c in RAW_NUMERIC}
    X = pd.DataFrame(index=df.index)
    X["flag_rate_7d"] = raw["flag_rate_7d"]
    X["flag_rate_28d"] = raw["flag_rate_28d"]
    X["flag_rate_change"] = raw["flag_rate_7d"] - raw["flag_rate_28d"]
    X["range_7d"] = raw["range_7d"]
    X["range_28d"] = raw["range_28d"]
    X["range_change"] = _relative_change(raw["range_7d"], raw["range_28d"])
    X["asymmetry_7d"] = raw["asymmetry_7d"]
    X["acwr"] = raw["acwr"]
    X["volume_7d"] = raw["volume_7d"]
    X["lowering_ms_7d"] = raw["lowering_ms_7d"]
    X["lowering_ms_28d"] = raw["lowering_ms_28d"]
    X["lowering_ms_change"] = _relative_change(raw["lowering_ms_7d"], raw["lowering_ms_28d"])
    part = df["body_part"].astype(str)
    for p, col in zip(BODY_PARTS, BODY_PART_COLUMNS):
        X[col] = (part == p).astype("float64")
    return X[FEATURE_COLUMNS].astype("float64")


def _day_numbers(dates: pd.Series) -> np.ndarray:
    return (pd.to_datetime(dates).dt.normalize() - pd.Timestamp("1970-01-01")).dt.days.to_numpy()


def forecast_labels(df: pd.DataFrame, horizon_days: int = HORIZON_DAYS) -> pd.DataFrame:
    """label = heuristic flag raised on any day in (D, D + horizon]; trainable = that window is observed."""
    out = df.copy()
    days = pd.Series(_day_numbers(df["date"]), index=df.index)
    weak = df["weak_label"].fillna(False).astype(bool)
    label = pd.Series(False, index=df.index)
    trainable = pd.Series(False, index=df.index)
    for _, idx in df.groupby(["user_id", "body_part"], sort=False).groups.items():
        d = days.loc[idx].to_numpy()
        order = np.argsort(d, kind="mergesort")
        sorted_days = d[order]
        cum = np.concatenate([[0], np.cumsum(weak.loc[idx].to_numpy()[order])])
        lo = np.searchsorted(sorted_days, d, side="right")
        hi = np.searchsorted(sorted_days, d + horizon_days, side="right")
        label.loc[idx] = (cum[hi] - cum[lo]) > 0
        trainable.loc[idx] = d + horizon_days <= sorted_days[-1]
    out["label"] = label.astype(bool)
    out["trainable"] = trainable.astype(bool)
    return out


def split_by_user(df: pd.DataFrame, test_size: float = TEST_SIZE, seed: int = SEED):
    """(train_df, test_df) with no lifter in both."""
    users = np.array(sorted(df["user_id"].astype(str).unique()))
    shuffled = np.random.default_rng(seed).permutation(users)
    n_test = int(round(len(users) * test_size))
    if len(users) >= 2:
        n_test = min(max(n_test, 1), len(users) - 1)
    test_users = set(shuffled[:n_test])
    in_test = df["user_id"].astype(str).isin(test_users)
    return df.loc[~in_test], df.loc[in_test]


# COMMAND ----------

# MAGIC %md ## Train, evaluate, explain

# COMMAND ----------


def _trainable(df: pd.DataFrame) -> pd.DataFrame:
    return df.loc[df["trainable"].astype(bool)]


def dataset_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Trainable rows' model inputs plus the integer label (what MLflow logs as the input dataset)."""
    rows = _trainable(df)
    return pd.concat([build_features(rows), rows[["label"]].astype(int)], axis=1)


def training_status(counts: dict):
    """None when both splits hold both classes; otherwise why training is skipped."""
    for split in ("train", "test"):
        c = counts[split]
        if c["positives"] == 0 or c["positives"] == c["trainable"]:
            return (f"{split} split has a single class ({c['positives']} positive of {c['trainable']} "
                    "trainable rows); not training or registering a model")
    return None


def prior_correct(p, scale_pos_weight) -> np.ndarray:
    """Undo scale_pos_weight's shift of the predicted odds: p' = p / (p + (1 - p) * spw)."""
    p = np.asarray(p, dtype="float64")
    spw = float(scale_pos_weight) if scale_pos_weight else 1.0
    return p / (p + (1.0 - p) * spw)


def predict_scores(model: xgboost.XGBClassifier, X: pd.DataFrame) -> np.ndarray:
    """Probabilities at the training data's real class prior (training upweights positives)."""
    raw = model.predict_proba(X[FEATURE_COLUMNS])[:, 1]
    return np.clip(prior_correct(raw, model.get_params().get("scale_pos_weight")), 0.0, 1.0)


def train(train_df: pd.DataFrame, params: dict = None) -> xgboost.XGBClassifier:
    rows = _trainable(train_df)
    y = rows["label"].astype(bool).astype(int)
    pos = int(y.sum())
    neg = int(len(y) - pos)
    if pos == 0 or neg == 0:
        raise ValueError(f"Training rows need both classes: {pos} positive, {neg} negative "
                         f"(of {len(rows)} trainable rows)")
    p = dict(PARAMS)
    p.update(params or {})
    p.setdefault("scale_pos_weight", neg / pos)
    model = xgboost.XGBClassifier(**p)
    model.fit(build_features(rows), y)
    return model


def _metrics(y: pd.Series, p) -> dict:
    return {
        "roc_auc": float(roc_auc_score(y, p)),
        "pr_auc": float(average_precision_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
    }


def evaluate(model: xgboost.XGBClassifier, test_df: pd.DataFrame) -> dict:
    """Model vs the heuristic's own score as next week's predictor, on the trainable test rows."""
    rows = _trainable(test_df)
    y = rows["label"].astype(bool).astype(int)
    if y.nunique() < 2:
        raise ValueError(f"Test rows need both classes to evaluate: {int(y.sum())} positive of {len(y)}")
    p_model = predict_scores(model, build_features(rows))
    p_rule = pd.to_numeric(rows["score"], errors="coerce").fillna(0.0).clip(0, 1)
    return {"model": _metrics(y, p_model), "heuristic": _metrics(y, p_rule)}


def top_families(family_contribs: pd.DataFrame, k: int = 3, min_contribution: float = 0.01) -> list:
    """Per row: families with contribution >= min_contribution, largest first (ties in FAMILIES order)."""
    cols = [f for f in FAMILIES if f in family_contribs.columns]
    values = family_contribs[cols].astype("float64").fillna(0.0).to_numpy()
    out = []
    for row_values in values:
        kept = [(f, v) for f, v in zip(cols, row_values) if v >= min_contribution]
        kept.sort(key=lambda fv: -fv[1])  # stable: ties keep FAMILIES order
        out.append([f for f, _ in kept[:k]])
    return out


def contributions(model: xgboost.XGBClassifier, X: pd.DataFrame) -> pd.DataFrame:
    """Per-family sums of XGBoost pred_contribs (log-odds), plus top_features."""
    raw = model.get_booster().predict(xgboost.DMatrix(X[FEATURE_COLUMNS]), pred_contribs=True)
    per_feature = pd.DataFrame(raw[:, :-1], columns=FEATURE_COLUMNS, index=X.index)  # last column = bias
    out = pd.DataFrame({fam: per_feature[cols].sum(axis=1).astype("float64") for fam, cols in FAMILIES.items()},
                       index=X.index)
    out["top_features"] = top_families(out[list(FAMILIES)])
    return out


def importance(model: xgboost.XGBClassifier):
    """(per_feature, per_family) normalised total-gain importance, ranked."""
    scores = model.get_booster().get_score(importance_type="total_gain")
    gains = np.array([float(scores.get(f, 0.0)) for f in FEATURE_COLUMNS])
    total = gains.sum()
    if total > 0:
        gains = gains / total
    per_feature = pd.DataFrame({
        "feature": FEATURE_COLUMNS,
        "family": [FEATURE_FAMILIES[f] for f in FEATURE_COLUMNS],
        "gain": gains,
    }).sort_values("gain", ascending=False, kind="mergesort").reset_index(drop=True)
    per_feature["rank"] = np.arange(1, len(per_feature) + 1)
    per_family = (per_feature.groupby("family", sort=False)["gain"].sum().reset_index()
                  .sort_values("gain", ascending=False, kind="mergesort").reset_index(drop=True))
    per_family["rank"] = np.arange(1, len(per_family) + 1)
    return per_feature, per_family


def score_rows(model: xgboost.XGBClassifier, df: pd.DataFrame, model_version, scored_at) -> pd.DataFrame:
    X = build_features(df)
    contribs = contributions(model, X)
    out = pd.DataFrame({
        "user_id": df["user_id"].to_numpy(),
        "body_part": df["body_part"].to_numpy(),
        "date": df["date"].to_numpy(),
        "score": predict_scores(model, X),
        "top_features": contribs["top_features"].tolist(),
        "model_version": str(model_version),
        "scored_at": [scored_at] * len(df),
    })
    return out[OUTPUT_COLUMNS]


def metrics_rows(logged: dict, model_version: str, trained_at) -> list[dict]:
    """The champion run's logged test metrics as one row for the model and one for the heuristic."""
    shared = {"model_version": model_version, "trained_at": trained_at,
              "test_positives": int(logged.get("test_positives", 0)),
              "test_rows": int(logged.get("test_trainable", 0))}
    return [{"predictor": name, **{m: logged.get(f"{prefix}_{m}") for m in ("roc_auc", "pr_auc", "brier")}, **shared}
            for name, prefix in (("model", "test"), ("heuristic", "heuristic"))]


def comment_sql(table: str, comment: str) -> str:
    """COMMENT ON TABLE with the comment as a safely escaped string literal."""
    literal = comment.replace("\\", "\\\\").replace("'", "\\'")
    return f"COMMENT ON TABLE {table} IS '{literal}'"


NOT_FOUND_CODES = {"RESOURCE_DOES_NOT_EXIST", "NOT_FOUND"}


def is_not_found(exc: BaseException) -> bool:
    """True only for a missing model or alias (MLflow error code), so other errors still raise."""
    return getattr(exc, "error_code", None) in NOT_FOUND_CODES


def choose_champion(current_metrics, new_pr_auc) -> bool:
    """Promote when there is no champion run (None), it has no test_pr_auc, or new_pr_auc >= it."""
    if not current_metrics or current_metrics.get("test_pr_auc") is None:
        return True
    return float(new_pr_auc) >= float(current_metrics["test_pr_auc"])


def registration_skip_reason(exc: BaseException, max_len: int = 500) -> str:
    """First non-blank line of the error (the exception type when there is none), for a run tag."""
    lines = [l.strip() for l in str(exc).splitlines() if l.strip()]
    return (lines[0] if lines else type(exc).__name__)[:max_len]


# COMMAND ----------

# MAGIC %md ## Run

# COMMAND ----------

from datetime import datetime, timezone

import mlflow
import mlflow.xgboost
from mlflow.models import infer_signature
from mlflow.tracking import MlflowClient
from pyspark.sql import types as T

mlflow.set_registry_uri("databricks-uc")
user = spark.sql("SELECT current_user()").first()[0]
experiment = mlflow.set_experiment(f"/Users/{user}/steadyforum_injury_risk")

source = spark.read.table(SOURCE_TABLE).toPandas()
labelled = forecast_labels(source, HORIZON_DAYS)
train_df, test_df = split_by_user(labelled, TEST_SIZE, SEED)
trainable = _trainable(labelled)


def balance(df: pd.DataFrame) -> dict:
    rows = _trainable(df)
    pos = int(rows["label"].astype(bool).sum())
    return {"rows": len(df), "trainable": len(rows), "positives": pos,
            "positive_rate": pos / len(rows) if len(rows) else 0.0}


counts = {name: balance(part) for name, part in [("all", labelled), ("train", train_df), ("test", test_df)]}
print(f"{len(source):,} rows, {source['user_id'].nunique():,} lifters from {SOURCE_TABLE}")
for name, c in counts.items():
    print(f"{name}: {c['rows']:,} rows, {c['trainable']:,} trainable, {c['positives']:,} positive "
          f"({c['positive_rate']:.1%})")
if counts["all"]["positive_rate"] < 0.05:
    print("Warning: forecast positives are under 5%; keeping scale_pos_weight, metrics will be noisy.")
status = training_status(counts)  # None, or why training is skipped
if status:
    print(f"Skipping training: {status}. The existing champion (if any) still scores today's rows.")

# COMMAND ----------

# MAGIC %md ### Train, evaluate, log and register
# MAGIC
# MAGIC Skipped (with an `insufficient_labels` tag) when either split lacks a class, so no model is
# MAGIC logged that can't be trained or measured. The model is logged as a run artifact; Unity Catalog
# MAGIC registration is opt-in (`register_uc`); a failure only tags the run `uc_registration=skipped`.

# COMMAND ----------

dbutils.widgets.dropdown("register_uc", "false", ["false", "true"], "also register in Unity Catalog")
REGISTER_UC = dbutils.widgets.get("register_uc") == "true"

info, metrics, uc_version = None, None, None
with mlflow.start_run(run_name="injury_risk_xgboost") as run:
    mlflow.log_params(PARAMS)
    mlflow.log_params({
        "source_table": SOURCE_TABLE,
        "horizon_days": HORIZON_DAYS,
        "test_size": TEST_SIZE,
        "split": "by_user",
        "seed": SEED,
        "labels_from": "heuristic_weak_label_forecast",
        "features": ",".join(FEATURE_COLUMNS),
        "scores": "prior_corrected",
        "xgboost_version": xgboost.__version__,
    })
    mlflow.log_metrics({f"{name}_{k}": float(v) for name, c in counts.items() for k, v in c.items()})
    mlflow.log_metrics({"lifters_train": train_df["user_id"].nunique(), "lifters_test": test_df["user_id"].nunique()})
    mlflow.log_input(mlflow.data.from_pandas(dataset_frame(train_df), name=f"{SOURCE_TABLE}:train"),
                     context="training")
    mlflow.log_input(mlflow.data.from_pandas(dataset_frame(test_df), name=f"{SOURCE_TABLE}:test"),
                     context="test")

    if status:
        mlflow.set_tag("status", "insufficient_labels")
        mlflow.set_tag("skip_reason", status)
    else:
        model = train(train_df)
        metrics = evaluate(model, test_df)  # model probabilities are prior-corrected
        mlflow.log_metrics({f"test_{k}": v for k, v in metrics["model"].items()})
        mlflow.log_metrics({f"heuristic_{k}": v for k, v in metrics["heuristic"].items()})
        lift = metrics["model"]["pr_auc"] - metrics["heuristic"]["pr_auc"]
        mlflow.log_metric("pr_auc_lift_over_heuristic", lift)

        per_feature, per_family = importance(model)
        mlflow.log_text(per_feature.to_csv(index=False), "importance/per_feature.csv")
        mlflow.log_text(per_family.to_csv(index=False), "importance/per_family.csv")

        example = build_features(_trainable(test_df)).head(5)
        info = mlflow.xgboost.log_model(
            xgb_model=model,
            artifact_path=MODEL_ARTIFACT_PATH,  # MLflow 2.x on serverless; 3.x still accepts it
            signature=infer_signature(example, model.predict_proba(example)[:, 1]),
            input_example=example,
            pip_requirements=[f"xgboost=={xgboost.__version__}", f"pandas=={pd.__version__}",
                              f"numpy=={np.__version__}", f"mlflow=={mlflow.__version__}"],
        )
        mlflow.set_tag("status", "trained")

        # Opt-in: Free Edition denies the artifact upload to the catalog's default storage, and each
        # failed attempt leaves a PENDING_REGISTRATION version behind, which we delete.
        if REGISTER_UC:
            try:
                uc_version = mlflow.register_model(f"runs:/{run.info.run_id}/{MODEL_ARTIFACT_PATH}", MODEL_NAME).version
                mlflow.set_tag("uc_registration", f"version {uc_version}")
            except Exception as exc:
                reason = registration_skip_reason(exc)
                mlflow.set_tag("uc_registration", "skipped")
                mlflow.set_tag("uc_registration_reason", reason)
                print(f"Unity Catalog registration skipped ({reason}); the model stays a run artifact.")
                client = MlflowClient()
                for v in client.search_model_versions(f"name='{MODEL_NAME}'"):
                    if v.run_id == run.info.run_id:
                        client.delete_model_version(MODEL_NAME, v.version)
        else:
            mlflow.set_tag("uc_registration", "off")

if info:
    print(f"Run {run.info.run_id}: model {metrics['model']}, heuristic {metrics['heuristic']}")
    print(f"PR-AUC lift over the heuristic: {lift:+.3f}")
    print(f"Logged runs:/{run.info.run_id}/{MODEL_ARTIFACT_PATH}"
          + (f"; registered {MODEL_NAME} version {uc_version}" if uc_version else ""))
    display(per_family)

# COMMAND ----------

# MAGIC %md ### Promote
# MAGIC
# MAGIC The champion is the experiment run tagged `champion=true` (one at a time). The new run takes the
# MAGIC tag only if its held-out PR-AUC is at least the champion's; the old run is set to `champion=false`.
# MAGIC When the model was registered in Unity Catalog, the `champion` alias follows it. The lift over
# MAGIC the heuristic is printed alongside as context.

# COMMAND ----------

client = MlflowClient()


def get_champion():
    """The latest finished run tagged champion=true in this experiment, or None."""
    runs = client.search_runs(
        experiment_ids=[experiment.experiment_id],
        filter_string=f"tags.{CHAMPION_TAG} = 'true' AND attributes.status = 'FINISHED'",
        order_by=["attributes.start_time DESC"],
        max_results=1,
    )
    return runs[0] if runs else None


if info:
    new_run_id = run.info.run_id
    new_pr_auc = metrics["model"]["pr_auc"]
    current = get_champion()
    current_metrics = current.data.metrics if current else None
    current_pr_auc = (current_metrics or {}).get("test_pr_auc")
    shown = "none" if current_pr_auc is None else f"{current_pr_auc:.3f}"
    context = f"PR-AUC {new_pr_auc:.3f} vs champion {shown}; lift over heuristic {lift:+.3f}"
    if choose_champion(current_metrics, new_pr_auc):
        client.set_tag(new_run_id, CHAMPION_TAG, "true")
        if current:
            client.set_tag(current.info.run_id, CHAMPION_TAG, "false")
        if uc_version:
            client.set_registered_model_alias(MODEL_NAME, ALIAS, uc_version)
        print(f"{CHAMPION_TAG} -> run {new_run_id} ({context})")
    else:
        client.set_tag(new_run_id, CHAMPION_TAG, "false")
        print(f"Kept {CHAMPION_TAG} on run {current.info.run_id} ({context})")

# COMMAND ----------

# MAGIC %md ### Score with the champion
# MAGIC
# MAGIC Each lifter and body part's latest day, so the app gets the current state. Runs even when
# MAGIC training was skipped, as long as a champion exists. Scores are prior-corrected probabilities.

# COMMAND ----------

SCORES_SCHEMA = T.StructType([
    T.StructField("user_id", T.StringType()),
    T.StructField("body_part", T.StringType()),
    T.StructField("date", T.DateType()),
    T.StructField("score", T.DoubleType()),
    T.StructField("top_features", T.ArrayType(T.StringType())),
    T.StructField("model_version", T.StringType()),
    T.StructField("scored_at", T.TimestampType()),
])
IMPORTANCE_SCHEMA = T.StructType([
    T.StructField("model_version", T.StringType()),
    T.StructField("feature", T.StringType()),
    T.StructField("family", T.StringType()),
    T.StructField("gain", T.DoubleType()),
    T.StructField("rank", T.IntegerType()),
    T.StructField("trained_at", T.TimestampType()),
])
METRICS_SCHEMA = T.StructType([
    T.StructField("predictor", T.StringType()),
    T.StructField("roc_auc", T.DoubleType()),
    T.StructField("pr_auc", T.DoubleType()),
    T.StructField("brier", T.DoubleType()),
    T.StructField("model_version", T.StringType()),
    T.StructField("trained_at", T.TimestampType()),
    T.StructField("test_positives", T.IntegerType()),
    T.StructField("test_rows", T.IntegerType()),
])


def overwrite(rows, schema, table, comment):
    (spark.createDataFrame(rows, schema).write.mode("overwrite")
     .option("overwriteSchema", "true").saveAsTable(table))
    spark.sql(comment_sql(table, comment))
    print(f"Wrote {len(rows):,} rows to {table}")


champion = get_champion()
if champion is None:
    print(f"No run tagged {CHAMPION_TAG}=true; nothing scored. The Neon sync falls back to {SOURCE_TABLE}.")
else:
    champion_run_id = champion.info.run_id
    champion_model = mlflow.xgboost.load_model(f"runs:/{champion_run_id}/{MODEL_ARTIFACT_PATH}")
    trained_at = datetime.fromtimestamp(int(champion.info.start_time) / 1000, tz=timezone.utc)
    scored_at = datetime.now(timezone.utc)

    latest = (source.assign(_day=_day_numbers(source["date"]))
              .sort_values("_day", kind="mergesort")
              .groupby(["user_id", "body_part"], sort=False).tail(1)
              .drop(columns="_day"))
    scores = score_rows(champion_model, latest, champion_run_id, scored_at)
    scores["date"] = pd.to_datetime(scores["date"]).dt.date
    scores["top_features"] = scores["top_features"].map(list)

    champion_importance, _ = importance(champion_model)
    importance_rows = [
        (champion_run_id, r.feature, r.family, float(r.gain), int(r.rank), trained_at)
        for r in champion_importance.itertuples(index=False)
    ]
    score_records = [tuple(r) for r in scores[OUTPUT_COLUMNS].itertuples(index=False, name=None)]

    overwrite(score_records, SCORES_SCHEMA, MODEL_SCORES_TABLE, MODEL_TABLE_COMMENT)
    overwrite(importance_rows, IMPORTANCE_SCHEMA, IMPORTANCE_TABLE, IMPORTANCE_TABLE_COMMENT)
    metric_rows = [tuple(r[f.name] for f in METRICS_SCHEMA.fields)
                   for r in metrics_rows(champion.data.metrics, champion_run_id, trained_at)]
    overwrite(metric_rows, METRICS_SCHEMA, METRICS_TABLE, METRICS_TABLE_COMMENT)
    display(spark.read.table(MODEL_SCORES_TABLE).orderBy("score", ascending=False).limit(20))

# COMMAND ----------

# Fail the run after scoring, so a skipped training shows up in the job's status.
if status:
    scored = f"scored with {CHAMPION_TAG} run {champion.info.run_id}" if champion else "nothing scored"
    raise RuntimeError(f"Training skipped: {status}; {scored}. Check {SOURCE_TABLE} and the heuristic flag rate.")
