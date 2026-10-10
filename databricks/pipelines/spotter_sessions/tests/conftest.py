"""Runs the real pipeline files (bronze.py, silver.py, gold.py) on local Spark.

Databricks provides `pyspark.pipelines` and Auto Loader; locally a small stand-in registers each
@dp.table / @dp.materialized_view / @dp.temporary_view function, runs them in file order, applies
expect_or_drop, and reads bronze from JSON files instead of Auto Loader. Needs Java 17+.

    cd databricks/pipelines && uv run pytest
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

PIPELINE_DIR = Path(__file__).resolve().parents[1]


def _fake_pipelines_module(registry: list):
    def table_like(kind):
        def deco(fn=None, *, name=None, comment=None, **_):
            def wrap(f):
                registry.append((name or f.__name__, f, list(getattr(f, "_exps", [])), kind))
                return f
            return wrap(fn) if fn else wrap
        return deco

    def expect(action):
        def deco(name, condition):
            def wrap(f):
                f._exps = getattr(f, "_exps", []) + [(name, condition, action)]
                return f
            return wrap
        return deco

    dp = types.ModuleType("pyspark.pipelines")
    dp.table = table_like("table")
    dp.materialized_view = table_like("mv")
    dp.temporary_view = table_like("view")
    dp.expect = expect("warn")
    dp.expect_or_drop = expect("drop")
    return dp


@pytest.fixture(scope="session")
def spark():
    from pyspark.sql import SparkSession

    session = (
        SparkSession.builder.master("local[2]")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "2")
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


@pytest.fixture
def run_pipeline(spark):
    """run_pipeline(volume_dir) -> {table name: DataFrame}, running bronze, silver and gold."""
    from pyspark.sql import functions as F

    def run(volume: Path) -> dict:
        import pyspark

        registry: list = []
        dp = _fake_pipelines_module(registry)
        sys.modules["pyspark.pipelines"] = dp
        pyspark.pipelines = dp

        def batch_load(subdir, schema):
            path = volume / subdir
            if not path.exists():
                return spark.createDataFrame([], schema).withColumn("source_file", F.lit(None).cast("string")) \
                    .withColumn("ingested_at", F.current_timestamp())
            return (spark.read.schema(schema).json(str(path / "*" / "*"))
                    .withColumn("source_file", F.col("_metadata.file_path"))
                    .withColumn("ingested_at", F.current_timestamp()))

        tables = {}
        for layer in ("bronze", "silver", "gold"):
            start = len(registry)
            ns = {"spark": spark, "__name__": layer}
            exec(compile((PIPELINE_DIR / f"{layer}.py").read_text(), f"{layer}.py", "exec"), ns)
            if layer == "bronze":
                ns["auto_load"] = batch_load
            for name, fn, exps, _kind in registry[start:]:
                df = fn().localCheckpoint()  # expectations see only the output columns, as on Databricks
                for _exp, condition, action in reversed(exps):
                    if action == "drop":
                        df = df.filter(f"coalesce(({condition}), false)")
                short = name.split(".")[-1]
                df.createOrReplaceTempView(short)
                tables[short] = df
        return tables

    return run
