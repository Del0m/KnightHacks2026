# CONN-03 bronze: Auto Loader over the files the API uploads (CONN-02).
#   meta/<date>/<session_id>.json           -> bronze_sessions   (one row per session)
#   joints/<date>/<session_id>.ndjson.gz    -> bronze_set_joints (one row per set)
# Schemas are explicit so a malformed upload lands in _rescued_data instead of
# changing the table. They mirror specs/set-record/schema.json (ExportMeta, MetaSet, Rep, Flag,
# ExportJointsLine); specs/set-record.test.mjs fails when they drift.

from pyspark import pipelines as dp
from pyspark.sql import functions as F
from pyspark.sql.types import (
    ArrayType, DoubleType, IntegerType, LongType, StringType, StructField, StructType,
)

VOLUME = spark.conf.get("steadyforum.volume_path", "/Volumes/steadyforum/raw/sessions")

FLAG = StructType([
    StructField("rule_id", StringType()),
    StructField("severity", StringType()),  # form | safety
    StructField("rep_index", IntegerType()),  # 0-based, same as the rep's
])

REP = StructType([
    StructField("rep_index", IntegerType()),
    StructField("start_ms", LongType()),
    StructField("end_ms", LongType()),
    StructField("tempo_ms", LongType()),
    StructField("range_deg", DoubleType()),
    StructField("quality", DoubleType()),  # advisory model score; null from the phone (INT-06)
    # Start to the smallest primary angle, and the rest of the rep, measured on the phone.
    StructField("lowering_ms", LongType()),
    StructField("rising_ms", LongType()),
    StructField("flags", ArrayType(FLAG)),
])

SET = StructType([
    StructField("set_index", IntegerType()),
    StructField("exercise_id", StringType()),
    StructField("weight_kg", DoubleType()),
    StructField("medal", StringType()),
    StructField("end_reason", StringType()),  # still | absent | lost | manual
    StructField("partial_reps", IntegerType()),
    StructField("frame_count", IntegerType()),
    StructField("reps", ArrayType(REP)),
])

META_SCHEMA = StructType([
    StructField("schema_version", IntegerType()),
    StructField("session_id", StringType()),
    StructField("user_id", StringType()),  # HMAC pseudonym, never the Neon id
    StructField("started_at", StringType()),
    StructField("finished_at", StringType()),
    StructField("device", StringType()),
    StructField("inference_mode", StringType()),  # coreml | vision | cloud
    StructField("medal", StringType()),
    StructField("form_score", DoubleType()),
    StructField("experience_level", StringType()),
    # "knee" or "knee:left": body part and a coarse side, no dates or notes (§13, CONN-14).
    StructField("injury_groups", ArrayType(StringType())),
    # Start of the user's rehab plan (DB-12), for the range-of-motion baseline (CONN-14).
    StructField("rehab_start_on", StringType()),
    StructField("joints_path", StringType()),
    StructField("exported_at", StringType()),
    StructField("sets", ArrayType(SET)),
])

JOINTS_SCHEMA = StructType([
    StructField("session_id", StringType()),
    StructField("set_index", IntegerType()),
    StructField("exercise_id", StringType()),
    StructField("fps", DoubleType()),
    StructField("frames", ArrayType(StructType([
        StructField("t_ms", LongType()),
        StructField("kp", ArrayType(DoubleType())),  # 17 COCO joints x (x, y, c)
    ]))),
])


def auto_load(subdir: str, schema: StructType):
    return (
        spark.readStream.format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaEvolutionMode", "rescue")
        .schema(schema)
        .load(f"{VOLUME}/{subdir}/")
        .withColumn("source_file", F.col("_metadata.file_path"))
        .withColumn("ingested_at", F.current_timestamp())
    )


@dp.table(comment="Session metadata, sets, per-rep aggregates and flags, as uploaded")
@dp.expect_or_drop("has_session_id", "session_id IS NOT NULL")
@dp.expect_or_drop("has_user_id", "user_id IS NOT NULL")
@dp.expect("known_schema_version", "schema_version = 1")
def bronze_sessions():
    return (
        auto_load("meta", META_SCHEMA)
        .withColumn("started_at", F.to_timestamp("started_at"))
        .withColumn("finished_at", F.to_timestamp("finished_at"))
        .withColumn("exported_at", F.to_timestamp("exported_at"))
    )


@dp.table(comment="Raw per-frame joints, one row per set")
@dp.expect_or_drop("has_keys", "session_id IS NOT NULL AND set_index IS NOT NULL")
def bronze_set_joints():
    return auto_load("joints", JOINTS_SCHEMA)
