# Databricks notebook source
# MAGIC %md
# MAGIC # CONN-05: Model Serving endpoint for set scoring
# MAGIC
# MAGIC Creates or updates the CPU endpoint the API calls during the rest timer
# MAGIC (`apps/api/src/integrations/databricks/score.ts`), serving the version of
# MAGIC **`spotter.ml.form_quality`** that holds the `champion` alias (CONN-04). Model Serving takes a
# MAGIC version number, not an alias, so re-run this after the form-model notebook moves `champion`.
# MAGIC
# MAGIC It also gives the API's service principal `CAN_QUERY`, then sends one cold and a few warm
# MAGIC requests and prints their latency against the API's 1.2 s budget.
# MAGIC
# MAGIC Re-running is harmless: an endpoint already on the right version is left alone.
# MAGIC Runbook: `docs/runbooks/set-scoring.md`.

# COMMAND ----------

dbutils.widgets.text("endpoint", "form-quality")
dbutils.widgets.text("model", "spotter.ml.form_quality")
dbutils.widgets.text("alias", "champion")
# The API's DATABRICKS_CLIENT_ID (the service principal's application id). Empty skips the grant.
dbutils.widgets.text("api_client_id", "")
# Scale to zero keeps Free Edition within quota, but the first request after idle times out in
# the API (it falls back to the phone's score). Set to false before a demo if the workspace allows it.
dbutils.widgets.dropdown("scale_to_zero", "true", ["true", "false"])

ENDPOINT = dbutils.widgets.get("endpoint")
MODEL = dbutils.widgets.get("model")
ALIAS = dbutils.widgets.get("alias")
API_CLIENT_ID = dbutils.widgets.get("api_client_id").strip()
SCALE_TO_ZERO = dbutils.widgets.get("scale_to_zero") == "true"

# COMMAND ----------

import time
from datetime import timedelta

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from databricks.sdk.service.serving import (
    EndpointCoreConfigInput,
    ServedEntityInput,
    ServingEndpointAccessControlRequest,
    ServingEndpointPermissionLevel,
)
from mlflow.tracking import MlflowClient

w = WorkspaceClient()
version = MlflowClient(registry_uri="databricks-uc").get_model_version_by_alias(MODEL, ALIAS).version
print(f"{MODEL}@{ALIAS} is version {version}")

served = ServedEntityInput(
    name="form_quality",
    entity_name=MODEL,
    entity_version=str(version),
    workload_size="Small",  # CPU; the model is a small scikit-learn pipeline
    scale_to_zero_enabled=SCALE_TO_ZERO,
)

# COMMAND ----------

# MAGIC %md ## Create or update

# COMMAND ----------

try:
    current = w.serving_endpoints.get(ENDPOINT)
except NotFound:
    current = None

if current is None:
    print(f"Creating {ENDPOINT} (this takes several minutes)")
    endpoint = w.serving_endpoints.create_and_wait(
        name=ENDPOINT,
        config=EndpointCoreConfigInput(name=ENDPOINT, served_entities=[served]),
        timeout=timedelta(minutes=40),
    )
else:
    entities = (current.config.served_entities if current.config else None) or []
    same = [
        e for e in entities
        if e.entity_name == MODEL and e.entity_version == str(version)
        and bool(e.scale_to_zero_enabled) == SCALE_TO_ZERO
    ]
    if same and len(entities) == 1:
        print(f"{ENDPOINT} already serves version {version}")
        endpoint = current
    else:
        print(f"Updating {ENDPOINT} to version {version}")
        endpoint = w.serving_endpoints.update_config_and_wait(
            name=ENDPOINT, served_entities=[served], timeout=timedelta(minutes=40),
        )

print(f"State: {endpoint.state.ready if endpoint.state else 'unknown'}")

# COMMAND ----------

# MAGIC %md ## Let the API query it

# COMMAND ----------

if API_CLIENT_ID:
    w.serving_endpoints.update_permissions(
        serving_endpoint_id=endpoint.id,
        access_control_list=[
            ServingEndpointAccessControlRequest(
                service_principal_name=API_CLIENT_ID,
                permission_level=ServingEndpointPermissionLevel.CAN_QUERY,
            )
        ],
    )
    print(f"Granted CAN_QUERY to {API_CLIENT_ID}")
else:
    print("api_client_id is empty: grant CAN_QUERY on the endpoint to the API's service principal by hand")

# COMMAND ----------

# MAGIC %md ## Smoke test
# MAGIC
# MAGIC Two reps shaped like the API's request: one with frame-derived features, one without (the
# MAGIC phone sent no rep boundaries), as plain JSON numbers.

# COMMAND ----------

records = [
    {"exercise_id": "squat", "weight_kg": 60, "range_deg": 92, "tempo_ms": 2000, "lowering_ms": 1200,
     "rising_ms": 800, "asymmetry": 0.08, "max_trunk_angle": 38.5, "min_knee_ankle_ratio": 0.84},
    {"exercise_id": "squat", "weight_kg": 60, "range_deg": 85, "tempo_ms": 1800, "lowering_ms": None,
     "rising_ms": None, "asymmetry": None, "max_trunk_angle": None, "min_knee_ankle_ratio": None},
]

BUDGET_MS = 1200  # DATABRICKS_SCORE_TIMEOUT_MS in the API
for attempt in range(4):
    started = time.perf_counter()
    response = w.serving_endpoints.query(name=ENDPOINT, dataframe_records=records)
    ms = (time.perf_counter() - started) * 1000
    label = "cold" if attempt == 0 else "warm"
    print(f"{label}: {ms:.0f} ms {'OK' if ms <= BUDGET_MS else 'over budget'} -> {response.predictions}")

assert len(response.predictions) == len(records), "expected one prediction per rep"
