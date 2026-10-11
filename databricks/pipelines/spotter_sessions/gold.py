# CONN-03 gold: tables synced to Neon (CONN-06), used by dashboards, Genie and MLflow.
# Published to spotter.gold; bronze and silver stay in the pipeline's default schema (spotter.raw).

from pyspark import pipelines as dp
from pyspark.sql import Window
from pyspark.sql import functions as F

GOLD = "spotter.gold"
BEGINNER_BASELINE = 0.70  # Architecture §8: first workout is compared with 70% clean
WINDOW_FRAMES = 32  # Architecture §6.3: form model input is 32 frames x 17 joints x 2

# Rule id -> form-model label (Architecture §6.3). First match wins.
LABELS = [
    ("depth", "partial_range"),
    ("knee_tracking", "knees_in"),
    ("trunk_lean", "forward_lean"),
    ("tempo", "fast_lowering"),
]

BODY_PART = {
    "knee": ["squat", "lunge", "split_squat", "leg_press", "step_up"],
    "lower_back": ["deadlift", "romanian_deadlift", "good_morning", "row", "hip_thrust"],
    "shoulder": ["bench_press", "overhead_press", "push_up", "dip"],
}

# Weak-label risk score (Architecture §11.2). A training-load and form-trend score,
# not a diagnosis. Each component is scaled to 0-1, then weighted.
RISK_WEIGHTS = {
    "flag_rate_rising": 0.30,
    "range_shrinking": 0.20,
    "asymmetry": 0.20,
    "acute_chronic_load": 0.20,
    "tempo_speeding_up": 0.10,
}


def clip01(col):
    # greatest/least skip nulls, so guard explicitly: missing data means no risk, not max risk.
    return F.when(col.isNotNull(), F.greatest(F.lit(0.0), F.least(F.lit(1.0), col)))


def body_part(col):
    expr = F.lit("general")
    for part, exercises in BODY_PART.items():
        expr = F.when(col.isin(exercises), F.lit(part)).otherwise(expr)
    return expr


@dp.materialized_view(name=f"{GOLD}.gold_user_progress_daily",
                      comment="Per lifter, day and exercise: reps, volume, range, quality, estimated 1RM and PRs")
def gold_user_progress_daily():
    reps = spark.read.table("silver_reps")
    sets = reps.groupBy("user_id", "session_date", "exercise_id", "session_id", "set_index").agg(
        F.count("*").alias("reps"),
        F.first("weight_kg", ignorenulls=True).alias("weight_kg"),
    ).withColumn(  # Epley
        "est_1rm_kg", F.col("weight_kg") * (1 + F.col("reps") / 30)
    )
    per_set = sets.groupBy("user_id", "session_date", "exercise_id").agg(
        F.count("*").alias("sets"),
        F.sum(F.col("reps") * F.coalesce("weight_kg", F.lit(0.0))).alias("volume_kg"),
        F.max("est_1rm_kg").alias("est_1rm_kg"),
    )
    scored = ~F.array_contains(F.col("flags"), "manual_unscored")
    per_rep = reps.groupBy("user_id", "session_date", "exercise_id").agg(
        F.count("*").alias("reps"),
        F.count(F.when(scored, 1)).alias("scored_reps"),
        F.sum(F.when(scored, F.col("is_clean").cast("int"))).alias("clean_reps"),
        F.avg(F.when(scored, F.col("range_deg"))).alias("avg_range_deg"),
        F.avg(F.when(scored, F.col("quality"))).alias("avg_quality"),
        F.avg("asymmetry").alias("avg_asymmetry"),
    )
    history = Window.partitionBy("user_id", "exercise_id").orderBy("session_date") \
        .rowsBetween(Window.unboundedPreceding, -1)
    return per_rep.join(per_set, ["user_id", "session_date", "exercise_id"]).select(
        "*",
        F.try_divide("clean_reps", "scored_reps").alias("clean_share"),
        (F.col("est_1rm_kg") > F.coalesce(F.max("est_1rm_kg").over(history), F.lit(0.0)))
        .alias("is_pr"),
    ).drop("scored_reps")


@dp.materialized_view(name=f"{GOLD}.gold_workout_medals",
                      comment="Workout medal vs the lifter's own 4-week average (Architecture §8)")
