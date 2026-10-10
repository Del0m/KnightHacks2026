Closes #46.

This adds the form engine in `apps/mobile/src/engine/`. It turns the stream of `PoseResult`s into reps for any of the five AI-05 specs. Each joint gets its own One Euro filter, the spec's metrics are computed every frame, and a rep state machine with hysteresis runs on the primary angle. When a rep settles, the engine hands over its frame windows so AI-07 can evaluate rules without changing the engine. The `useFormEngine` hook gives FE-05 a live rep count. The debug screen now shows the rep state and can record clips from the phone.

Branched from `main`, which has AI-05 (#82) and #83 (backend only, no overlap). The spec format is unchanged. One sentence in the settle rule is clarified, see below.

## What the engine produces

| Consumer | Gets | Where |
|---|---|---|
| FE-05 live screen | `repCount`, `state` (`start` / `outbound` / `peak` / `return`), `ended`, and `endSet()` / `reset()`. It re-renders only when these change. | `useFormEngine(spec, { imageAspect })` |
| FE-06 amber tint | Smoothed joints for every frame through `onUpdate`. The rule's `joints` come from AI-07 flags. | `EngineUpdate.joints` |
| AI-07 rules | `rep_closed { rep }`, with per-frame windows `outbound`, `peak`, `return` and `rep`. Each frame carries every spec metric, the side it was read from, and the smoothed joints. Also the `durations` (ms) per phase. | `RepRecord` |
| AI-08 set record | `index` (1-based, the `rep_index`), `startedAt` / `peakAt` / `returnAt` / `countedAt` / `closedAt`, `extreme` (the peak primary angle, for `range_deg` and range-of-motion tracking) and `side`. Smoothed joints are in the windows. | `RepRecord` |
| Tests and new clips | The `Clip` format (`PoseResult` frames plus `{ absent, timestamp_ms }`), shared by the synthetic generator and the on-phone recorder | `recording.ts` |

## Changes

- **`types.ts`:** spec types that mirror `schema.json`, plus the engine's output types.
- **`specs.ts`:** bundles the five specs straight from `<repo>/specs/exercises`.
  - `apps/mobile/metro.config.js` adds `specs/` to `watchFolders`, so there's one copy and no build step.
  - Jest and `tsc` already resolve the relative import.
- **`oneEuro.ts`:** a One Euro filter on x and y for each of the 17 joints, using `timestamp_ms`, so it handles variable fps (cloud mode is about 10 fps).
  - **Defaults:** `minCutoff 0.3`, `beta 8`, `dCutoff 1.0`, tuned for normalized coordinates at 10–15 fps with noise σ 0.003–0.008.
  - **Measured:** still-joint jitter drops 54–69%, and a 1 Hz movement lags 45–49 ms.
  - **Low-confidence joints:** a joint below `c` 0.3 holds its last position for 300 ms, then becomes missing. Smoothing restarts after a gap and never bridges it.
- **`angles.ts`:** `jointAngle`, `segmentTilt` and `widthRatio`, plus point resolution (COCO, unsided and `mid_`) and all six `side` modes.
  - **Aspect correction:** joints are normalized per axis, so x is scaled by the image's width ÷ height before measuring. Without this, a true 90° on a portrait frame reads more than 20° off. The default is 9/16, and the debug screen passes the real frame size.
  - **`most_visible`:** sticky. It switches only when the other side leads by 0.1 mean confidence, and it's locked for the length of a rep.
  - **Missing points:** `mid_` and the `both_avg` / `min` / `max` modes fall back to whichever side is present. A metric that needs a missing point is `null`.
- **`repCounter.ts`:** the AI-05 state machine.
  - **Gating:** every transition needs `min_state_ms`, and frames without a primary angle pause that clock.
  - **Counting:** partials aren't counted, a rep is counted at the `start_enter` crossing, and going deeper during `return` doesn't change state.
  - **Settle tail:** rule windows keep collecting after the count until the movement settles.
  - **Set end:** still in `start` for `set_end_still_ms`, absent for that long, or manual. The still and absent ends only apply after the first counted rep, so standing still during setup never ends a set. A rep cut off by the end is a partial.
- **`engine.ts`:** `createFormEngine(spec, options)`, which combines the three pieces above.
  - **API:** `push(pose)`, `pushAbsent(t)`, `endSet(t)` and `reset()`.
  - **Events:** `rep_started`, `partial`, `rep_counted`, `rep_closed { rep }` and `set_ended { reason }`.
- **`useFormEngine.ts`:** the hook for FE-05. It takes `onPose` for `usePoseOutput`, plus `onEvent` and `onUpdate` callbacks.
- **`recording.ts`:** the `Clip` format and `createClipRecorder`.
- **Debug screen (`src/pose/PoseDebugScreen.tsx`):**
  - **Exercise switcher.**
  - **Readout:** exercise, state, reps, set end, primary angle and side.
  - **"New set" button.**
  - **Recorder:** a "Record clip" button shares the pose stream as clip JSON through React Native `Share`, with no new native dependency. It shows in Release builds too, since the whole screen is a debug screen.
  - **Banner placement:** the error banner now sits below the readout instead of at a fixed 160 px. The longer readout was disappearing behind it.
- **Fixtures (`src/engine/__fixtures__/`):** a seeded stick-figure generator (`synth.ts`) produces ten clips, 1.8 MB in total. `UPDATE_FIXTURES=1 npx jest src/engine/__tests__/fixtures.test.ts` regenerates them, and a test fails if the committed JSON drifts from the generator.
- **Docs:**
  - **Design contract:** `docs/superpowers/specs/2026-10-10-form-engine-design.md`.
  - **Root `Architecture.md` §6.1:** new bullets on the engine, missing data and set end.
  - **`docs/specs/exercise-spec-format.md`:** a short "How the engine reads a spec" section.

### One rule changed from AI-05

While building the counter we found that the settle rule as written ("holds within `reverse_deg` for `min_state_ms`") closes the `return` window too early on a slow lockout. Any approach to the top slower than about 33°/s (5° per 150 ms) ended the window before the arms straightened, which is the case the window exists for.

The tail now closes once the angle has made no progress toward the start (under 1°) for `min_state_ms`, or has moved back by `reverse_deg`. The headline rule, "the window runs until the movement settles", is unchanged. Only the wording of the hold condition in `exercise-spec-format.md` changed. A test covers a lockout rising at 20°/s.

## Test clips

There's no real recording yet, so these are synthetic. A seeded 2D stick figure in 1080 × 1920 pixel space traces each exercise's primary angle along a known path, so the expected counts hold by construction.

The clips include:
- noise and outlier spikes
- variable fps and timestamp jitter
- low-confidence dips
- far-side joints with low confidence
- no-person gaps

Every clip runs through the real engine. The figures below are actual, from this branch:

| Clip | Frames | Reps (expected / counted) | Partials | Set end | Peak angle per rep | Top of `return` window | Side |
|---|---|---|---|---|---|---|---|
| `squat_clean` | 398 | 6 / 6 | 0 / 0 | still / still | 85–95° | 172° | right |
| `squat_noisy` (σ 0.006, 10–15 fps, spikes, two 0.5 s gaps) | 246 | 6 / 6 | 0 / 0 | – | 87–94° | 170–173° | right |
| `squat_threshold_hover` (wobble around `start_enter`, 2 partials) | 321 | 4 / 4 | 2 / 2 | – | 88–93° | 168° | right |
| `squat_bounce_pause` (pauses, 3° bounce at the bottom) | 329 | 4 / 4 | 0 / 0 | – | 87–90° | 172° | right |
| `squat_absent_end` | 286 | 3 / 3 | 0 / 0 | absent / absent | 87–91° | 172° | right |
| `push_up_lockout` (elbow keeps rising 150→168 after the count at 155) | 262 | 5 / 5 | 0 / 0 | – | 85–91° | 166–168° | left |
| `bicep_curl_clean` | 321 | 8 / 8 | 0 / 0 | – | 42–53° | 165–166° | left |
| `shoulder_press_clean` (increasing) | 280 | 6 / 6 | 0 / 0 | – | 167–171° | – | left |
| `shoulder_press_cloud` (10 fps, heavier noise) | 187 | 6 / 6 | 0 / 0 | – | 166–175° | – | right |
| `lunge_alternating` (`side: "min"`) | 300 | 6 / 6 | 0 / 0 | – | 90–95° | 176° | left, right |

The push-up row shows the settle tail at work: the rep is counted at 155°, but the `return` window reaches the 166–168° lockout, so AI-07's "elbow max on return ≥ 160" rule will see it. For the press, `return` is the lowering, so its top isn't meaningful.

## Validation

Run from `apps/mobile`, `npx jest`:

```
Test Suites: 18 passed, 18 total
Tests:       259 passed, 259 total
Snapshots:   0 total
Time:        5.168 s
Ran all test suites.
```

On `main` this was 11 suites and 78 tests. The 181 new tests are:

- **`fixtures.test.ts`:** clips match the generator; frames are valid `PoseResult`s; a clean-path check (with its own angle math) that each rep passes `count_min` and comes back past `start_enter`.
- **`oneEuro.test.ts`:**
  - jitter and lag bounds
  - pass-through and `dt <= 0`
  - confidence hold and expiry
  - reset across gaps
- **`angles.test.ts`:**
  - geometry
  - aspect correction
  - `mid_` fallback
  - every side mode
  - `most_visible` margin, lock and fallback
  - all five real specs
- **`repCounter.test.ts`:**
  - both directions
  - ±4° jitter at every threshold
  - a bounce at the bottom
  - partials
  - `min_state_ms` gating
  - null frames
  - still, absent and manual set end, including no end before the first rep
  - the settle tail: hold, moved-back, next-rep and slow-lockout closes
  - durations and event order
- **`engine.test.ts`:**
  - every clip: exact count with indices 1..n, partials and set end
  - every counted rep closes once, with ordered, non-empty windows and consistent durations
  - push-up lockout inside the window
  - press direction
  - both lunge legs
  - manual end mid-rep
  - reset
  - no-person frames
  - without smoothing, the noisy squat is still not over-counted
- **`useFormEngine.test.ts`:**
  - counts a clip
  - forwards events
  - renders far fewer times than there are frames
  - end and reset
  - no spec
- **`recording.test.ts`:** rounding and the JSON round trip.

`npx tsc --noEmit`: 93 errors, the same 93 as on `main`. All are in the FE files under `src/app`, `src/components`, `src/screens` and `src/state`, which need `expo-router`. There are none in `src/engine`, `src/pose` or `metro.config.js`.

From the repo root:

`node --test specs/*.test.mjs`:

```
ℹ tests 38
ℹ pass 38
ℹ fail 0
```

`node specs/validate.mjs`:

```
✓ bicep_curl.json
✓ lunge.json
✓ push_up.json
✓ shoulder_press.json
✓ squat.json
```

## Not checked

- **No real recording yet.** "No double counts on a recorded test clip" is shown only on synthetic clips. The recorder is there to close this gap:
  1. Record a set on a phone.
  2. Save the shared JSON to `src/engine/__fixtures__/`.
  3. Fill in `expected` by hand.

  The engine tests then cover it automatically.
- **Built and installed, not yet exercised on a device.** `npx expo run:ios --device … --configuration Release` built with 0 errors and installed on an iPhone 17 Pro Max. The bundle step resolved the specs through `watchFolders`. Counting live reps on the phone hasn't been checked yet. Sharing a long clip through `Share` as a message may be slow or truncated on some share targets.
- **Lint not run.** `npx expo lint` still fails with `Cannot find module 'eslint'`.
- **Filter tuning comes from synthetic noise.** Real YOLOv8 and Apple Vision jitter may need different `beta` / `minCutoff`. The values are overridable through `EngineOptions.filter`.
- **Default aspect ratio.** 9/16 assumes portrait 1080 × 1920. Cloud mode (CONN-11) and any other frame size must pass `imageAspect`.

## Known limits

- **Hovering at `start_exit`.** `min_state_ms` doesn't debounce leaving `start`, because a standing lifter has already been in `start` for a long time. A standing angle that wobbles across `start_exit` starts an attempt that ends as a `partial` event. Hysteresis stops it from being counted, but it adds partials.

  The same applies if someone's resting angle sits between `start_exit` and `start_enter` (for example soft knees at 158° in a squat). The counter then stays in `outbound` until they straighten past `start_enter`, and their reps only count once they do. That's a threshold-tuning question for the specs, best answered with recorded clips.
- **The "next rep starts" close is a safety net.** With the bundled specs, the settle tail always closes on hold or moved-back first. This is documented in the design contract.
- **No-person timestamps.** No-person frames are stamped with `Date.now()` in the hook. Native `timestamp_ms` is also Unix time, but the two can be a few ms apart. That only affects the 8 s absent timer.

## Also on this branch

These are not part of AI-06:

- **`issues/issues.json`:** adds an `area: integration` label and `INT-0x` dependencies on several DB, BE and FE issues.
- **`Markdown/Integration-Issues-Prompt.md`:** a brief for creating those integration issues.
- **`apps/mobile/package.json`:** a `lint` script (`expo lint`). `eslint` still isn't installed, so it fails for now.
- **`.gitignore`:** ignores sync conflict copies (`* 2`, `* 2.*`, as iCloud and Finder name them). No tracked file matches either pattern.

## Not included

- **AI-07:** rule evaluation, flags, camera-view detection for `view`, `applyOverride` / multiple injuries, and `REHAB_LIMIT`. The engine takes the spec with overrides already merged.
- **AI-08:** the set payload and joint compression.
- **FE-05 / FE-06:** the live set screen and the amber tint. The hook and the per-frame joints are ready for them.
- **Loading specs from the API (BE-06):** the specs are bundled. A server spec can be passed to `useFormEngine` once BE-06 exists.
