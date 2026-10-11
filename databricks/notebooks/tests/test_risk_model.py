"""Pure Python contract checks for databricks/notebooks/risk_model.py (AI-14); no Spark or Databricks.

Run:
    cd databricks/pipelines && uv run --no-project --with pytest --with xgboost==2.1.3 \
        --with scikit-learn --with pandas --with numpy python -m pytest ../notebooks/tests/test_risk_model.py -q

How the notebook is loaded
--------------------------
The test reads risk_model.py and executes everything ABOVE the first line that is exactly

    # MAGIC %md ## Run

(the same marker as generate_synthetic_sessions.py). Lines whose stripped text starts with `%`
(e.g. `%pip install xgboost==2.1.3`) or `dbutils.library.` are dropped first. So the code above the
marker may only import numpy, pandas, xgboost and sklearn, and must not touch `spark`, `dbutils`
or `mlflow`. Reading tables, MLflow logging, registration and table writes go below the marker.
The file must contain `%pip install xgboost==<pinned>`, and its first cell (the text before the
first `# COMMAND ----------`) must say "not a diagnosis" and mention heuristic labels.

Input frame
-----------
`df` is a pandas DataFrame shaped like spotter.gold.gold_injury_risk_scores (one row per
user_id x body_part x date): user_id, body_part, date (datetime.date or datetime64), flag_rate_7d,
flag_rate_28d, range_7d, range_28d, asymmetry_7d, volume_7d, volume_28d, lowering_ms_7d,
lowering_ms_28d, acwr, score, top_features, weak_label. Any numeric value may be NaN/None.

Module constants (above the marker)
-----------------------------------
MODEL_NAME = "spotter.ml.injury_risk"
SOURCE_TABLE = "spotter.gold.gold_injury_risk_scores"
MODEL_SCORES_TABLE = "spotter.gold.gold_injury_risk_model_scores"
IMPORTANCE_TABLE = "spotter.gold.gold_risk_feature_importance"
MODEL_TABLE_COMMENT = ("Training-load and form-trend score from a model trained on heuristic labels. "
                       "Not a diagnosis.")
IMPORTANCE_TABLE_COMMENT: str containing "Not a diagnosis"
SEED: int
PARAMS: dict of default XGBClassifier params
BODY_PARTS = ["general", "knee", "lower_back", "shoulder"]   (gold.py BODY_PART keys + "general")
FAMILIES: dict family -> list of feature columns, in this order:
    "flag_rate_rising":   ["flag_rate_7d", "flag_rate_28d", "flag_rate_change"]
    "range_shrinking":    ["range_7d", "range_28d", "range_change"]
    "asymmetry":          ["asymmetry_7d"]
    "acute_chronic_load": ["acwr", "volume_7d"]
    "tempo_speeding_up":  ["lowering_ms_7d", "lowering_ms_28d", "lowering_ms_change"]
FEATURE_COLUMNS: list = the FAMILIES columns in that order, then f"body_part_{p}" for p in BODY_PARTS
FEATURE_FAMILIES: dict feature -> family for every FEATURE_COLUMNS entry; one-hots map to "body_part"
OUTPUT_COLUMNS = ["user_id", "body_part", "date", "score", "top_features", "model_version", "scored_at"]

Functions (above the marker)
----------------------------
build_features(df) -> X
    float DataFrame, columns exactly FEATURE_COLUMNS, same index as df, input not mutated.
    flag_rate_change = flag_rate_7d - flag_rate_28d
    range_change = (range_7d - range_28d) / range_28d            (NaN when range_28d is 0 or NaN)
    lowering_ms_change = (lowering_ms_7d - lowering_ms_28d) / lowering_ms_28d   (same rule)
    body_part_<p> = 1.0 if body_part == p else 0.0 (unknown parts are all zeros).
    Missing values stay NaN. Each row's features come from that row only (no future rows, no
    score / weak_label / top_features).

forecast_labels(df, horizon_days=7) -> copy of df (same index and order) plus
    label: bool, True if weak_label is True on any row of the same user_id + body_part whose
           date is in (D, D + horizon_days] (calendar days; D itself does not count).
    trainable: bool, D + horizon_days <= the latest date for that user_id + body_part.

split_by_user(df, test_size=0.2, seed=SEED) -> (train_df, test_df)
    Partition of df's rows by user_id: no user in both, every row in exactly one, both non-empty
    when there are >= 2 users, same result for the same seed.

train(train_df, params=None) -> xgboost.XGBClassifier
    train_df has `label` and `trainable`; fits build_features(...) on trainable rows only, with
    params = PARAMS updated by `params`. scale_pos_weight = negatives / positives of those rows
    unless `params` sets it.

evaluate(model, test_df) -> {"model": {...}, "heuristic": {...}}
    Each inner dict has float "roc_auc", "pr_auc" (average precision) and "brier", computed on the
    trainable rows against `label`. "model" uses model.predict_proba(build_features(...))[:, 1];
    "heuristic" uses the row's own `score` (clipped to [0, 1]) as the forecast.

contributions(model, X) -> DataFrame, same index as X
    One float column per FAMILIES key (in order) = sum of XGBoost pred_contribs (log-odds) over that
    family's features (body_part one-hots and the bias are left out), plus `top_features`
    (= top_families of those columns).

top_families(family_contribs, k=3, min_contribution=0.01) -> list[list[str]]
    Per row: family names with contribution >= min_contribution, largest first, at most k; ties
    keep FAMILIES order. NaN counts as 0.

importance(model) -> (per_feature, per_family)
    per_feature: columns feature, family, gain, rank; one row per FEATURE_COLUMNS entry. gain is the
    booster's "total_gain" (0.0 for unused features) divided by the total, so gains sum to 1.
    Sorted by gain desc; rank 1..n.
    per_family: columns family, gain, rank; gain = sum of its features' gains; sorted desc; rank 1..n.

score_rows(model, df, model_version, scored_at) -> DataFrame with columns exactly OUTPUT_COLUMNS,
    one row per df row: score = model probability in [0, 1], top_features from contributions().
"""
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "databricks/notebooks/risk_model.py"
RUN_MARKER = "# MAGIC %md ## Run"
FAMILY_NAMES = ["flag_rate_rising", "range_shrinking", "asymmetry", "acute_chronic_load", "tempo_speeding_up"]


