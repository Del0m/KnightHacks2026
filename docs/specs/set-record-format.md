# Set record format

A finished set travels from the phone to the API, then to Neon and Databricks, in one shape defined once in `specs/set-record/schema.json` (INT-01). The phone builds it when the set ends (AI-08, `apps/mobile/src/engine/setRecord.ts`). Background: root `Architecture.md` §6.1, §9.2, §9.3, §11.1 and §13.

| File | What |
|---|---|
| `specs/set-record/schema.json` | JSON Schema. The single source for every shape below. |
| `specs/set-record/types.ts` | TS types, generated: `node specs/set-record/generate-types.mjs`. Both apps import them type-only. Never edit by hand. |
| `specs/set-record/fixtures/valid/<Def>/*.json` | Valid examples per def. `SetRecord/<clip>.json` are the engine's real output for the committed clips. |
| `specs/set-record/fixtures/medals/*.json` | INT-06 medal parity fixtures (their own format). |
| `specs/set-record.test.mjs` | `node --test specs/*.test.mjs`: fixtures, required fields, stale `types.ts`, bronze drift. |

## Where each shape goes

| Def | Path | Producer → consumer |
|---|---|---|
| `SessionStart` | `POST /sessions` body | phone (INT-03) → BE-04 → Neon `sessions` |
| `SetRecord` | `POST /sessions/:id/sets` body | phone (AI-08) → BE-04 → Neon `sets`, `reps`, `form_flags`; frames held in memory until finish |
| `ExportSession` / `ExportSet` | in-process | BE-04 `buildExportSession` → CONN-02 uploader |
| `ExportMeta` / `MetaSet` | `meta/<date>/<session_id>.json` | CONN-02 `buildMetadata` → bronze `META_SCHEMA` / `SET` |
| `ExportJointsLine` | one line of `joints/<date>/<session_id>.ndjson.gz` | CONN-02 `buildJointsFile` → bronze `JOINTS_SCHEMA` |
| `Rep`, `Flag`, `JointFrame` | inside the above | bronze `REP`, `FLAG`, `JOINTS_SCHEMA.frames` |

Neon keeps aggregates only. Per-frame joints are buffered by the API for export to Databricks (§9.1). Only the API gzips; the phone sends plain JSON.

## Clocks

- **Set clock.** Every `t_ms`, `start_ms` and `end_ms` is integer milliseconds since the set's first kept frame (`t_ms = 0`). Frames come from the pose clock: `PoseResult.timestamp_ms`, the capture time.
- **Wall clock.** `started_at`, `finished_at` and `exported_at` are ISO 8601 strings with an offset, set by the API (or the phone for `started_at`).
- **Durations.** `tempo_ms`, `lowering_ms` and `rising_ms` are lengths, not times on a clock.

## Identifiers

| Field | Meaning |
|---|---|
| `schema_version` | `1`. On `SetRecord` and `ExportMeta`. |
| `set_index` | 0-based position of the set in its session, chosen by the phone. Neon `sets.position`; unique per session. |
| `rep_index` | 0-based within the set: the engine's rep number (`RepRecord.index`) minus 1. Equals the rep's array position. |
| `Flag.rep_index` | Equals its rep's `rep_index`. The API rejects a set where they differ. |
| `exercise_id` | Spec id, `^[a-z0-9_]{2,60}$`: `squat`, `push_up`, `bicep_curl`, `shoulder_press`, `lunge`. |
| `inference_mode` | `coreml` (YOLOv8 on the phone), `vision` (Apple Vision basic mode) or `cloud`. Per session. |
| `user_id` | The Neon id inside the API only. `ExportMeta.user_id` is its HMAC pseudonym (CONN-02); the phone never sends or hashes it. |

## SetRecord

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | `1` | |
| `set_index` | int 0–200 | See identifiers |
| `exercise_id` | string | See identifiers |
| `weight_kg` | number 0–1000 or null | Load, null for bodyweight or not entered |
| `end_reason` | `still`, `absent`, `lost`, `manual` | Why the set ended (§6.1) |
| `partial_reps` | int ≥ 0 | Attempts that left the start position but weren't counted |
| `fps` | number (0, 240] or null | Measured: `(frames − 1) × 1000 / (last t_ms − first t_ms)`, to 0.1. Null with fewer than 2 frames. |
| `frames` | `JointFrame[]`, at most 5,400 | See frames |
| `reps` | `Rep[]`, at most 200 | Counted reps, in order |

Not phone fields: `clean`, `clean_share`, `medal` and `score_source`. The server derives clean (a rep with no flags, INT-06) and everything that follows from it. An old client sending them isn't rejected; the API drops them.

## Rep

| Field | Type | Phone source (`RepRecord`) |
|---|---|---|
| `rep_index` | int ≥ 0 | `index − 1` |
| `start_ms` | int ≥ 0 or null | `startedAt` (left the start position) on the set clock |
| `end_ms` | int ≥ 0 or null | `countedAt` (crossed back, counted) on the set clock |
| `tempo_ms` | int 0–120,000 | Start-to-count duration; equals `end_ms − start_ms` after rounding the clock positions |
| `range_deg` | number 0–180 | Movement range: max − min of the primary angle over the rep's frames (`windows.rep`) that pass the primary gate, up to the count, to 0.1°. The settle tail after the count and gate-failing frames (a rest position, arms hanging down) are left out, as in AI-07's depth, lockout and tempo checks. Bigger is a fuller rep for every exercise. |
| `quality` | number 0–1 or null | The form-quality model's score, advisory only (INT-06). Always null from the phone. |
| `lowering_ms` | int ≥ 0 or null | Start → turn: from `start_ms` to the first gated frame at the rep's direction-aware extreme (minimum for decreasing exercises, maximum for increasing), the same split as AI-07's `phaseDuration(spec, rep, 'outbound')`. It is the lowering only for eccentric-first exercises (squat, push-up); for the press and curl it is the lift. |
| `rising_ms` | int ≥ 0 or null | Turn → count: `tempo_ms − lowering_ms`, including any pause at the extreme. |
| `flags` | `Flag[]`, at most 20 | AI-07's flags for this rep |