def gold_workout_medals():
    # INT-06: is_clean comes from the phone's rule flags (silver_reps), never the model's quality.
    # Same rules as the API's medals.ts; specs/set-record/fixtures/medals/ checks they agree.
    sessions = spark.read.table("silver_reps").groupBy("session_id", "user_id", "session_date").agg(
        F.max("finished_at").alias("finished_at"),
        F.count("*").alias("total_reps"),
        F.sum(F.col("is_clean").cast("int")).alias("clean_reps"),
    ).withColumn("clean_share", F.col("clean_reps") / F.col("total_reps"))

    # Previous 28 days, excluding this session.
    four_weeks = Window.partitionBy("user_id").orderBy(F.col("finished_at").cast("long")) \
        .rangeBetween(-28 * 86400, -1)
    baseline = F.coalesce(F.avg("clean_share").over(four_weeks), F.lit(BEGINNER_BASELINE))

    return sessions.withColumn("baseline_share", baseline).withColumn(
        "tier",
        F.when(F.col("clean_reps") == F.col("total_reps"), "gold")
        # Rounded so "matched the average" isn't lost to float error.
        .when(F.round("clean_share", 4) >= F.round("baseline_share", 4), "silver")
        .otherwise("bronze"),
    )


@dp.materialized_view(name=f"{GOLD}.gold_form_summary",
                      comment="Flag rate per exercise and rule, by experience level and injury group")
def gold_form_summary():
    keys = ["exercise_id", "experience_level", "injury_group"]
    reps = spark.read.table("silver_reps").select(
        "rep_id", "user_id", "exercise_id", "flags",
        F.coalesce("experience_level", F.lit("unknown")).alias("experience_level"),
        F.explode_outer("injury_groups").alias("injury_group"),
    ).withColumn("injury_group", F.coalesce("injury_group", F.lit("none")))

    totals = reps.groupBy(*keys).agg(
        F.count("*").alias("reps"),
        F.countDistinct("user_id").alias("lifters"),
    )
    flagged = reps.select(*keys, "rep_id", F.explode(F.array_distinct("flags")).alias("rule_id")) \
        .groupBy(*keys, "rule_id").agg(F.count("*").alias("flagged_reps"))

    return flagged.join(totals, keys).withColumn(
        "flag_rate", F.col("flagged_reps") / F.col("reps")
    )


@dp.materialized_view(name=f"{GOLD}.gold_training_features",
                      comment="32-frame normalised rep windows (17 joints x 2) with quality and label")
@dp.expect_or_drop("enough_frames", "frame_count >= 8")
def gold_training_features():
    frames = spark.read.table("silver_frames").groupBy("rep_id").agg(
        F.array_sort(F.collect_list(F.struct("t_ms", "kp_norm"))).alias("frames"),
    )
    # Nearest-frame resample to a fixed length.
    window = F.expr(
        f"transform(sequence(0, {WINDOW_FRAMES - 1}), "
        f"i -> frames[cast(round(i * (size(frames) - 1) / {WINDOW_FRAMES - 1}) as int)].kp_norm)"
    )

    label = F.lit("other")
    for rule_id, name in reversed(LABELS):
        label = F.when(F.array_contains("flags", rule_id), name).otherwise(label)
    label = F.when(F.size("flags") == 0, "clean").otherwise(label)

    reps = spark.read.table("silver_reps").select(
        "rep_id", "user_id", "session_date", "exercise_id", "experience_level",
        "frame_count", "quality", "flags",
    )
    return reps.join(frames, "rep_id").select(
        "rep_id", "user_id", "session_date", "exercise_id", "experience_level", "frame_count",
        window.alias("window"),
        "quality", "flags", label.alias("label"),
    )


@dp.materialized_view(name=f"{GOLD}.gold_injury_risk_scores",
                      comment="Heuristic training-load and form-trend score per lifter and body part. "
                              "Range is the injured side when known (range_side = injured), else the smaller side (min). "
                              "Not a diagnosis.")