def load_notebook() -> dict:
    if not NOTEBOOK.exists():
        raise FileNotFoundError(f"{NOTEBOOK} does not exist yet (AI-14 notebook not written)")
    lines = NOTEBOOK.read_text().splitlines()
    if RUN_MARKER not in lines:
        raise AssertionError(f"risk_model.py has no line exactly {RUN_MARKER!r}")
    head = lines[: lines.index(RUN_MARKER)]
    kept = [l for l in head if not l.lstrip().startswith("%") and not l.lstrip().startswith("dbutils.library.")]
    ns = {"__name__": "risk_model_contract"}
    exec(compile("\n".join(kept) + "\n", str(NOTEBOOK), "exec"), ns)
    return ns


ns = load_notebook()

D0 = date(2026, 8, 1)


def row(user="u1", part="knee", day=0, weak=False, **overrides):
    base = {
        "user_id": user, "body_part": part, "date": D0 + timedelta(days=day),
        "flag_rate_7d": 0.1, "flag_rate_28d": 0.1, "range_7d": 90.0, "range_28d": 90.0,
        "asymmetry_7d": 0.05, "volume_7d": 1000.0, "volume_28d": 4000.0,
        "lowering_ms_7d": 1500.0, "lowering_ms_28d": 1500.0, "acwr": 1.0,
        "score": 0.6 if weak else 0.1, "top_features": [], "weak_label": weak,
    }
    base.update(overrides)
    return base


def synthetic_frame(users=12, days=40, seed=3) -> pd.DataFrame:
    """Lifters whose risk drifts in waves; the flag follows the 7-day flag rate with a lag."""
    rng = np.random.default_rng(seed)
    rows = []
    for u in range(users):
        for part in ["knee", "shoulder"]:
            phase = rng.uniform(0, 2 * np.pi)
            for d in range(days):
                risk = 0.5 + 0.5 * np.sin(phase + d / 4)
                ahead = 0.5 + 0.5 * np.sin(phase + (d + 4) / 4)
                weak = bool(risk > 0.7)
                rows.append(row(
                    f"user{u:02d}", part, d, weak,
                    flag_rate_7d=0.05 + 0.4 * ahead + rng.normal(0, 0.03),
                    flag_rate_28d=0.25 + rng.normal(0, 0.02),
                    range_7d=95 - 20 * ahead + rng.normal(0, 2),
                    range_28d=90 + rng.normal(0, 1),
                    asymmetry_7d=0.05 + 0.2 * risk + rng.normal(0, 0.02),
                    acwr=np.nan if d < 20 else 1.0 + 0.6 * ahead,
                    lowering_ms_7d=1500 - 400 * ahead,
                    score=float(np.clip(risk, 0, 1)) if weak else float(np.clip(risk * 0.6, 0, 1)),
                ))
    return pd.DataFrame(rows)


