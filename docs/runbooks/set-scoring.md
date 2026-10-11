# Set scoring on Model Serving (CONN-05)

While the lifter rests, the API scores the set they just finished on a Databricks Model Serving endpoint and returns the medal with the rest note (INT-05). This is how the endpoint is set up, what the API sends it, and what happens when it isn't there.

## The flow

```
POST /sessions/:id/sets (apps/api/src/routes/sessions.ts)
  └─ restTimeResult (services/restTime.ts), budget about 1.5 s
       └─ DatabricksScorer.scoreSet (integrations/databricks/score.ts), 1.2 s timeout
            1. OAuth token for the service principal (cached about an hour)
            2. per rep: the phone's aggregates + frame-derived features (features.ts, from the set's joints)
            3. POST /serving-endpoints/form-quality/invocations  { dataframe_records: [...] }
            4. per rep { quality, label } back; rule flags still decide clean and the medal (INT-06)
       └─ any failure or timeout → the phone's rule score (score.source = "phone")
```

The model's quality and label are advice: the medal comes from the rule flags either way, so a fallback never changes a medal. It changes only `score.source` and the per-rep `quality` and `label`.

## Model inputs

One record per rep, with the columns of the model signature in `databricks/notebooks/form_model.py`:

| Column | From |
|---|---|
| `exercise_id`, `weight_kg` | The set |
| `range_deg`, `tempo_ms` | The phone's rep aggregates |
| `lowering_ms`, `rising_ms`, `asymmetry`, `max_trunk_angle`, `min_knee_ankle_ratio` | Computed by the API from the set's `frames` and the rep's `start_ms`/`end_ms` |

The frame-derived features are a port of `silver_frames` and `silver_reps` (CONN-03), so serving sees what training saw. `specs/set-record/fixtures/features/` holds frames with the features the pipeline computes from them, and both sides check against those fixtures:

- `apps/api/test/score-features.test.ts` (`npm test` in `apps/api`)
- `databricks/pipelines/steadyforum_sessions/tests/test_feature_parity.py` (`uv run pytest` in `databricks/pipelines`)

If you change a feature in `silver.py`, change `features.ts` too, and regenerate the fixture's `expected` values from the pipeline. A rep with no boundaries, or no usable frames, gets nulls, which the model handles.

## Setting up the endpoint

1. Train and register the model: run `databricks/notebooks/form_model.py` (CONN-04). It moves `champion` to the new version if it's at least as good.
2. Import `databricks/notebooks/serving_endpoint.py` into the workspace and run it on serverless compute with:
   - `api_client_id`: the API's `DATABRICKS_CLIENT_ID`, so it gets `CAN_QUERY` on the endpoint
   - `scale_to_zero`: `true` normally; `false` before a demo, if the workspace allows it
3. Check the smoke test output: the warm requests should come in under 1200 ms.
4. In `apps/api/.env`: `DATABRICKS_SERVING_ENDPOINT=form-quality`, and `DATABRICKS_OAUTH_SCOPES` must include `model-serving`.

Re-run step 2 whenever `champion` moves. Serving takes a version number, not an alias, so the endpoint stays on the old version until you do.

## Free Edition limits and the fallback

- **Scale to zero.** An idle endpoint takes minutes to wake. The first set after idle times out at 1.2 s and gets the phone's score; the request still wakes the endpoint, so later sets are scored. Before a demo, run the smoke test cell (or one set) a few minutes ahead.
- **No serving at all.** If the workspace can't create the endpoint, nothing in the API needs to change: the call fails fast (`HTTP 404`) and falls back. The API shows the phone's rule score live, and the pipeline's `gold_workout_medals` recomputes medals in batch after upload (CONN-03).

## Checking it

- API logs: each set logs `rest-time result` with `scoreSource` (`databricks` or `phone`) and the timings. A fallback also logs `[databricks] scoring fell back to phone score: <reason>`.
- Common reasons: `timed out after 1200 ms` (cold endpoint), `HTTP 403` (missing `CAN_QUERY` or the `model-serving` scope), `HTTP 404` (wrong endpoint name), `token HTTP 401` (bad client credentials).
- Databricks: Serving → `form-quality` shows the served version, its state, and request metrics.