def gold_injury_risk_scores():
    reps = spark.read.table("silver_reps").filter(~F.array_contains(F.col("flags"), "manual_unscored")).withColumn("body_part", body_part(F.col("exercise_id")))
    # Range on the injured side when silver_reps knows it ("left"/"right"), else the smaller side,
    # so the heuristic and the AI-14 model share one definition. The side is resolved once per
    # lifter and body part from the latest session that says so (as gold_rom_trend does), so a
    # tag that comes or goes mid-window can't mix sides inside the 7/28-day ranges.
    injured = reps.filter(F.col("injured_side").isin("left", "right")) \
        .groupBy("user_id", "body_part").agg(F.max_by("injured_side", "session_date").alias("resolved_side"))
    reps = reps.join(injured, ["user_id", "body_part"], "left").withColumn(
        "rep_range",
        F.when(F.col("resolved_side") == "left", F.col("left_range_deg"))
        .when(F.col("resolved_side") == "right", F.col("right_range_deg"))
        .otherwise(F.least("left_range_deg", "right_range_deg")),
    )
    daily = reps.groupBy("user_id", "body_part", "session_date").agg(
        F.count("*").alias("reps"),
        F.sum(F.when(F.size("flags") > 0, 1).otherwise(0)).alias("flagged_reps"),
        # Bodyweight sets count each rep as 1 kg so they still add load.
        F.sum(F.coalesce("weight_kg", F.lit(1.0))).alias("volume"),
        F.sum("rep_range").alias("sum_range"),
        F.count("rep_range").alias("n_range"),
        # Constant per lifter and body part: 'injured' once any session names the side.
        F.when(F.max(F.col("resolved_side").isNotNull().cast("int")) == 1, "injured").otherwise("min").alias("range_side"),
        F.sum("asymmetry").alias("sum_asym"),
        F.count("asymmetry").alias("n_asym"),
        F.sum("lowering_ms").alias("sum_lowering"),
        F.count("lowering_ms").alias("n_lowering"),
    ).withColumn("day", F.datediff("session_date", F.lit("2020-01-01")))

    def roll(days):
        return Window.partitionBy("user_id", "body_part").orderBy("day").rangeBetween(-(days - 1), 0)

    def ratio(num, den, w):
        return F.try_divide(F.sum(num).over(w), F.sum(den).over(w))

    w7, w28 = roll(7), roll(28)
    feats = daily.select(
        "user_id", "body_part", "day", F.col("session_date").alias("date"),
        ratio("flagged_reps", "reps", w7).alias("flag_rate_7d"),
        ratio("flagged_reps", "reps", w28).alias("flag_rate_28d"),
        ratio("sum_range", "n_range", w7).alias("range_7d"),
        ratio("sum_range", "n_range", w28).alias("range_28d"),
        "range_side",  # 'injured' or 'min', the same on every day of a lifter and body part
        ratio("sum_asym", "n_asym", w7).alias("asymmetry_7d"),
        F.sum("volume").over(w7).alias("volume_7d"),
        F.sum("volume").over(w28).alias("volume_28d"),
        ratio("sum_lowering", "n_lowering", w7).alias("lowering_ms_7d"),
        ratio("sum_lowering", "n_lowering", w28).alias("lowering_ms_28d"),
    ).withColumn(
        "days_tracked", F.col("day") - F.min("day").over(Window.partitionBy("user_id", "body_part")) + 1
    ).withColumn(
        # Acute (7 d) vs chronic (weekly average over up to 28 d). Needs 3 weeks of history,
        # or a new lifter's first week looks like a load spike.
        "acwr",
        F.when(
            F.col("days_tracked") >= 21,
            F.try_divide(F.col("volume_7d"),
                         F.col("volume_28d") / (F.least(F.col("days_tracked"), F.lit(28)) / 7)),
        ),
    )

    parts = {
        "flag_rate_rising": clip01((F.col("flag_rate_7d") - F.col("flag_rate_28d")) / 0.2),
        "range_shrinking": clip01(F.try_divide(F.col("range_28d") - F.col("range_7d"), F.col("range_28d")) / 0.2),
        "asymmetry": clip01((F.col("asymmetry_7d") - 0.15) / 0.15),
        "acute_chronic_load": clip01((F.col("acwr") - 1.3) / 0.5),
        "tempo_speeding_up": clip01(F.try_divide(F.col("lowering_ms_28d") - F.col("lowering_ms_7d"),
                                                 F.col("lowering_ms_28d")) / 0.3),
    }
    contribs = [
        F.struct(F.coalesce(expr * weight, F.lit(0.0)).alias("c"), F.lit(name).alias("name"))
        for name, weight in RISK_WEIGHTS.items()
        for expr in [parts[name]]
    ]
    ranked = F.sort_array(F.array(*contribs), asc=False)

    return feats.select(
        "*",
        F.aggregate(ranked, F.lit(0.0), lambda acc, s: acc + s["c"]).alias("score"),
        F.slice(F.transform(F.filter(ranked, lambda s: s["c"] >= 0.01), lambda s: s["name"]), 1, 3)
        .alias("top_features"),
    ).withColumn("weak_label", F.col("score") >= 0.5).drop("day", "days_tracked")