class Constants(unittest.TestCase):
    def test_tables_and_not_a_diagnosis_comments(self):
        self.assertEqual(ns["MODEL_NAME"], "spotter.ml.injury_risk")
        self.assertEqual(ns["SOURCE_TABLE"], "spotter.gold.gold_injury_risk_scores")
        self.assertEqual(ns["MODEL_SCORES_TABLE"], "spotter.gold.gold_injury_risk_model_scores")
        self.assertEqual(ns["IMPORTANCE_TABLE"], "spotter.gold.gold_risk_feature_importance")
        self.assertEqual(ns["MODEL_TABLE_COMMENT"],
                         "Training-load and form-trend score from a model trained on heuristic labels. "
                         "Not a diagnosis.")
        self.assertIn("Not a diagnosis", ns["IMPORTANCE_TABLE_COMMENT"])
        self.assertEqual(ns["OUTPUT_COLUMNS"],
                         ["user_id", "body_part", "date", "score", "top_features", "model_version", "scored_at"])

    def test_header_states_trend_score_and_heuristic_labels(self):
        text = NOTEBOOK.read_text()
        self.assertIn("%pip install xgboost==", text)
        header = text.split("# COMMAND ----------")[0].lower()
        self.assertIn("not a diagnosis", header)
        self.assertIn("heuristic", header)


class Features(unittest.TestCase):
    def test_family_grouping(self):
        self.assertEqual(list(ns["FAMILIES"]), FAMILY_NAMES)
        self.assertEqual(ns["FAMILIES"], {
            "flag_rate_rising": ["flag_rate_7d", "flag_rate_28d", "flag_rate_change"],
            "range_shrinking": ["range_7d", "range_28d", "range_change"],
            "asymmetry": ["asymmetry_7d"],
            "acute_chronic_load": ["acwr", "volume_7d"],
            "tempo_speeding_up": ["lowering_ms_7d", "lowering_ms_28d", "lowering_ms_change"],
        })
        one_hots = [f"body_part_{p}" for p in ns["BODY_PARTS"]]
        self.assertEqual(ns["BODY_PARTS"], ["general", "knee", "lower_back", "shoulder"])
        self.assertEqual(ns["FEATURE_COLUMNS"], [c for cols in ns["FAMILIES"].values() for c in cols] + one_hots)
        expected = {c: fam for fam, cols in ns["FAMILIES"].items() for c in cols}
        expected.update({c: "body_part" for c in one_hots})
        self.assertEqual(ns["FEATURE_FAMILIES"], expected)

    def test_derived_columns_one_hot_and_nan(self):
        df = pd.DataFrame([
            row(part="knee", flag_rate_7d=0.4, flag_rate_28d=0.1, range_7d=72.0, range_28d=90.0,
                lowering_ms_7d=1200.0, lowering_ms_28d=1500.0),
            row(part="shoulder", acwr=None, range_28d=0.0, lowering_ms_28d=np.nan),
            row(part="mystery"),
        ])
        before = df.copy()
        X = ns["build_features"](df)
        pd.testing.assert_frame_equal(df, before)
        self.assertEqual(list(X.columns), ns["FEATURE_COLUMNS"])
        self.assertEqual(list(X.index), list(df.index))
        self.assertTrue(all(np.issubdtype(t, np.floating) for t in X.dtypes))
        self.assertAlmostEqual(X.loc[0, "flag_rate_change"], 0.3)
        self.assertAlmostEqual(X.loc[0, "range_change"], -0.2)
        self.assertAlmostEqual(X.loc[0, "lowering_ms_change"], -0.2)
        self.assertEqual(X.loc[0, "body_part_knee"], 1.0)
        self.assertEqual(X.loc[0, ["body_part_general", "body_part_lower_back", "body_part_shoulder"]].sum(), 0.0)
        self.assertTrue(np.isnan(X.loc[1, "acwr"]))
        self.assertTrue(np.isnan(X.loc[1, "range_change"]))
        self.assertTrue(np.isnan(X.loc[1, "lowering_ms_change"]))
        self.assertEqual(X.loc[1, "body_part_shoulder"], 1.0)
        self.assertEqual(X.loc[2, [f"body_part_{p}" for p in ns["BODY_PARTS"]]].sum(), 0.0)

    def test_no_future_or_label_data_in_features(self):
        df = synthetic_frame(users=3, days=20)
        for col in ["score", "weak_label", "top_features", "label", "trainable", "user_id", "date"]:
            self.assertNotIn(col, ns["FEATURE_COLUMNS"])
        cutoff = D0 + timedelta(days=9)
        past = df["date"] <= cutoff
        full = ns["build_features"](df).loc[past]
        truncated = ns["build_features"](df.loc[past])
        pd.testing.assert_frame_equal(full, truncated)
        # Rewriting the future (features and flags) leaves past features untouched.
        future = df.copy()
        num = ["flag_rate_7d", "flag_rate_28d", "range_7d", "range_28d", "asymmetry_7d",
               "volume_7d", "volume_28d", "lowering_ms_7d", "lowering_ms_28d", "acwr", "score"]
        future.loc[~past, num] = future.loc[~past, num] * 5 + 1
        future.loc[~past, "weak_label"] = ~future.loc[~past, "weak_label"].astype(bool)
        pd.testing.assert_frame_equal(ns["build_features"](future).loc[past], full)
        # Same-day heuristic outputs don't change features either.
        same_day = df.copy()
        same_day["score"] = 1.0 - same_day["score"]
        same_day["weak_label"] = ~same_day["weak_label"].astype(bool)
        pd.testing.assert_frame_equal(ns["build_features"](same_day), ns["build_features"](df))


