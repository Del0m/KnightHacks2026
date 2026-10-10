# Set record and shared contract (AI-08 + INT-01)

AI-08 (#48) packages a finished set on the phone. INT-01 (#85) makes that payload, and everything the API and Databricks derive from it, one shape defined once. Both land together on `ai-08-set-record`.

## 1. Single source

`specs/set-record/schema.json` (JSON Schema, the subset `specs/validate.mjs` understands, plus `type` arrays for nullable fields). Its `$defs`:

| Def | What it is | Written by | Read by |
|---|---|---|---|
| `Flag` | One failed rule on one rep | AI-07 via AI-08 | API, Neon `form_flags`, bronze `FLAG` |
| `Rep` | Per-rep aggregates and flags | AI-08 | API, Neon `reps`, bronze `REP` |
| `JointFrame` | One pose frame, `{ t_ms, kp[51] }` | AI-08 | API (memory only), joints file |
| `SetRecord` | Body of `POST /sessions/:id/sets` | AI-08 | BE-04 |
| `SessionStart` | Body of `POST /sessions` | INT-03 | BE-04 |
| `ExportSet`, `ExportSession` | What BE-04 hands the uploader (was `FinishedSet` / `FinishedSession`) | BE-04 | CONN-02 |
| `MetaSet`, `ExportMeta` | The `meta/<date>/<session>.json` file | CONN-02 `buildMetadata` | bronze `SET` / `META_SCHEMA` |
| `ExportJointsLine` | One line of `joints/<date>/<session>.ndjson.gz` | CONN-02 `buildJointsFile` | bronze `JOINTS_SCHEMA` |

`specs/set-record/types.ts` is generated from the schema by `node specs/set-record/generate-types.mjs`. Never edit it by hand; `node --test specs/*.test.mjs` fails when it is stale. Both apps import it type-only:

- mobile: `import type { SetRecord } from '../../../../specs/set-record/types';`
- api: `import type { ExportSession } from "../../../../../specs/set-record/types";` (adjust depth)

## 2. Field rules

- **`schema_version`** is `1` (const) on `SetRecord` and `ExportMeta`. Nothing has been exported for real, so the field additions don't bump it.
- **`set_index`**: 0-based position of the set in its session, chosen by the phone. Required. Neon `sets.position`.
- **`rep_index`**: 0-based within the set, `RepRecord.index - 1`. Equals the rep's array position. Every `Flag.rep_index` equals its rep's `rep_index`.
- **Clock**: every `*_ms` time is integer ms on the set clock: `t_ms = 0` is the first kept frame (§3). `start_ms` / `end_ms` are on that clock; `tempo_ms`, `lowering_ms`, `rising_ms` are durations.
- **`exercise_id`**: spec id, `^[a-z0-9_]{2,60}$` (the five MVP ids are `squat`, `push_up`, `bicep_curl`, `shoulder_press`, `lunge`; more specs may follow).
- **`inference_mode`**: `coreml | vision | cloud` (the `PoseSource` values). Required on `SessionStart`, no default.
- **`severity`**: `form | safety`.
- **Clean, medal, clean share, score source** are not phone fields. INT-06: the server derives clean (no flags) and everything from it. `quality` is the model's advisory score: always `null` from the phone, never faked from clean.

### Rep

| Field | Type | Phone source |
|---|---|---|
| `rep_index` | int ≥ 0 | `index - 1` |
| `start_ms` | int ≥ 0 \| null | `startedAt - origin` |
| `end_ms` | int ≥ 0 \| null | `countedAt - origin` (so `end_ms - start_ms == tempo_ms`) |
| `tempo_ms` | int 0–120000 | `durations.rep` |
| `range_deg` | number 0–180 | max − min of the primary angle over `windows.rep`, 0.1° |
| `quality` | number 0–1 \| null | `null` |
| `lowering_ms` | int ≥ 0 \| null | time from `startedAt` to the frame with the **minimum** primary angle in `[startedAt, countedAt]` (silver's `bottom_ms`, same for every direction) |
| `rising_ms` | int ≥ 0 \| null | `tempo_ms - lowering_ms` |
| `flags` | `Flag[]` ≤ 20 | `SetFlags.reps[rep_index].flags` |

`null` for `start_ms` / `end_ms` / `lowering_ms` / `rising_ms` only happens on the server side (legacy or seeded rows); the phone always fills them, except `lowering_ms` / `rising_ms` when the rep has no window frame in range.

Fractional capture times round clock positions before subtraction: `tempo_ms = end_ms - start_ms` and `rising_ms = tempo_ms - lowering_ms`. This can differ by 1 ms from rounding `durations.rep` independently. The unrounded engine duration must still match `countedAt - startedAt`.

### SetRecord

`schema_version`, `set_index`, `exercise_id`, `weight_kg` (number 0–1000 \| null), `end_reason` (`still | absent | lost | manual`), `partial_reps` (int ≥ 0), `fps` (number > 0, ≤ 240 \| null when fewer than 2 frames), `frames` (`JointFrame[]` ≤ 5400), `reps` (`Rep[]` ≤ 200). All required, no other properties.

### Server-side shapes

`ExportSet` = `set_index`, `exercise_id`, `weight_kg`, `medal` (`bronze | silver | gold` \| null), `end_reason` (\| null for legacy rows), `partial_reps` (\| null), `fps` (\| null), `frames`, `reps`.
`ExportSession` = today's `FinishedSession` fields with `inference_mode` from the new enum and `sets: ExportSet[]`.
`MetaSet` = `ExportSet` without `fps` / `frames`, plus `frame_count`. `ExportMeta` = today's `buildMetadata` output with `sets: MetaSet[]`.
`ExportJointsLine` = `session_id`, `set_index`, `exercise_id`, `fps`, `frames`.

## 3. Phone: `apps/mobile/src/engine/setRecord.ts`

- `createSetRecorder(spec, { setIndex, weightKg? })` returns `{ pose(result), event(e), finish(setFlags), reset() }`.
  - `pose(result: PoseResult)`: call for every detection that has a result, **before** handing that frame's engine events to `event`. No-person detections are not passed (no frame is kept for them).
  - Before the first `rep_started`, keep only a ring of the last 1000 ms of poses. On the first `rep_started` keep the ring frames with `t >= startedAt - 1000`, then every pose until `set_ended`; ignore poses after it.
  - Cap at `MAX_SET_FRAMES = 5400` (BE-04's limit); later poses are dropped, reps still recorded.
  - `event(e: EngineEvent)`: collects `rep_closed` records, counts `partial`, notes `set_ended`.
  - Closed records are reduced to scalar aggregates immediately so their frame windows are not retained. The recorder rejects more than 200 reps, malformed/out-of-order input, and missing or inconsistent final rule results. `finish` requires `set_ended`; reset all collectors for the next set.
  - `finish(setFlags: SetFlags): SetRecord`: throws if `setFlags.total_reps` ≠ the number of closed reps (contract problem, not a fallback).
- `buildSetRecord(input)` is the pure packaging step the recorder calls; tests drive it directly.
- Frames are the **raw** `PoseResult` joints, flattened `x, y, c` per joint in `JOINT_NAMES` order, rounded like `compactPose` (x/y 4 decimals, c 2). `t_ms = round(timestamp_ms - origin)`, origin = first kept frame (else the first rep's `startedAt`, else 0).
- `fps = (n - 1) * 1000 / (t_last - t_first)` to 0.1, `null` when n < 2.
- No gzip, no quantising on the phone (INT-01: only the API compresses).
- No React hook: INT-02 wires `pose` from `onPose` and `event` from `useFormEngine`'s `onEvent`.

## 4. API (BE-04, CONN-02, CONN-05)

- `upload.ts` and `score.ts` use the shared types; the stub interfaces go. `buildMetadata` returns `ExportMeta`, `buildJointsFile` writes `ExportJointsLine`s, and both take `set_index` from the set (not the array position).
- `setInput` / `createSessionInput` zod mirror `SetRecord` / `SessionStart` and are typed against them (`z.ZodType<SetRecord, z.ZodTypeDef, unknown>`), so drift fails tsc. Unknown keys are stripped (zod default), so a client still sending `clean` or `medal` isn't rejected.
- `buildExportSession` passes `quality` through (null stays null), `set_index` = `sets.position`, and the new fields.
- Migration `0008_set_record`, after main's `0007_db12_rehab`: rename enum value `on_device` → `coreml`, add `vision`, drop the `inference_mode` default; add `sets.end_reason text`, `sets.partial_reps integer`, `reps.lowering_ms integer`, `reps.rising_ms integer` (all nullable). Upgrade tests cover populated databases through both `0006` and `0007`.
- INT-08's manual workout screen stays local until a separate manual-upload contract exists. The upload helper takes shared `SessionStart` / `SetRecord` types and preserves caller-supplied set indices and pose source.

## 5. Databricks

`bronze.py`: `FLAG` + `rep_index`, `REP` + `lowering_ms` / `rising_ms`, `SET` + `end_reason` / `partial_reps`. `specs/set-record.test.mjs` parses the Spark schemas and fails when a field name or type drifts from the JSON Schema. Silver and gold read only the fields they already read.

## 6. Tests

- `node --test specs/*.test.mjs`: every `fixtures/valid/<Def>/*.json` passes its def; removing each required field at every depth fails; a few hand-made invalid cases; `types.ts` is up to date; bronze drift.
- mobile Jest: unit tests of `buildSetRecord` and the recorder; clips run through engine → rules → recorder must equal `specs/set-record/fixtures/valid/SetRecord/<clip>.json` (`UPDATE_SET_RECORD_FIXTURES=1 npx jest setRecord` rewrites them).
- api vitest: every `SetRecord` fixture parses with `setInput`; removing a required field fails; one fixture posted through the route stores the expected rows; the export built from it validates as `ExportMeta`.

## 7. Not here

The `curl` / `press` rename (INT-12, #110). Phone-generated set ids (INT-03). Per-set `inference_mode`. `image_aspect`.
