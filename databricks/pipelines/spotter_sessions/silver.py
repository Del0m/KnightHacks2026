# CONN-03 silver: one row per rep, and per-frame joint angles for frames inside a rep.
# Materialized views so a re-uploaded session (same session_id) replaces the old one.
#
# Angles are computed on normalised image coordinates, so they're consistent per lifter
# and device (good for trends) but not exact degrees on non-square frames.
# Divisions use try_divide: serverless runs ANSI SQL, where x / 0 fails the whole update.

from pyspark import pipelines as dp
from pyspark.sql import Window
from pyspark.sql import functions as F

# COCO joint indexes (docs/pose/pose-result-contract.md)
L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST = 5, 6, 7, 8, 9, 10
L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE = 11, 12, 13, 14, 15, 16

# Which angle defines depth for each exercise. Anything unlisted uses the knee.
PRIMARY_ANGLE = {
    "hip": ["deadlift", "romanian_deadlift", "hip_thrust", "good_morning"],
    "elbow": ["bench_press", "overhead_press", "push_up", "bicep_curl", "row", "dip"],
}


def x(j): return F.col("kp")[3 * j]
def y(j): return F.col("kp")[3 * j + 1]
def c(j): return F.col("kp")[3 * j + 2]


def angle(a, b, cc):
    """Angle at joint b, in degrees, between b->a and b->cc."""
    ax, ay = x(a) - x(b), y(a) - y(b)
    cx, cy = x(cc) - x(b), y(cc) - y(b)
    cos = F.try_divide(ax * cx + ay * cy, F.sqrt(ax * ax + ay * ay) * F.sqrt(cx * cx + cy * cy))
    return F.degrees(F.acos(F.greatest(F.lit(-1.0), F.least(F.lit(1.0), cos))))


def primary(prefix_l, prefix_r):
    """Pick the left/right column of the exercise's primary angle."""
    expr_l, expr_r = F.col(f"knee_{prefix_l}"), F.col(f"knee_{prefix_r}")
    for name, exercises in PRIMARY_ANGLE.items():
        hit = F.col("exercise_id").isin(exercises)
        expr_l = F.when(hit, F.col(f"{name}_{prefix_l}")).otherwise(expr_l)
        expr_r = F.when(hit, F.col(f"{name}_{prefix_r}")).otherwise(expr_r)
    return expr_l, expr_r


def latest(df, keys):
    """Keep the newest upload per key, so retries and re-exports don't duplicate."""
    w = Window.partitionBy(*keys).orderBy(F.col("ingested_at").desc())
    return df.withColumn("_rn", F.row_number().over(w)).filter("_rn = 1").drop("_rn")


@dp.temporary_view(comment="Rep boundaries and phone aggregates, one row per rep")
def rep_bounds():
    sessions = latest(spark.read.table("bronze_sessions"), ["session_id"])
    sets = sessions.select(
        "session_id", "user_id", "experience_level", "injury_groups", "device", "inference_mode",
        F.to_date("finished_at").alias("session_date"), "finished_at",
        F.explode("sets").alias("s"),
    )
    return sets.select(
        "*", F.explode("s.reps").alias("r"),
    ).select(
        F.concat_ws("-", "session_id", "s.set_index", "r.rep_index").alias("rep_id"),
        "session_id", "user_id", "experience_level",
        F.coalesce("injury_groups", F.array().cast("array<string>")).alias("injury_groups"),
        "device", "inference_mode", "session_date", "finished_at",
        F.col("s.set_index").alias("set_index"),
        F.col("s.exercise_id").alias("exercise_id"),
        F.col("s.weight_kg").alias("weight_kg"),
        F.col("r.rep_index").alias("rep_index"),
        F.col("r.start_ms").alias("start_ms"),
        F.col("r.end_ms").alias("end_ms"),
        F.col("r.tempo_ms").alias("tempo_ms"),
        F.col("r.range_deg").alias("range_deg"),
        F.col("r.quality").alias("quality"),
        F.transform(F.coalesce("r.flags", F.array()), lambda f: f["rule_id"]).alias("flags"),
    )


@dp.temporary_view(comment="Raw frames inside a rep, with a full set of joints")
@dp.expect_or_drop("seventeen_joints", "size(kp) = 51")
def rep_frames():
    joints = latest(spark.read.table("bronze_set_joints"), ["session_id", "set_index"])
    frames = joints.select(
        "session_id", "set_index", F.explode("frames").alias("f"),
    ).select("session_id", "set_index", F.col("f.t_ms").alias("t_ms"), F.col("f.kp").alias("kp"))

    reps = spark.read.table("rep_bounds").select(
        "rep_id", "session_id", "set_index", "exercise_id", "start_ms", "end_ms",
    )
    return frames.join(reps, ["session_id", "set_index"]).filter(
        F.col("t_ms").between(F.col("start_ms"), F.col("end_ms"))
    )


