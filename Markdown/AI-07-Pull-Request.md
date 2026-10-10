Closes #47.

This adds the form rules in `apps/mobile/src/engine/`. When the AI-06 engine closes a rep, every rule in the effective spec is checked against the rep's frame windows at its phase.
- Rules that need a camera angle are gated by a per-rep view detection.
- Each failed check becomes a silent flag `{ rule_id, severity, rep_index }`.
- Flags are held until the set ends and then released as one set summary, with per-rule counts and the top rule for the rest note.
- Injury overrides are applied per user, including users with more than one injured body part, using the same merge as `specs/validate.mjs`.

It also fixes what device testing on an iPhone turned up:
- The shoulder press counted false reps from rest positions.
- A set resting mid-position never ended.
- The app crashed on launch.

Branched from `main` after #104 (AI-06) merged.

## After merge

- For each deployed Neon branch/environment that serves exercise specs, select its database connection, then run `npm run db:load-specs` from `apps/api`. Check `GET /exercises/shoulder_press/spec` for the `arm_raise` gate, target 150 and tempo 600, and the squat/lunge specs for side-only depth. The reload upserts spec content and updates the timestamp used by `Last-Modified`.
- `spec_version: 1` identifies the schema format, not an exercise-content revision. INT-07 (#91) must use content modification metadata or a content revision/hash to detect updates.
- Review follow-ups intentionally left open: unjudged-rep medal eligibility (#115), intentional-hold policy (#116), range-rule override merging (#117), and timing across jump rejections (#118). The current clean definition, still-end policy, override merge and active-time pause behavior remain until those coordinated changes land.

## What the rules produce

| Consumer | Gets | Where |
|---|---|---|
| FE-06 amber tint | The flagged rules' `joints` for the rep that just closed. A next `rep_started` clears them after a minimum 300 ms; set end clears immediately. | `useFormRules(spec).tintJoints` |
| INT-02 live set | `onEvent`, chained from `useFormEngine`'s `onEvent`. `summary` and `onSetFlags` fire once the set ends. | `useFormRules` |
| AI-08 / INT-01 set record | `SetFlags`: `flags` (0-based `rep_index`), every rep's `RepResult` (each rule's status and value, detected view), `total_reps`, `clean_reps` and `reason` | `createSetRules(spec).handle(e)` |
| INT-06 clean / medal | A rep is clean when `RepResult.flags` is empty. The rules run on the effective spec, so clean means "within your limits". | `RepResult`, `SetFlags.clean_reps` |
| BE-07 / AI-11 rest note | Per-rule `n`, `evaluated` and `mean_value`, the `top` rule by safety severity then priority, and the injury `extra_notes`. `restNote()` fills `{n}`, `{total}`, `{value}` and `{t}` for the phone's fixed fallback. | `SetFlags.rules`, `restNote(spec, set)` |
| INT-07 / AI-16 limits | `applyInjuries(spec, injuries)` returns an `EffectiveSpec`. A generated rule such as `physio_limit` added to `spec.rules` is evaluated like any other. | `overrides.ts` |

## Changes

- **`rules.ts`:**
  - **`evaluateRep(spec, rep, { view? })`** checks each rule in order:
    1. Skip it if its `view` doesn't match the rep's view.
    2. Resolve threshold names (`"target"`) against the effective `phases`.
    3. Reduce the metric over the phase's frames and compare. The rule passes when the check holds; otherwise it flags.
  - **`createSetRules`** keeps each rep's result and returns the set summary on `set_ended`.
  - **`summarizeSet`**, **`fillRestNote`** and **`restNote`** build the summary and the fixed rest note.
- **How a check is measured:**
  - **Missing data:** the reduction uses only frames where the metric was measured. With under half the phase's frames, the rule is `unmeasured` for that rep, with no flag. A side-on squat's `knee_width_ratio`, which is null on every frame, never flags.
  - **`mid_` points** (review item 7 on #104): within a phase, only frames whose midpoints were taken the same way as in most of them are used, either both sides or one. A hip dropping out mid-rep can't add a jump in trunk tilt.
  - **`duration_ms`** is measured from the frames, with the deepest point (within 1°) as the turn:
    - `outbound` runs from leaving the start to first reaching the extreme.
    - `peak` is the time at the extreme.
    - `return` runs from leaving the extreme to the count.

    The engine's `durations.outbound` stops at `count_min`, which is only the top third of a squat's descent. With it, "Your reps took about {t} s on the way down" read 0.2 s for a 1 s descent. `rep.durations` is unchanged.
- **`view.ts`:** `detectView` takes each rep's median of (shoulder x-gap + hip x-gap) / (2 × torso length), aspect-corrected.
  - **Front:** 0.4 and up.
  - **Side:** 0.25 and below. A frame where only one side's shoulder and hip are visible also counts as side.
  - **Otherwise unknown**, which runs only `any` rules.
  - **Caller override:** a `view` passed in (for example from a setup screen) wins.
  - **Measured on the fixtures:** side clips 0.023–0.034, front clips 0.53–0.54, and a squat turned 30° from the camera 0.43–0.44.
- **`overrides.ts`:**
  - **`applyOverride`** ports the validator's merge line for line.
  - **`applyInjuries`** applies `knee`, `shoulder` and `lower_back` in that order. When two overrides set the same thing, the more conservative one wins:
    - `count_min` / `target`: the one asking for less range.
    - Numeric rule values: the stricter bound for the rule's `op`.
    - Severity: `safety` wins.
    - `disable_rules`: unioned.
    - `extra_note`s: all kept.
- **`specs/validate.mjs`:** exports the same `applyInjuries`, and now checks threshold order for all 7 injury combinations. The parity test is described under Validation.
- **`useFormRules.ts`:** the hook for INT-02 and FE-06. It re-renders only when the tint, the last rep or the summary changes, and it sets no state during render or in effects.
- **Engine (AI-06 follow-ups):**
  - **`lost` set end** (review item 6 on #104): a null-primary gap ends the set as `lost` when a person was in view for most of it (for example, ankles cropped out), and as `absent` otherwise.
  - **`RepRecord.imageAspect`** lets the view detection measure geometry on the window joints.
- **Specs:** squat and lunge `depth` are now `view: "side"`. From a front or three-quarter angle the knee angle is foreshortened (113–119° at a true 75° bottom), so depth flagged every rep. Square-on from the front, the 2D knee angle stays at 180° and no reps count at all.
- **Types (`types.ts`):** `Flag`, `RuleOutcome`, `RepResult`, `RuleAggregate`, `SetFlags`, `EffectiveSpec`, `DetectedView` and `PrimaryGate`.
- **Docs:**
  - **Design contract:** `docs/superpowers/specs/2026-10-10-form-rules-design.md`.
  - **`docs/specs/exercise-spec-format.md`:**
    - `duration_ms` per phase
    - 0-based `rep_index`
    - how the rules handle view and missing data
    - the multi-injury table
    - placeholder formatting
  - **Root `Architecture.md` §6.1 and §6.2:** the `lost` set end, a form rules bullet, multiple injuries, and the depth `view` in the example spec.
  - **AI-06 design doc:** `lost`, `imageAspect`, the gate, reliable frames and still end anywhere.

### From device testing

A seated shoulder press on an iPhone 17 Pro Max (front camera, Release build, on-device Core ML) showed problems a screen recording and a recorded clip pinned down.

**Counting only real movement:**
- **The problem:** the press counted reps from rest positions. A straight elbow reads the same with arms hanging down as overhead, and hands in the lap (about 131°) already sit mid-rep, so lowering the arms, shifting in the chair, or wrists cropped at the frame edge all added reps.
- **Primary gate (spec format):** `primary_angle.gate: { metric, op, value }` must hold for a rep to reach its peak. The press gates on a new `arm_raise` metric (shoulder→wrist tilt, lower arm) `<= 60`: wrists above the shoulders. The schema, validator (gate metric must be another angle, not `duration_ms`), validator tests, format doc and Architecture §6.1 are updated together.
- **Reliable frames:**
  - The primary angle is null when one of its joints is below `minConfidence`; the 300 ms hold still feeds the other metrics.
  - A value moving faster than 720°/s from the last accepted one is rejected, and accepted after 3 rejections in a row. The fastest fixture rep moves at 225°/s.

**Still end from any position.** Stillness only counted in `start` with a 5° band, so a set resting mid-position never ended. It now counts in any state, within 10°, once a rep has counted. An attempt in progress becomes a partial.

**Press limits loosened.** Your recording measured lockout 137–152°, forearm lean 26–39° and lowering 0.3–0.5 s.

| Rule | Was | Now |
|---|---|---|
| `lockout` (`target`) | 160° | 150° |
| `wrist_stack` phase | `rep` (included the lift from the lap) | `peak` |
| `wrist_stack` value | 20° | 35° |
| `tempo` | 800 ms | 600 ms |

**Debug screen.** It's reached at `spotter://pose-debug`, a new dev route; the screen had no route since expo-router became the entry.
- It runs `useFormRules`: flagged joints draw amber and larger.
- The readout shows each flag's value against its limit (`tempo 0.5s < 0.6s`) and the set summary with its rest note.
- An **End set** button ends the set by hand. FE-05 / INT-02 need one on the live screen too: a set taken to failure can't rely on standing still.

**Two fixes for `main`, which affect everyone:**
- **Launch crash:** the Train tab built `Intl.PluralRules` at module load. Hermes on iOS doesn't have it, so the app closed on launch with `TypeError: undefined cannot be used as a constructor`. Ordinals are now computed by hand, with a test against `Intl` for 1–200.
- **Reanimated wasn't declared:** expo-router needs it, so npm installed 4.7.1, which needs worklets 0.13 and failed `pod install` against the pinned 0.10.1. It's now declared at 4.5.1, Expo SDK 57's version. `package-lock.json` also gains expo-router's tree, which only `pnpm-lock.yaml` had.

**After these changes, the user confirmed on the phone that the shoulder press counts and flags correctly.**

### Decisions taken

| Question | Decision |
|---|---|
| `rep_index` base | 0-based at the flag (`rep.index − 1`), matching INT-01 and `upload.ts`. The engine stays 1-based, matching the on-screen count. |
| When is the tint shown | At `rep_closed`, when the rep settles (about 0.2–0.5 s after the count). No provisional per-phase evaluation. |
| Who fills placeholders | The phone fills them for the fixed fallback; the same numbers in `SetFlags` go to BE-07 and AI-11. `{t}` is seconds to 0.1 (`0.8`, `1`). `{value}` is a whole number from 10 up, else up to 2 decimals. |
| Where multiple injuries are defined | Here, because "injury overrides applied per user" needs it. INT-07 only has to deliver the user's injuries. |

## Test clips

Every clip lists its complete expected flags (base spec, no injuries, detected view), checked by running the real engine and rules. The clean synthetic squats used to lean 44–48° against the 45° `trunk_lean` limit. They now lean 35–38°, and their rep counts are unchanged.

| Clip | View | Reps | Flags (`rep_index`, 0-based) |
|---|---|---|---|
| `squat_clean` | side | 6 | `tempo` 2, 4, 5 |
| `squat_noisy` | side | 6 | `tempo` 1, 5 |
| `squat_threshold_hover` | side | 4 | none |
| `squat_bounce_pause` | side | 4 | `tempo` 1 |
| `squat_absent_end` | side | 3 | `tempo` 0 |
| **`squat_off_form`** (new: two reps stop at ~110°, two lean ~55°) | side | 6 | `depth` 1, 3 (110.4°, 112.4° vs ≤ 95); `trunk_lean` 2, 4 (55.5°, 53.8° vs ≤ 45); `tempo` 0, 1, 3, 5 |
| **`squat_front_knees_in`** (new: turned 30°, knees in on alternate reps) | front | 6 | `knee_tracking` 1, 3, 5 (0.70–0.71 vs ≥ 0.9; clean reps 0.94); `tempo` 0–5 |
| `push_up_lockout` | side | 5 | `depth` 1, 3 (90.18°, 91.49° vs ≤ 90); `tempo` 0–4 |
| **`push_up_hip_sag`** (new: hips sag at the bottom of two reps) | side | 5 | `hip_sag` 1, 3 (153.4°, 153.1° vs ≥ 160; clean reps ~176°); `tempo` 0–4 |
| `bicep_curl_clean` | side | 8 | `tempo` 0–4, 6, 7 |
| `shoulder_press_clean` | front | 6 | none (`back_arch` is side-only, so skipped) |
| `shoulder_press_cloud` | front | 6 | none |
| `lunge_alternating` | side | 6 | none |
| **`shoulder_press_rest_positions`** (new: 3 presses, then arms to the sides, lap and chest, and a 9 s rest in the lap) | front | 3, plus 3 partials | none; set ends `still` |
| **`shoulder_press_cropped_wrists`** (new: low camera, hands in the lap between reps, wrists cropped with confidence 0.1–0.4 and 20–40 px jitter) | front | 4, plus 3 partials | none |
| **`squat_still_mid`** (new: 3 squats, then holding halfway down at 144° ±3° for 9 s) | side | 3, plus 1 partial | `tempo` 1, 2; set ends `still` |

**Why tempo flags on clean clips:** the synthetic movements take about 1 s, which gives 600–870 ms against the 800 ms floor. The specs ask for about 2 s, so these flags are correct, and the clips weren't slowed to hide them. At 15 fps, `outbound` lands on 733, 800 or 867 ms, so whether a rep flags comes down to one frame.

**The device clips reproduce the bugs.** On the engine before these fixes, each press clip counts 2 false reps and neither set ends; `squat_still_mid` never ends. A test checks that both press clips over-count without the gate.

On `shoulder_press_cropped_wrists`, the gate is what prevents the false reps. With wrist confidence strictly under 0.3, the old engine didn't over-count either, because the smoother never uses a position under 0.3. So the low-confidence rule isn't what this clip proves.

The partials in the press clips come from the spec: a move past `start_exit` and back that never passes the gate is a partial by definition.

**Injury check:** `squat_clean` with `applyInjuries(squat, ['lower_back'])` (`trunk_lean` ≤ 35, `safety`) flags reps 0, 1, 2, 3 and 5 as `safety`. Rep 4, at 34.95°, passes. With the base spec, it has no `trunk_lean` flags.

## Validation

Run from `apps/mobile`, `npx jest`:

```
Test Suites: 28 passed, 28 total
Tests:       481 passed, 481 total
Snapshots:   0 total
Time:        13.027 s
Ran all test suites.
```

On `main` this was 23 suites and 287 tests (after `npm install`, which `main` needs for `expo-router`). New and changed suites:

- **`rules.test.ts` (26 tests):**
  - view gating: the caller wins, and unknown runs only `any`
  - threshold names
  - every `op` and every `reduce`
  - all four `duration_ms` phases, a bottom pause, and the fallback
  - the under-half-coverage skip
  - the `mid_` majority, including a tie
  - `rep_index`
  - tint order
  - a generated `physio_limit` rule
  - holding until `set_ended`, ignoring events after it, and reset
  - aggregates and the top rule
  - placeholders and `extra_notes`
- **`view.test.ts` (8 tests):** the ratio geometry, the one-sided frame, unknown, and every fixture's reps detecting their view.
- **`useFormRules.test.ts` (4 tests):** the tint holds until the next rep starts, with no re-render on `rep_counted` / `partial`; the summary and `onSetFlags` on set end clear the tint; the caller's view is used and a view change rebuilds the rules; no spec ignores events.
- **`overrides.test.ts` (68 tests):**
  - the port, and every conservative case on synthetic overrides
  - **parity:** all 5 specs × 7 injury combinations through `applyInjuries`, plus `applyOverride` × 3 injuries, run through `specs/validate.mjs` in a `node` child process and compared with the TS output (50 cases)
- **`fixtures.test.ts` (72 tests):** 16 clips. The expected flags match per clip, there's the `lower_back` injury case, and the press clips over-count without the gate.
- **`repCounter.test.ts` (39) / `engine.test.ts` (83) / `angles.test.ts` (47):**
  - `lost` vs `absent`: a person present, none present, a mixed gap decided by majority, and a tie going to `absent`
  - `imageAspect`: the default, the option, and mid-set changes
  - the gate: blocks, passes, and blocks on a null metric
  - primary confidence: held or low-confidence joints
  - jump rejection: a spike, 3 rejections in a row, no reference after a null, reset, and a 400°/s rep accepted
  - still end in `outbound` and in `start`: jitter within the band doesn't reset it, a 12° move does, nothing before the first rep, and transitions don't reset it
- **`orderLabel.test.ts` (1):** the hand-written ordinals match `Intl.PluralRules` for 1–200.

`npx tsc --noEmit -p .`: no errors (0 on `main` after `npm install`).

`npx expo lint`: 13 problems (5 errors, 8 warnings), the same as `main`. They're all in the existing `useFormEngine.ts`, `usePoseOutput.ts`, `PoseDebugScreen.tsx` and older tests' `require()` calls. None are in files added here.

From the repo root, `node --test specs/*.test.mjs`:

```
ℹ tests 62
ℹ pass 62
ℹ fail 0
```

(38 on `main`. The 24 new ones cover `applyInjuries`, the combination order check and the primary gate.)

`node specs/validate.mjs`:

```
✓ bicep_curl.json
✓ lunge.json
✓ push_up.json
✓ shoulder_press.json
✓ squat.json
```

## Not checked

- **Device testing covered the shoulder press only,** seated, on the debug screen. The other four exercises have run only on synthetic clips. `useFormRules` is wired into the debug screen alone; INT-02 wires it into the live screen.
- **One recorded clip, and it didn't make it in.** It came through pasted into chat and was cut off after about 5 s, so it isn't a fixture. The device fixes were checked with a screen recording, synthetic clips that reproduce it, and on-phone testing.
- **The jump limit (720°/s) and the confidence rule aren't proven on real data.** No synthetic clip shows the confidence rule changing a count (see Test clips). Very fast real reps haven't been checked against the jump limit.
- **View detection is tuned on synthetic figures only.** The front bound (0.4) sits about 0.03 under a 30° turn (0.43–0.44). A real lifter turned a little further, or one whose hips read narrower than the stick figure's, may come out `unknown`, which skips front-only rules. Recorded clips (INT-09) should settle the bounds.
- **Flags come from synthetic clips.** Every flag in the table above comes from a synthetic clip. Several values sit on the threshold and come down to one frame or a fraction of a degree:
  - tempo at exactly 800 ms passes
  - push-up depth 90.18° flags
  - squat depth 94.87° passes
- **The parity test needs `node` on the Jest host.** It uses `process.execPath`, so it runs anywhere Jest runs, but it's slower than a normal unit test (one child process for all 50 cases).

## Known limits

- **Tempo on fast synthetic reps.** Most synthetic reps flag `tempo`, because a 1 s movement is fast by the spec's standard. That's correct for the clips, but it means the clean clips aren't clean, so INT-06's medal tests will need clips with about 2 s descents for an all-clean case.
- **A front-view squat needs a slight turn.** Square-on, the 2D knee angle doesn't change, so no reps are counted at all. That's an engine limit, not a rules one. The setup screen should suggest side-on (`recommended_view`) or a three-quarter angle for knee tracking.
- **The tint arrives as the rep settles,** not during the descent. It shows about 0.2–0.5 s after the count and stays until the next rep starts.
- **The fixtures total 3.0 MB** (16 clips), above AI-06's target of about 2 MB.
- **Camera placement matters.** A phone low and tilted up makes vertical lines lean in, which inflates `wrist_stack` and trunk readings. The format doc recommends an upright phone at about chest height; a setup screen should say so too.
- **The gate exists for the press only.** Other exercises could have similar rest positions (a curl's arms hanging read like its start, which is harmless). Add a gate to a spec if recorded clips show false reps.

## Also on this branch

These are not part of AI-07:
- **`fix(mobile)` commits:** the launch crash and the Reanimated dependency. Both are broken on `main`, so they could go in a separate PR.
- **`feat(pose)` commits:** the `pose-debug` route and the debug screen changes, for testing on a device. They can be dropped before merge if a dev route isn't wanted.
- **`ios/`** was regenerated locally with `expo prebuild --clean`, so the `spotter://` scheme is registered. It's gitignored, so there's nothing in the diff, but anyone with an old `ios/` folder needs to run prebuild again.

## Not included

- **AI-08:** the set payload. `SetFlags` is what it packages.
- **AI-16:** physio limits (`applyRehabLimits` and the generated `physio_limit` rule). The evaluator already handles any rule in `spec.rules`, and `EffectiveSpec` carries `injuries` and `extra_notes` for it to keep.
- **INT-07:** delivering the user's injuries and specs to the phone. Callers pass the injuries to `applyInjuries` for now.
- **FE-05 / FE-06 / INT-02:** the live screen, the tint drawing and the wiring. `useFormRules` is ready for them.
- **The safety haptic:** `severity: safety` is on every flag, but nothing buzzes. It's off by default (§7) and belongs to the live screen.