class Labels(unittest.TestCase):
    def test_label_window_is_after_d_up_to_d_plus_7(self):
        flag_on = {0, 8}  # flags on day 0 and day 8 only
        df = pd.DataFrame([row(day=d, weak=d in flag_on) for d in range(16)])
        out = ns["forecast_labels"](df, horizon_days=7)
        labels = dict(zip([(d - D0).days for d in out["date"]], out["label"].astype(bool)))
        self.assertFalse(labels[0])   # its own flag on day 0 doesn't count; day 8 is D+8
        self.assertTrue(labels[1])    # day 8 = D+7, inclusive
        self.assertTrue(labels[7])    # day 8 = D+1
        self.assertFalse(labels[8])   # its own flag doesn't count
        self.assertFalse(labels[9])
        self.assertNotIn("label", df.columns)
        self.assertEqual(list(out.index), list(df.index))

    def test_calendar_days_with_gaps_and_unsorted_rows(self):
        df = pd.DataFrame([row(day=d, weak=d == 12) for d in [0, 3, 4, 5, 12, 20]]).iloc[::-1]
        out = ns["forecast_labels"](df, horizon_days=7)
        got = {(d - D0).days: bool(l) for d, l in zip(out["date"], out["label"])}
        self.assertEqual(got, {0: False, 3: False, 4: False, 5: True, 12: False, 20: False})
        self.assertEqual(list(out.index), list(df.index))

    def test_flags_stay_within_user_and_body_part(self):
        df = pd.DataFrame([
            row("a", "knee", 0), row("a", "knee", 10),
            row("a", "shoulder", 0), row("a", "shoulder", 3, weak=True), row("a", "shoulder", 10),
            row("b", "knee", 0), row("b", "knee", 2, weak=True), row("b", "knee", 10),
        ])
        out = ns["forecast_labels"](df, horizon_days=7)
        self.assertEqual(out["label"].astype(bool).tolist(), [False, False, True, False, False, True, False, False])

    def test_tail_without_full_horizon_is_not_trainable(self):
        df = pd.DataFrame([row("a", day=d) for d in range(11)] + [row("b", day=d) for d in range(5)])
        out = ns["forecast_labels"](df, horizon_days=7)
        a = out[out["user_id"] == "a"]["trainable"].astype(bool).tolist()
        self.assertEqual(a, [True] * 4 + [False] * 7)  # day 3 + 7 = day 10, the last tracked day
        self.assertFalse(out[out["user_id"] == "b"]["trainable"].any())
        short = ns["forecast_labels"](df, horizon_days=2)
        self.assertEqual(short[short["user_id"] == "a"]["trainable"].astype(bool).tolist(), [True] * 9 + [False] * 2)