# ---- Range of motion (CONN-14, Architecture §1.1) ----

ROM_PERCENTILE = 0.9  # robust weekly peak: one bad frame can't spike it
ROM_BASELINE_WEEKS = 2  # first two calendar weeks of data (after the rehab plan's start, if any)
ROM_MIN_WEEK_REPS = 3


@dp.materialized_view(name=f"{GOLD}.gold_rom_trend",
                      comment="Weekly range of motion per lifter, angle and side, vs the baseline and the healthy side")
@dp.expect_or_drop("range_in_degrees", "peak_range_deg BETWEEN 0 AND 180")
@dp.expect_or_drop("enough_reps", f"reps >= {ROM_MIN_WEEK_REPS}")
def gold_rom_trend():
    keys = ["user_id", "angle", "side"]
    reps = spark.read.table("silver_reps")

    # One row per rep and side. Ranges come from the joint frames, so reps without frames drop out.
    sides = reps.select(
        "user_id", "angle", "session_date", "rehab_start_on", "injured_side",
        F.explode(F.array(
            F.struct(F.lit("left").alias("side"), F.col("left_range_deg").alias("range_deg")),
            F.struct(F.lit("right").alias("side"), F.col("right_range_deg").alias("range_deg")),
        )).alias("s"),
    ).select("user_id", "angle", "session_date", "rehab_start_on", "injured_side", "s.side", "s.range_deg") \
     .filter(F.col("range_deg").isNotNull()) \
     .withColumn("week", F.date_trunc("week", "session_date").cast("date"))

    # Baseline window: the first two calendar weeks of data on or after the rehab plan's start, or
    # of all data when there's no plan. Whole weeks, so the window matches the weekly rows.
    plan = sides.groupBy("user_id").agg(F.max("rehab_start_on").alias("plan_start"))
    window_start = sides.join(plan, "user_id") \
        .filter(F.col("plan_start").isNull() | (F.col("session_date") >= F.col("plan_start"))) \
        .groupBy(*keys).agg(F.min("week").alias("window_start"))
    baseline = sides.join(window_start, keys) \
        .filter((F.col("week") >= F.col("window_start"))
                & (F.col("week") < F.date_add("window_start", 7 * ROM_BASELINE_WEEKS))) \
        .groupBy(*keys).agg(F.percentile_approx("range_deg", ROM_PERCENTILE).alias("baseline_range_deg"))

    weekly = sides.groupBy(*keys, "week").agg(
        F.percentile_approx("range_deg", ROM_PERCENTILE).alias("peak_range_deg"),
        F.count("*").alias("reps"),
    )

    # The injured side per lifter and angle, from the latest session that says so.
    injured = sides.filter(F.col("injured_side").isin("left", "right")) \
        .groupBy("user_id", "angle").agg(F.max_by("injured_side", "session_date").alias("injured_side"))
    other = weekly.select(
        "user_id", "angle", "week",
        F.when(F.col("side") == "left", "right").otherwise("left").alias("side"),
        F.col("peak_range_deg").alias("other_side_peak"),
    )

    return weekly.join(baseline, keys, "left") \
        .join(other, [*keys, "week"], "left") \
        .join(injured, ["user_id", "angle"], "left") \
        .select(
            "user_id", "angle", "side", "week", "reps",
            F.round("peak_range_deg", 1).alias("peak_range_deg"),
            F.round("baseline_range_deg", 1).alias("baseline_range_deg"),
            # Filled in on the injured side's rows: the other (healthy) side's peak that week.
            F.when(F.col("side") == F.col("injured_side"), F.round("other_side_peak", 1))
            .alias("healthy_side_range_deg"),
            F.round(F.col("peak_range_deg") - F.col("baseline_range_deg"), 1).alias("change_deg"),
        )
