Closes #48.

A finished engine set now becomes a versioned payload shared by the phone, the API and Databricks. The phone packages AI-07's flags and per-rep measurements; the API stores aggregates in Neon and exports rounded joint arrays as gzip. Rules are not evaluated again during packaging, and the model's quality remains advisory.

This includes the contract portion of INT-01 (#85). The UI catalogue's `curl` / `press` rename remains with INT-12 (#110), so this PR does not close #85. The branch includes main through `0bdefe1`, including AI-07 (#112) and DB-12 / BE-03 (#113).

## What gets produced

| Field | Source | Consumer |
|---|---|---|
| `schema_version` | Shared schema, version 1 | API request validation and bronze metadata |
| `set_index`, `exercise_id`, `weight_kg` | Caller and active exercise spec | Neon set position/load and export identifiers |
| `rep_index` | Engine's 1-based `index` minus one | Neon rep position, flags, bronze and replay snapshots |
| `start_ms`, `end_ms` | `startedAt` and `countedAt`, relative to the first kept pose | Neon rep boundaries and silver's frame joins |
| `tempo_ms` | Start-to-count duration on the rounded set clock | Neon, rest-time scorer and Databricks |
| `range_deg` | Primary angle maximum minus minimum across the closed rep's windows, to 0.1° | Neon and scorer |
| `lowering_ms`, `rising_ms` | Start to the minimum primary angle before count, then the remaining duration | Neon, scorer and bronze |
| `quality` | Null from the phone; stored model values remain advisory | Neon and Databricks |
| `flags` | AI-07's per-rep `{ rule_id, severity, rep_index }` results | Neon form flags, clean/medal scoring and bronze |
| `end_reason`, `partial_reps` | Engine set-end and partial events | Neon and bronze |
| `frames[].t_ms`, `frames[].kp` | Raw capture poses, flattened in COCO order; x/y rounded to four decimals, confidence to two | API joints buffer and Databricks gzip file |
| `fps` | Kept frame count divided by elapsed capture time | Databricks joints file |
| `inference_mode` | Explicit session creator input: `coreml`, `vision` or `cloud` | Neon and Databricks |
| Export `user_id` | Server-side HMAC of the authenticated user's id | Pseudonymous Databricks metadata |

## Changes

- `specs/set-record/schema.json` defines request, aggregate, session and export shapes. Generated TypeScript types are shared by both apps. The schema root validates a `SetRecord`.
- Node tests validate fixtures, remove required fields recursively, reject malformed values, check generated types and detect bronze field/type drift. Existing medal fixtures retain their independent format.
- `setRecord.ts` provides a pure builder and an event-driven collector. It keeps a one-second pose lead-in, then captures until set end with a 5,400-frame limit. Frames after that limit are dropped while aggregate collection continues.
- Replay fixtures connect the real engine and AI-07 rules to the payload builder. The same payloads are consumed by schema and API contract tests.
- The API adopts the shared shapes, persists the new aggregate fields, preserves sparse set indices and null quality, and forwards phone timing features to rest-time scoring. Client-supplied clean/medal fields are stripped; flags determine clean.
- Migration `0008_set_record` follows main's `0007_db12_rehab`. It preserves existing `on_device` rows as `coreml`, adds `vision`, removes the session mode default and adds nullable aggregate columns. Its snapshot includes the merged rehab schema.
- The uploader keeps explicit field allowlists, server-side pseudonymisation and gzip. The synthetic Databricks exporter also validates against the shared contract.
- `uploadWorkout` accepts shared session/set types and preserves caller-supplied indices. Manual workouts remain local, pending a separate manual-upload contract, rather than submitting unmeasured reps as pose records.
- Root `Architecture.md`, the design contract and `docs/specs/set-record-format.md` describe the handoff and field meanings.

## Validation

From `apps/mobile`, `npx jest --runInBand --watchman=false`:

```text
Test Suites: 45 passed, 45 total
Tests:       636 passed, 636 total
Snapshots:   0 total
```

The replay payload snapshots are ordinary committed JSON fixtures, so Jest reports zero built-in snapshots. All 16 clips run through engine → rules → recorder. Tests also cover rounding, both movement directions, limits, malformed input, reset, repeated finish, index/flag mismatches, and a full manual workout saved locally and undone.

`npm run typecheck` passes. `npm run lint` reports 0 errors and 8 existing warnings.

From the root, `node --test specs/*.test.mjs`:

```text
ℹ tests 147
ℹ suites 12
ℹ pass 147
ℹ fail 0
```

`node specs/validate.mjs` passes all five exercise specs.

From the root, `python3 -m unittest discover -s databricks/notebooks/tests -v`:

```text
Ran 3 tests in 0.559s
OK
```

From `databricks/pipelines`, with a temporary Java 21 runtime and the same `.venv/bin/python` for the driver and workers:

```sh
JAVA_HOME=/tmp/ai08-jdk21/Contents/Home \
SPARK_LOCAL_IP=127.0.0.1 \
PYSPARK_PYTHON="$PWD/.venv/bin/python" \
.venv/bin/python -m pytest -q
```

```text
5 passed in 21.95s
```

This executes the real bronze/silver/gold definitions with the repository's local Spark harness. The new test loads every replay fixture as metadata and gzip joints, verifies that all nested bronze fields survive unchanged, checks sparse set indices, and checks silver rep counts, null quality and flag-based clean status. Production Auto Loader and `_rescued_data` behavior are not exercised by the local batch-loading substitute.

Initial Spark runs failed because Java 25 cannot run this Hadoop code and then because workers used Python 3.9 while the driver used 3.11. Both environment problems were resolved for the passing run; no system runtime configuration was changed.

From `apps/api`, `npm test`:

```text
Test Files  20 passed (20)
     Tests  285 passed (285)
```

`npm run typecheck`, `npm run lint`, Prettier checks on touched API files, and `git diff --check` pass. The API tests cover schema parity for all 17 set fixtures, required fields and bounds, stored aggregates and flags, sparse indices, null quality, server-only clean scoring, gzip/pseudonymisation and retry rebuilding without frames. Migration tests apply all migrations on a fresh PGlite database and upgrade populated `0006` and `0007` data, checking that existing mode values and aggregates survive and that mode becomes required.

No live API request, cloud model invocation, Neon migration or Databricks deployment was performed. Device recording, Hermes performance and production Auto Loader remain unverified.

## Known limits

- Raw joints lack image aspect, smoothing configuration and explicit no-person markers. Databricks cannot reconstruct the original engine run exactly. Gaps may represent absent detections, dropped frames or irregular inference.
- The engine measures smoothed, aspect-corrected angles; silver uses raw, unscaled coordinates and start-to-count windows. Their measured ranges and timing features need not match numerically.
- Frames stop accumulating at the cap; later rep aggregates can have no matching exported frames. There is no truncation field in version 1.
- The API's joint storage is in memory. A restart or retention expiry can leave an aggregate-only retry; Neon still contains no per-frame joints.
- Session inference mode cannot represent a source change mid-session. Existing `on_device` history is migrated to `coreml` without recovering whether Apple Vision was originally used.
- #113 is integrated: its `0007_db12_rehab` migration and snapshot are preserved, and AI-08's migration/snapshot are regenerated as `0008`. Upgrade coverage includes populated databases through both `0006` and `0007`.
- Canonical JSON rejects extra properties; the API strips them for compatibility. The API also checks timestamp syntax and cross-field relationships beyond the JSON Schema's structural constraints.
- On native platforms the existing local workout history is in memory; this change does not add persistent manual-workout storage.

## Not included

- Live workout wiring and immediate rest-timer handoff (INT-02), durable offline queue and phone-generated set ids (INT-03).
- UI exercise-id migration (INT-12), model/rule changes, new scoring policy, per-side peak fields, asymmetry or trunk/knee features on the phone.
- Phone gzip, video uploads, live Neon/Databricks deployment, device capture testing or a production Auto Loader run.