class Split(unittest.TestCase):
    def test_users_are_disjoint_and_rows_preserved(self):
        df = ns["forecast_labels"](synthetic_frame(users=10, days=12))
        train, test = ns["split_by_user"](df, test_size=0.2, seed=7)
        self.assertTrue(len(train) and len(test))
        self.assertFalse(set(train["user_id"]) & set(test["user_id"]))
        self.assertEqual(sorted(train.index.tolist() + test.index.tolist()), sorted(df.index.tolist()))
        self.assertLess(test["user_id"].nunique(), df["user_id"].nunique())
        again_train, again_test = ns["split_by_user"](df, test_size=0.2, seed=7)
        self.assertEqual(set(again_test["user_id"]), set(test["user_id"]))


class Ranking(unittest.TestCase):
    def test_top_features_threshold_order_and_cap(self):
        fam = pd.DataFrame([
            {"flag_rate_rising": 0.2, "range_shrinking": 0.5, "asymmetry": 0.009, "acute_chronic_load": -0.4,
             "tempo_speeding_up": 0.01},
            {"flag_rate_rising": 0.3, "range_shrinking": 0.1, "asymmetry": 0.7, "acute_chronic_load": 0.2,
             "tempo_speeding_up": 0.05},
            {"flag_rate_rising": -1.0, "range_shrinking": 0.0, "asymmetry": np.nan, "acute_chronic_load": 0.005,
             "tempo_speeding_up": -0.2},
            {"flag_rate_rising": 0.2, "range_shrinking": 0.2, "asymmetry": 0.0, "acute_chronic_load": 0.0,
             "tempo_speeding_up": 0.0},
        ])
        self.assertEqual(ns["top_families"](fam), [
            ["range_shrinking", "flag_rate_rising", "tempo_speeding_up"],
            ["asymmetry", "flag_rate_rising", "acute_chronic_load"],
            [],
            ["flag_rate_rising", "range_shrinking"],
        ])