Null `start_ms` / `end_ms` come from legacy or seeded rows. The phone fills them even when joints were dropped at the cap. The phone always fills `lowering_ms` / `rising_ms`; when no gated frame reaches the extreme it uses the engine's own phase durations, as AI-07 does. Missing boundaries prevent the pipeline from matching a rep to frames.

For fractional capture timestamps, clock positions are rounded first and durations are their differences. `tempo_ms` can differ by 1 ms from independently rounding `durations.rep`; this preserves both `end_ms − start_ms = tempo_ms` and `lowering_ms + rising_ms = tempo_ms`. The builder rejects an engine duration inconsistent with its unrounded start/count timestamps.

The engine measures smoothed joints with x scaled by the image aspect (§6.1); silver measures raw `kp` on unscaled coordinates. Their ranges and timing features can therefore differ substantially. This record does not carry image aspect or smoothing configuration and cannot reproduce the original engine run exactly.

## Flag

| Field | Type | Meaning |
|---|---|---|
| `rule_id` | string | Rule id from the exercise spec |
| `severity` | `form` or `safety` | From the spec rule, after injury overrides |
| `rep_index` | int ≥ 0 | The rep it belongs to |

## Frames

- Each `JointFrame` is `{ t_ms, kp }`. `kp` is 51 numbers: `x, y, c` for each of the 17 COCO joints in the pose contract's order. `x` and `y` are normalised 0–1 in the upright, unmirrored image; `c` is confidence 0–1.
- They're the **raw** pose joints, not the smoothed ones, so a recorded set can be replayed through a later engine. Rounded like the clip recorder: x and y to 4 decimals, c to 2.
- **Kept:** from 1 s before the first rep starts until the set ends. Frames with no person are left out. Gaps in `t_ms` can also reflect dropped detections or irregular inference; the payload does not distinguish these causes.
- **Cap:** at most 5,400 frames (3 minutes at 30 fps, BE-04's limit). Later frames are dropped; reps are still recorded.
- **Memory:** closed reps are immediately reduced to scalar aggregates; their frame windows are released by the recorder. It holds at most 200 rep aggregates and rejects a longer set instead of silently losing reps. The engine and rule collector have their own lifetimes.
- **Validation:** poses and events must arrive in timestamp order; duplicate pose timestamps, malformed poses, missing rule results, an unrepresentable FPS, and out-of-contract fields throw. `finish` requires `set_ended` and matching final flags. Repeated `finish` is safe; reset the recorder together with the engine and rules for the next set.
- **Size:** the 16 replay snapshots contain 141–424 retained frames each, with compact JSON payloads of 48,424–144,403 bytes. These are synthetic fixtures, not a device performance benchmark.
- Joints only. Video never leaves the phone (§13).

## Export shapes

`ExportSet` is a stored set with its buffered frames: `set_index`, `exercise_id`, `weight_kg`, `medal` (the set's rest-time medal, or null), `end_reason`, `partial_reps`, `fps`, `frames` and `reps`. `end_reason` and `partial_reps` are null for sets recorded before AI-08. `fps` is null and `frames` empty when the API no longer holds the joints (for example after a restart).

`ExportSession` adds the session: `id`, `user_id`, `started_at`, `finished_at`, `device`, `inference_mode`, the workout `medal` and `form_score`, `experience_level`, `injury_groups` (coarse tags such as `knee:left`) and `rehab_start_on`.

`ExportMeta` is what lands in the Volume: the session fields with the pseudonymous `user_id`, plus `schema_version`, `joints_path` and `exported_at`. Each `MetaSet` is an `ExportSet` with `frame_count` in place of `fps` and `frames`.

Legacy stored flag severities `info` and `warn` export as `form`; `safety` stays `safety`. Other unknown legacy values cause export to fail rather than dropping the flag and changing clean status. The request contract accepts only `form` and `safety`.

The JSON Schema defines shapes and field limits. The API additionally validates `started_at` as an ISO datetime with a timezone, and checks rep/flag positions and duration relationships. Unknown request fields are stripped for compatibility, although the canonical schema rejects additional properties.

## Changing the contract

The manual workout screen saves locally until a separate manual-upload contract exists. `uploadWorkout` accepts `SessionStart` and complete `SetRecord` objects, preserving their set indices; its caller supplies the actual pose source. INT-02 still owns wiring the recorder into the live workout and handing its output to the client. INT-12 owns the UI's `curl`/`press` identifier migration.

1. Edit `schema.json`, then run `node specs/set-record/generate-types.mjs`.
2. Update `bronze.py` if an exported field changed. `node --test specs/*.test.mjs` names any drift.
3. Update the API's zod schemas in `apps/api/src/routes/sessions.ts`. They're typed against the shared types, so tsc fails until they match.
4. Regenerate the phone fixtures: `UPDATE_SET_RECORD_FIXTURES=1 npx jest setRecord` in `apps/mobile`.
5. A breaking change bumps `schema_version`, and bronze's `known_schema_version` expectation with it.