@dp.materialized_view(comment="Joint angles per frame, only frames inside a rep")
@dp.expect_or_drop("torso_visible", "torso_len > 0.01")
@dp.expect_or_drop("lower_body_confident", "lower_conf >= 0.3")
def silver_frames():
    in_rep = spark.read.table("rep_frames")

    hip_x, hip_y = (x(L_HIP) + x(R_HIP)) / 2, (y(L_HIP) + y(R_HIP)) / 2
    sh_x, sh_y = (x(L_SHOULDER) + x(R_SHOULDER)) / 2, (y(L_SHOULDER) + y(R_SHOULDER)) / 2

    df = in_rep.select(
        "rep_id", "exercise_id", "kp",
        (F.col("t_ms") - F.col("start_ms")).alias("t_ms"),
        angle(L_HIP, L_KNEE, L_ANKLE).alias("knee_left"),
        angle(R_HIP, R_KNEE, R_ANKLE).alias("knee_right"),
        angle(L_SHOULDER, L_HIP, L_KNEE).alias("hip_left"),
        angle(R_SHOULDER, R_HIP, R_KNEE).alias("hip_right"),
        angle(L_SHOULDER, L_ELBOW, L_WRIST).alias("elbow_left"),
        angle(R_SHOULDER, R_ELBOW, R_WRIST).alias("elbow_right"),
        # Lean from vertical: 0 = upright. Image y points down.
        F.degrees(F.atan2(F.abs(sh_x - hip_x), hip_y - sh_y)).alias("trunk_angle"),
        F.try_divide(F.abs(x(L_KNEE) - x(R_KNEE)), F.abs(x(L_ANKLE) - x(R_ANKLE))).alias("knee_ankle_ratio"),
        hip_x.alias("hip_x"), hip_y.alias("hip_y"),
        F.sqrt((sh_x - hip_x) ** 2 + (sh_y - hip_y) ** 2).alias("torso_len"),
        ((c(L_HIP) + c(R_HIP) + c(L_KNEE) + c(R_KNEE) + c(L_ANKLE) + c(R_ANKLE)) / 6).alias("lower_conf"),
    )

    left, right = primary("left", "right")
    return df.select(
        "*",
        left.alias("primary_left"),
        right.alias("primary_right"),
        ((left + right) / 2).alias("primary_angle"),
        # Hip-centred, torso-scaled joints (17 x 2) for the form model's training windows.
        F.expr(
            "flatten(transform(sequence(0, 16), j -> array("
            "try_divide(kp[3 * j] - hip_x, torso_len), try_divide(kp[3 * j + 1] - hip_y, torso_len))))"
        ).alias("kp_norm"),
    ).drop("kp", "hip_x", "hip_y")


@dp.materialized_view(comment="One row per rep: range, tempo split, left/right symmetry, flags, quality")
@dp.expect_or_drop("valid_bounds", "end_ms > start_ms")
@dp.expect_or_drop("range_in_degrees", "range_deg BETWEEN 0 AND 180")
@dp.expect_or_drop("quality_0_to_1", "quality IS NULL OR quality BETWEEN 0 AND 1")
@dp.expect("has_frames", "frame_count >= 4")
def silver_reps():
    per_rep = spark.read.table("silver_frames").groupBy("rep_id").agg(
        F.count("*").alias("frame_count"),
        F.min_by("t_ms", "primary_angle").alias("bottom_ms"),
        (F.max("primary_angle") - F.min("primary_angle")).alias("measured_range_deg"),
        (F.max("primary_left") - F.min("primary_left")).alias("left_range_deg"),
        (F.max("primary_right") - F.min("primary_right")).alias("right_range_deg"),
        F.max("trunk_angle").alias("max_trunk_angle"),
        F.min("knee_ankle_ratio").alias("min_knee_ankle_ratio"),
    )
    reps = spark.read.table("rep_bounds").join(per_rep, "rep_id", "left")
    duration = F.col("end_ms") - F.col("start_ms")
    return reps.select(
        "*",
        F.coalesce("frame_count", F.lit(0)).alias("_fc"),
        F.col("bottom_ms").alias("lowering_ms"),
        (duration - F.col("bottom_ms")).alias("rising_ms"),
        # 0 = perfectly even, 0.15+ is flagged by the risk score
        F.try_divide(F.abs(F.col("left_range_deg") - F.col("right_range_deg")),
                     F.greatest("left_range_deg", "right_range_deg")).alias("asymmetry"),
        (F.size("flags") == 0).alias("is_clean"),
    ).drop("frame_count", "bottom_ms").withColumnRenamed("_fc", "frame_count")
