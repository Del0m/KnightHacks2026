# Databricks notebook source
# MAGIC %md
# MAGIC # CONN-04: form-quality model, MLflow tracking and Unity Catalog registry
# MAGIC
# MAGIC Trains on per-rep features from `spotter.raw.silver_reps` (CONN-03), logs the run to MLflow,
# MAGIC and registers the model as **`spotter.ml.form_quality`**. The best version so far gets the
# MAGIC `champion` alias, which Model Serving (CONN-05) should point at.
# MAGIC
# MAGIC **Stub until AI-10 lands:** `train_models` is a gradient-boosted baseline on rep features
# MAGIC (one of the two options in Architecture §6.3). AI-10 replaces that one function; the
# MAGIC tracking, evaluation and registration around it stay as they are. Labels come from the
# MAGIC phone's rule flags until AI-09's hand-labelled clips exist.
# MAGIC
# MAGIC Run on serverless compute. Re-run any time to log a new run and register a new version.

# COMMAND ----------

import cloudpickle
import mlflow
import numpy as np
import pandas as pd
import sklearn
from mlflow.models import ModelSignature
from mlflow.types.schema import AnyType, ColSpec, Schema
from mlflow.tracking import MlflowClient
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

MODEL_NAME = "spotter.ml.form_quality"
SOURCE_TABLE = "spotter.raw.silver_reps"
ALIAS = "champion"
SEED = 7

# Rule id -> label (Architecture §6.3), same order as gold_training_features in CONN-03.
LABELS = [
    ("depth", "partial_range"),
    ("knee_tracking", "knees_in"),
    ("trunk_lean", "forward_lean"),
    ("tempo", "fast_lowering"),
]

NUMERIC_FEATURES = [
    "range_deg", "tempo_ms", "lowering_ms", "rising_ms", "asymmetry",
    "max_trunk_angle", "min_knee_ankle_ratio", "weight_kg",
]
CATEGORICAL_FEATURES = ["exercise_id"]
FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES

mlflow.set_registry_uri("databricks-uc")
user = spark.sql("SELECT current_user()").first()[0]
mlflow.set_experiment(f"/Users/{user}/spotter_form_quality")

# COMMAND ----------

# MAGIC %md ## Data

# COMMAND ----------


def label_for(flags) -> str:
    flags = list(flags) if flags is not None else []
    if not flags:
        return "clean"
    for rule_id, name in LABELS:
        if rule_id in flags:
            return name
    return "other"


def load_reps() -> pd.DataFrame:
    df = spark.read.table(SOURCE_TABLE).select("user_id", "quality", "flags", *FEATURES).toPandas()
    df["label"] = df["flags"].map(label_for)
    df["exercise_id"] = df["exercise_id"].fillna("unknown").astype(str)
    for col in NUMERIC_FEATURES:
        # Frame-derived columns are null when a session has no joints; the model handles NaN.
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
    return df.dropna(subset=["quality"]).reset_index(drop=True)


reps = load_reps()
# Columns with no data at all (e.g. frame features when sessions have no joints) can't be trained on.
used_features = [c for c in FEATURES if reps[c].notna().any()]
skipped = sorted(set(FEATURES) - set(used_features))
print(f"{len(reps):,} reps from {reps['user_id'].nunique():,} lifters")
if skipped:
    print(f"No data for {', '.join(skipped)}; training without them")
display(reps["label"].value_counts().rename("reps").to_frame())

# COMMAND ----------

# MAGIC %md ## Train (AI-10 replaces this cell)

# COMMAND ----------

PARAMS = {
    "model": "hist_gradient_boosting",
    "max_iter": 200,
    "learning_rate": 0.1,
    "max_leaf_nodes": 31,
    "l2_regularization": 0.0,
    "exercise_encoding": "one_hot",
    "test_size": 0.2,
    "split": "by_user",
    "seed": SEED,
}


def train_models(train: pd.DataFrame, features: list, params: dict):
    """Return (label classifier, quality regressor) pipelines trained on the given feature columns.

    exercise_id is one-hot encoded inside each pipeline (unseen exercises become all zeros) rather
    than using native categorical splits, so the models convert to ONNX for the Hub (CONN-10).
    """
    common = dict(
        max_iter=params["max_iter"],
        learning_rate=params["learning_rate"],
        max_leaf_nodes=params["max_leaf_nodes"],
        l2_regularization=params["l2_regularization"],
        random_state=params["seed"],
    )

    def pipeline(estimator):
        encode = ColumnTransformer(
            [("exercise", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["exercise_id"])],
            remainder="passthrough",
        )
        return Pipeline([("encode", encode), ("model", estimator)])

    clf = pipeline(HistGradientBoostingClassifier(class_weight="balanced", **common))
    clf.fit(train[features], train["label"])
    reg = pipeline(HistGradientBoostingRegressor(**common))
    reg.fit(train[features], train["quality"])
    return clf, reg


# COMMAND ----------

