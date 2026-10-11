# Demo checklist: Databricks and Hugging Face

For whoever deploys the API (BE-14) and whoever runs the demo. Everything below is optional for the API to boot, so a missing variable doesn't crash anything: the feature quietly switches off. This list is how to make sure none of them did.

## 1. Deployed API environment

Set these on the deployed API, in addition to `DATABASE_URL` and `NEON_AUTH_JWKS_URL`. Secrets come from the team password manager, never from chat or the repo.

| Variable | Value | Without it |
|---|---|---|
| `DATABRICKS_HOST` | `https://dbc-46bf511e-89fe.cloud.databricks.com` | No uploads, scoring or sync |
| `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` | The `spotter-api` service principal (password manager) | Same |
| `DATABRICKS_OAUTH_SCOPES` | `files model-serving sql` | The default asks for `all-apis`, which `spotter-api` doesn't have: every call fails |
| `DATABRICKS_WAREHOUSE_ID` | `3b559165498b286d` (from the warehouse URL `/sql/warehouses/<id>`, **not** the `?o=` workspace id) | Sync gets HTTP 403 |
| `DATABRICKS_SERVING_ENDPOINT` | `form-quality` | Sets are scored by the phone's rules only |
| `SPOTTER_PSEUDONYM_SECRET` | Password manager. **Must equal** the Databricks secret `spotter/pseudonym_secret` | No uploads; with a different value the sync matches nobody |
| `INSIGHT_SYNC_ENABLED` | `true` on **exactly one** instance | Progress, risk and range-of-motion charts stop updating |
| `HF_TOKEN` | `bubblesmal` fine-grained token (password manager) | No moderation, gpt-oss rest notes or plans, embeddings or cloud pose |
| `POSE_ENDPOINT_URL` | `https://6acafaa0e4d5812f4c1aaace.endpoints.huggingface.cloud` | Cloud pose mode is off; phones that can't run YOLOv8 can't track |

Full list with fallbacks: `apps/api/README.md` → Environment.

## 2. Check it after deploying

`GET /health` lists every integration. Each should be `live`; `cloud_pose` and `set_scoring` read `live` until their first call, so check them again after step 3.

```bash
curl -s https://<api>/health | jq .integrations
```

| `/health` says | Cause | Fix |
|---|---|---|
| `insight_sync: error, http_403` | Wrong warehouse id, or `spotter-api` lacks Can use | Use `3b559165498b286d`; check the warehouse's Permissions |
| `insight_sync: error, partial` | A gold table is missing | Update the pipeline files in Databricks and Full refresh |
| `set_scoring: error, timeout` | The serving endpoint is asleep | Run step 3 |
| `cloud_pose: error` | The HF endpoint is paused or failing | Resume it at endpoints.huggingface.co |
| `insight_sync: disabled` | `INSIGHT_SYNC_ENABLED` isn't `true` here | Set it on one instance |

## 3. Ten minutes before judging

```bash
cd apps/api
npm run demo:prep -- --demo
```

It wakes the SQL warehouse, the scoring endpoint (~20 s cold) and the pose endpoint (minutes cold), runs the insight sync into the demo branch and embeds any profiles without an embedding, then prints a checklist. Everything should be ✓. Endpoints sleep again after 15 minutes idle, so run it close to the start.

Also before judging:

- Open the Databricks dashboard ("Spotter") and the Genie space once, so the warehouse is warm for them too.
- Recovery story: lifter `189bca` (demo-user-01), left knee, +18° over three weeks.

## 4. After reseeding the demo branch

`npm run db:seed:demo` wipes the users and everything synced with them (not the RAG library). Run `npm run demo:prep -- --demo` again afterwards to re-sync and re-embed. If the sync step says it matched no users, the API's `SPOTTER_PSEUDONYM_SECRET` and Databricks' `spotter/pseudonym_secret` differ.

## Costs

The scoring endpoint (Databricks Free Edition quota) and the pose endpoint (HF, ~$0.07/h on 2 vCPU) only cost while awake. Pause the HF endpoint after the demo if it won't be used again.