class Model(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = ns["forecast_labels"](synthetic_frame())
        cls.train_df, cls.test_df = ns["split_by_user"](cls.df, test_size=0.25, seed=7)
        cls.model = ns["train"](cls.train_df, {"n_estimators": 30, "max_depth": 3})

    def test_end_to_end_fit_gives_probabilities(self):
        import xgboost

        self.assertIsInstance(self.model, xgboost.XGBClassifier)
        X = ns["build_features"](self.test_df)
        p = self.model.predict_proba(X)[:, 1]
        self.assertEqual(len(p), len(self.test_df))
        self.assertTrue(np.all((p >= 0) & (p <= 1)))
        trainable = self.train_df[self.train_df["trainable"].astype(bool)]
        pos = trainable["label"].astype(bool).sum()
        self.assertGreater(pos, 0)
        self.assertAlmostEqual(self.model.get_params()["scale_pos_weight"], (len(trainable) - pos) / pos, places=6)
        override = ns["train"](self.train_df, {"n_estimators": 5, "scale_pos_weight": 1.0})
        self.assertEqual(override.get_params()["scale_pos_weight"], 1.0)

    def test_train_ignores_untrainable_rows(self):
        poisoned = self.train_df.copy()
        tail = ~poisoned["trainable"].astype(bool)
        poisoned.loc[tail, "label"] = ~poisoned.loc[tail, "label"].astype(bool)
        poisoned.loc[tail, ["flag_rate_7d", "range_7d"]] = 1e6
        a = ns["train"](self.train_df, {"n_estimators": 10})
        b = ns["train"](poisoned, {"n_estimators": 10})
        X = ns["build_features"](self.test_df)
        np.testing.assert_allclose(a.predict_proba(X), b.predict_proba(X))

    def test_evaluate_reports_model_and_heuristic(self):
        from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

        metrics = ns["evaluate"](self.model, self.test_df)
        self.assertEqual(set(metrics), {"model", "heuristic"})
        for side in metrics.values():
            self.assertTrue({"roc_auc", "pr_auc", "brier"} <= set(side))
            for key in ["roc_auc", "pr_auc", "brier"]:
                self.assertTrue(0.0 <= side[key] <= 1.0, (key, side[key]))
        t = self.test_df[self.test_df["trainable"].astype(bool)]
        y, s = t["label"].astype(int), t["score"].clip(0, 1)
        self.assertAlmostEqual(metrics["heuristic"]["roc_auc"], roc_auc_score(y, s), places=6)
        self.assertAlmostEqual(metrics["heuristic"]["pr_auc"], average_precision_score(y, s), places=6)
        self.assertAlmostEqual(metrics["heuristic"]["brier"], brier_score_loss(y, s), places=6)
        p = self.model.predict_proba(ns["build_features"](t))[:, 1]
        self.assertAlmostEqual(metrics["model"]["roc_auc"], roc_auc_score(y, p), places=6)

    def test_contributions_sum_families_and_rank(self):
        import xgboost

        X = ns["build_features"](self.test_df)
        out = ns["contributions"](self.model, X)
        self.assertEqual(list(out.index), list(X.index))
        self.assertEqual(list(out.columns), FAMILY_NAMES + ["top_features"])
        raw = self.model.get_booster().predict(xgboost.DMatrix(X), pred_contribs=True)
        per_feature = pd.DataFrame(raw[:, :-1], columns=X.columns, index=X.index)
        for fam, cols in ns["FAMILIES"].items():
            np.testing.assert_allclose(out[fam].to_numpy(), per_feature[cols].sum(axis=1).to_numpy(),
                                       rtol=1e-5, atol=1e-6)
        self.assertEqual(out["top_features"].tolist(), ns["top_families"](out[FAMILY_NAMES]))
        for tops in out["top_features"]:
            self.assertLessEqual(len(tops), 3)
            self.assertTrue(set(tops) <= set(FAMILY_NAMES))

    def test_importance_per_feature_and_family(self):
        per_feature, per_family = ns["importance"](self.model)
        self.assertEqual(sorted(per_feature["feature"]), sorted(ns["FEATURE_COLUMNS"]))
        self.assertTrue({"feature", "family", "gain", "rank"} <= set(per_feature.columns))
        self.assertTrue({"family", "gain", "rank"} <= set(per_family.columns))
        self.assertAlmostEqual(per_feature["gain"].sum(), 1.0, places=6)
        self.assertTrue((per_feature["gain"] >= 0).all())
        self.assertEqual(per_feature["family"].tolist(), [ns["FEATURE_FAMILIES"][f] for f in per_feature["feature"]])
        self.assertTrue(per_feature["gain"].is_monotonic_decreasing)
        self.assertEqual(per_feature["rank"].tolist(), list(range(1, len(per_feature) + 1)))
        total_gain = self.model.get_booster().get_score(importance_type="total_gain")
        top = per_feature.iloc[0]
        self.assertAlmostEqual(top["gain"], total_gain[top["feature"]] / sum(total_gain.values()), places=6)
        expected = per_feature.groupby("family")["gain"].sum()
        self.assertTrue(set(FAMILY_NAMES) <= set(per_family["family"]))
        for _, r in per_family.iterrows():
            self.assertAlmostEqual(r["gain"], expected[r["family"]], places=9)
        self.assertTrue(per_family["gain"].is_monotonic_decreasing)
        self.assertEqual(per_family["rank"].tolist(), list(range(1, len(per_family) + 1)))

    def test_score_rows_matches_output_table(self):
        scored_at = datetime(2026, 10, 10, 6, tzinfo=timezone.utc)
        out = ns["score_rows"](self.model, self.test_df, "3", scored_at)
        self.assertEqual(list(out.columns), ns["OUTPUT_COLUMNS"])
        self.assertEqual(len(out), len(self.test_df))
        self.assertTrue(out["score"].between(0, 1).all())
        self.assertTrue((out["model_version"] == "3").all())
        self.assertEqual(sorted(zip(out["user_id"], out["body_part"], out["date"])),
                         sorted(zip(self.test_df["user_id"], self.test_df["body_part"], self.test_df["date"])))
        self.assertTrue(all(set(t) <= set(FAMILY_NAMES) and len(t) <= 3 for t in out["top_features"]))


class ReviewFixes(unittest.TestCase):
    """Review follow-ups: SQL-safe comments, prior-corrected scores, champion lookup, skip status, datasets."""

    @classmethod
    def setUpClass(cls):
        cls.df = ns["forecast_labels"](synthetic_frame())
        cls.train_df, cls.test_df = ns["split_by_user"](cls.df, test_size=0.25, seed=7)
        cls.model = ns["train"](cls.train_df, {"n_estimators": 30, "max_depth": 3})
        cls.spw = float(cls.model.get_params()["scale_pos_weight"])

    def test_comment_sql_escapes_quotes(self):
        stmt = ns["comment_sql"]("spotter.gold.t", "The model's score. Not a diagnosis.")
        self.assertEqual(stmt, "COMMENT ON TABLE spotter.gold.t IS 'The model\\'s score. Not a diagnosis.'")
        self.assertEqual(ns["comment_sql"]("a.b.c", "back\\slash"), "COMMENT ON TABLE a.b.c IS 'back\\\\slash'")
        for table, comment in [(ns["MODEL_SCORES_TABLE"], ns["MODEL_TABLE_COMMENT"]),
                               (ns["IMPORTANCE_TABLE"], ns["IMPORTANCE_TABLE_COMMENT"])]:
            literal = ns["comment_sql"](table, comment).split(" IS ", 1)[1]
            self.assertTrue(literal.startswith("'") and literal.endswith("'"))
            body = literal[1:-1].replace("\\\\", "").replace("\\'", "")
            self.assertNotIn("'", body)

    def test_prior_correction_formula(self):
        p = np.array([0.0, 0.2, 0.5, 0.9, 1.0])
        out = ns["prior_correct"](p, 4.0)
        np.testing.assert_allclose(out, p / (p + (1 - p) * 4.0))
        np.testing.assert_allclose(ns["prior_correct"](p, 1.0), p)
        np.testing.assert_allclose(ns["prior_correct"](p, None), p)

    def test_score_rows_uses_prior_corrected_probability(self):
        self.assertNotAlmostEqual(self.spw, 1.0, places=3)  # so the correction changes the scores
        scored_at = datetime(2026, 10, 10, 6, tzinfo=timezone.utc)
        out = ns["score_rows"](self.model, self.test_df, "1", scored_at)
        raw = self.model.predict_proba(ns["build_features"](self.test_df))[:, 1]
        np.testing.assert_allclose(out["score"].to_numpy(), raw / (raw + (1 - raw) * self.spw), rtol=1e-6)

    def test_evaluate_brier_uses_corrected_probability(self):
        from sklearn.metrics import brier_score_loss, roc_auc_score

        t = self.test_df[self.test_df["trainable"].astype(bool)]
        y = t["label"].astype(int)
        raw = self.model.predict_proba(ns["build_features"](t))[:, 1]
        corrected = raw / (raw + (1 - raw) * self.spw)
        metrics = ns["evaluate"](self.model, self.test_df)
        self.assertAlmostEqual(metrics["model"]["brier"], brier_score_loss(y, corrected), places=6)
        self.assertAlmostEqual(metrics["model"]["roc_auc"], roc_auc_score(y, corrected), places=6)

    def test_alias_not_found_only_for_missing_champion(self):
        class FakeMlflowError(Exception):
            def __init__(self, msg, error_code):
                super().__init__(msg)
                self.error_code = error_code

        not_found = ns["is_not_found"]
        self.assertTrue(not_found(FakeMlflowError("Alias champion not found", "RESOURCE_DOES_NOT_EXIST")))
        self.assertTrue(not_found(FakeMlflowError("Registered model does not exist", "NOT_FOUND")))
        self.assertFalse(not_found(FakeMlflowError("Permission denied", "PERMISSION_DENIED")))
        self.assertFalse(not_found(ConnectionError("timed out")))

    def test_training_status_names_why_training_is_skipped(self):
        ok = {"train": {"trainable": 10, "positives": 3}, "test": {"trainable": 5, "positives": 1}}
        self.assertIsNone(ns["training_status"](ok))
        for split, pos in [("train", 0), ("train", 10), ("test", 0), ("test", 5)]:
            counts = {k: dict(v) for k, v in ok.items()}
            counts[split]["positives"] = pos
            status = ns["training_status"](counts)
            self.assertIsInstance(status, str)
            self.assertIn(split, status.lower())

    def test_dataset_frame_is_trainable_features_and_label(self):
        frame = ns["dataset_frame"](self.test_df)
        t = self.test_df[self.test_df["trainable"].astype(bool)]
        self.assertEqual(list(frame.columns), ns["FEATURE_COLUMNS"] + ["label"])
        self.assertEqual(list(frame.index), list(t.index))
        self.assertEqual(frame["label"].tolist(), t["label"].astype(int).tolist())



class ChampionRun(unittest.TestCase):
    """Free Edition: the model stays an MLflow run artifact; the champion is the run tagged champion=true."""

    def test_choose_champion_promotes_when_no_champion(self):
        choose = ns["choose_champion"]
        self.assertTrue(choose(None, 0.1))
        self.assertTrue(choose({}, 0.1))  # champion run without a test_pr_auc metric

    def test_choose_champion_compares_test_pr_auc(self):
        choose = ns["choose_champion"]
        self.assertTrue(choose({"test_pr_auc": 0.5}, 0.6))
        self.assertTrue(choose({"test_pr_auc": 0.5}, 0.5))  # ties promote
        self.assertFalse(choose({"test_pr_auc": 0.5}, 0.49))
        self.assertFalse(choose({"test_pr_auc": 0.5, "test_roc_auc": 0.1}, 0.4))

    def test_champion_tag_constants(self):
        self.assertEqual(ns["CHAMPION_TAG"], "champion")
        self.assertEqual(ns["MODEL_ARTIFACT_PATH"], "model")

    def test_registration_skip_reason_is_first_line(self):
        reason = ns["registration_skip_reason"]
        exc = Exception("S3UploadFailedError: AccessDenied PutObject\nTraceback (most recent call last):\n  ...")
        self.assertEqual(reason(exc), "S3UploadFailedError: AccessDenied PutObject")
        self.assertEqual(reason(Exception("")), "Exception")
        self.assertEqual(reason(ValueError("\n  \nsecond")), "second")  # first non-blank line
        self.assertLessEqual(len(reason(Exception("x" * 10000))), 500)

    def test_notebook_logs_run_artifact_and_scores_from_run(self):
        text = NOTEBOOK.read_text()
        run_part = text.split(RUN_MARKER, 1)[1]
        self.assertNotIn("registered_model_name", run_part)
        self.assertIn("mlflow.register_model(", run_part)
        self.assertIn("uc_registration", run_part)
        self.assertIn('f"runs:/{', run_part)
        self.assertNotIn("models:/", run_part)
        self.assertIn("free edition", text.lower())

if __name__ == "__main__":
    unittest.main()


class UcRegistrationOptIn(unittest.TestCase):
    """Each failed UC registration leaves a PENDING_REGISTRATION version, so it is opt-in."""

    def test_registration_is_behind_a_widget_off_by_default(self):
        src = NOTEBOOK.read_text()
        self.assertIn('dbutils.widgets.dropdown("register_uc", "false"', src)
        self.assertIn("delete_model_version", src)


class MetricsTable(unittest.TestCase):
    """The champion's held-out metrics, model vs heuristic, for the dashboard."""

    @classmethod
    def setUpClass(cls):
        cls.ns = load_notebook()

    def test_metrics_rows_pairs_model_and_heuristic(self):
        logged = {"test_roc_auc": 0.99, "test_pr_auc": 0.8, "test_brier": 0.003,
                  "heuristic_roc_auc": 0.9, "heuristic_pr_auc": 0.6, "heuristic_brier": 0.009,
                  "test_positives": 11.0, "test_trainable": 1375.0}
        rows = self.ns["metrics_rows"](logged, "run-1", "t")
        self.assertEqual([r["predictor"] for r in rows], ["model", "heuristic"])
        self.assertEqual(rows[0]["pr_auc"], 0.8)
        self.assertEqual(rows[1]["roc_auc"], 0.9)
        for r in rows:
            self.assertEqual((r["model_version"], r["trained_at"], r["test_positives"], r["test_rows"]),
                             ("run-1", "t", 11, 1375))

    def test_metrics_table_constants(self):
        self.assertEqual(self.ns["METRICS_TABLE"], "spotter.gold.gold_risk_model_metrics")
        self.assertIn("Not a diagnosis", self.ns["METRICS_TABLE_COMMENT"])