# MAGIC %md ## Serving wrapper
# MAGIC
# MAGIC One model returns both outputs, so CONN-05 makes a single call per set.

# COMMAND ----------


class FormQualityModel(mlflow.pyfunc.PythonModel):
    def __init__(self, classifier, regressor, features):
        self.classifier = classifier
        self.regressor = regressor
        self.features = features  # columns the pipelines were fit on; the rest of the input is ignored

    def _prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        X = pd.DataFrame(index=df.index)
        X["exercise_id"] = df["exercise_id"].astype(str)  # unseen exercises are ignored by the encoder
        for col in NUMERIC_FEATURES:
            X[col] = pd.to_numeric(df.get(col), errors="coerce").astype("float64")
        return X[self.features]

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        X = self._prepare(model_input)
        return pd.DataFrame({
            "quality": np.clip(self.regressor.predict(X), 0.0, 1.0),
            "label": self.classifier.predict(X),
        })


# Explicit schema for callers (CONN-05). Numeric inputs accept any number and may be null:
# the API is Node, where JSON.stringify(78.0) == "78", and inferred double columns reject ints.
# The model coerces them itself in _prepare.
SIGNATURE = ModelSignature(
    inputs=Schema(
        [ColSpec("string", "exercise_id")]
        + [ColSpec(AnyType(), col, required=False) for col in NUMERIC_FEATURES]
    ),
    outputs=Schema([ColSpec("double", "quality"), ColSpec("string", "label")]),
)

# COMMAND ----------

# MAGIC %md ## Run: split, train, evaluate, log, register

# COMMAND ----------

split = GroupShuffleSplit(n_splits=1, test_size=PARAMS["test_size"], random_state=SEED)
train_idx, test_idx = next(split.split(reps, groups=reps["user_id"]))  # no lifter in both sets
train, test = reps.iloc[train_idx], reps.iloc[test_idx]

with mlflow.start_run(run_name="form_quality_baseline") as run:
    mlflow.log_params(PARAMS)
    mlflow.log_params({
        "source_table": SOURCE_TABLE,
        "features": ",".join(used_features),
        "skipped_features": ",".join(skipped) or "none",
        "labels_from": "phone_rule_flags",
    })
    mlflow.log_input(mlflow.data.from_pandas(reps[FEATURES + ["label", "quality"]], name=SOURCE_TABLE), context="training")

    clf, reg = train_models(train, used_features, PARAMS)
    model = FormQualityModel(clf, reg, used_features)
    pred = model.predict(None, test[FEATURES])

    metrics = {
        "train_reps": len(train),
        "test_reps": len(test),
        "test_lifters": test["user_id"].nunique(),
        "label_accuracy": accuracy_score(test["label"], pred["label"]),
        "label_macro_f1": f1_score(test["label"], pred["label"], average="macro"),
        "quality_mae": mean_absolute_error(test["quality"], pred["quality"]),
        "quality_r2": r2_score(test["quality"], pred["quality"]),
    }
    classes = sorted(reps["label"].unique())
    per_class = f1_score(test["label"], pred["label"], average=None, labels=classes, zero_division=0)
    metrics.update({f"f1_{name}": score for name, score in zip(classes, per_class)})
    mlflow.log_metrics(metrics)

    example = test[FEATURES].head(5).astype({"exercise_id": str})  # serving sends plain strings
    info = mlflow.pyfunc.log_model(
        name="model",
        python_model=model,
        input_example=example,
        signature=SIGNATURE,
        # Pinned to this notebook's versions: serving must unpickle the exact same objects.
        pip_requirements=[
            f"mlflow=={mlflow.__version__}",
            f"cloudpickle=={cloudpickle.__version__}",
            f"scikit-learn=={sklearn.__version__}",
            f"pandas=={pd.__version__}",
            f"numpy=={np.__version__}",
        ],
        registered_model_name=MODEL_NAME,
    )

print(f"Run {run.info.run_id}: " + ", ".join(f"{k}={v:.3f}" for k, v in metrics.items() if isinstance(v, float)))
print(f"Registered {MODEL_NAME} version {info.registered_model_version}")

# COMMAND ----------

# MAGIC %md ## Promote
# MAGIC
# MAGIC Move `champion` to the new version only if its held-out macro F1 is at least as good.

# COMMAND ----------

client = MlflowClient()
new_version = info.registered_model_version

try:
    current = client.get_model_version_by_alias(MODEL_NAME, ALIAS)
    current_f1 = client.get_run(current.run_id).data.metrics.get("label_macro_f1", 0.0)
except Exception:  # no champion yet
    current, current_f1 = None, -1.0

if metrics["label_macro_f1"] >= current_f1:
    client.set_registered_model_alias(MODEL_NAME, ALIAS, new_version)
    print(f"{ALIAS} -> version {new_version} (macro F1 {metrics['label_macro_f1']:.3f} vs {current_f1:.3f})")
else:
    print(f"Kept {ALIAS} on version {current.version} (macro F1 {current_f1:.3f} > {metrics['label_macro_f1']:.3f})")
