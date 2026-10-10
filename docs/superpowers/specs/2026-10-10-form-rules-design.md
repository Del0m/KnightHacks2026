# Form rules design (AI-07)

Issue #47. This is the contract for the form rules in `apps/mobile/src/engine/`. Shapes are in `apps/mobile/src/engine/types.ts` (the "Form rules" section and `EffectiveSpec`), which is the source of truth. It builds on the AI-06 engine ([form engine design](2026-10-10-form-engine-design.md)) and reads the AI-05 spec format ([exercise spec format](../../specs/exercise-spec-format.md)). Background: root `Architecture.md` §6 and §7.

```
ExerciseSpec ──applyInjuries──▶ EffectiveSpec ──(AI-16: applyRehabLimits)──▶ effective spec
                                                                                │
engine events ── rep_closed {rep} ──▶ evaluateRep ──▶ RepResult (flags, tint) ──┤
              ── set_ended {reason} ─────────────────────────────────────────────▶ SetFlags (held flags, aggregates)
```

The engine never evaluates rules. Rules never change engine state.

## Modules

| File | Exports |
|---|---|
| `overrides.ts` | `INJURY_ORDER`, `applyOverride(spec, injury)`, `applyInjuries(spec, injuries)` |
| `view.ts` | `FRONT_MIN_RATIO`, `SIDE_MAX_RATIO`, `viewRatio(frame, imageAspect)`, `detectView(frames, imageAspect)` |
| `rules.ts` | `NEAR_EXTREME_DEG`, `MIN_COVERAGE`, `phaseDuration`, `evaluateRule`, `evaluateRep`, `createSetRules`, `summarizeSet`, `formatValue`, `fillRestNote`, `restNote` |
| `useFormRules.ts` | React hook for INT-02 / FE-06 |

## 1. Injury overrides: `overrides.ts`

```ts
export const INJURY_ORDER: readonly Injury[]; // ['knee', 'shoulder', 'lower_back']
export function applyOverride(spec: ExerciseSpec, injury: Injury): ExerciseSpec;
export function applyInjuries(spec: ExerciseSpec, injuries: readonly Injury[]): EffectiveSpec;
```

- **`applyOverride`** is a line-for-line port of `applyOverride` in `specs/validate.mjs`: phases shallow-merged, `disable_rules` filtered out, rule patches merged with `value` going into `check.value`.
- **`applyInjuries`** dedupes `injuries`, sorts them into `INJURY_ORDER`, and folds the overrides in that order onto the base spec. It returns `{ ...spec, phases, rules, injuries, extra_notes }`.
  - With no injuries, it's the base spec plus `injuries: []` and `extra_notes: []`.
  - With one injury, `phases` and `rules` equal `applyOverride(spec, injury)`.
- **More than one injury: the more conservative value wins.** Fold the overrides in order. When a later override sets something an earlier override already set:
  - **`count_min` and `target`:** keep the one that asks for less range. For `decreasing` that's the larger number, for `increasing` the smaller.
  - **Other phase keys:** the later override wins.
  - **A rule's `value`:** if both are numbers, keep the stricter bound for the rule's `op` (the larger for `>=` and `>`, the smaller for `<=` and `<`). If either is a threshold name, the later override wins.
  - **`severity`:** `safety` if any override says `safety`.
  - **`rest_note`:** the note from the override whose `value` won, if it has one. Otherwise the latest override that sets a note, even if its value lost. On equal numeric values the later override counts as the winner.
  - **`disable_rules`:** the union.
  - **`extra_notes`:** every applied override's `extra_note`, in order.
- **One merge:** `specs/validate.mjs` exports the same `applyInjuries`, and the spec validator checks threshold order for every non-empty injury subset. A Jest parity test runs all 5 specs × 7 non-empty subsets (and `applyOverride` × 3) through both, with `node` as a child process for the `.mjs` side, and compares the JSON.
- AI-16's `applyRehabLimits` runs after this and keeps `injuries` and `extra_notes`.

## 2. View detection: `view.ts`

```ts
export const FRONT_MIN_RATIO: number; // 0.4
export const SIDE_MAX_RATIO: number;  // 0.25
export function viewRatio(frame: EngineFrame, imageAspect: number): number | null;
export function detectView(frames: EngineFrame[], imageAspect: number): DetectedView;
```

- **Per frame**, with `X = x * imageAspect` and `Y = y`, taken from `frame.joints`:
  - **All four of `left_shoulder`, `right_shoulder`, `left_hip`, `right_hip` present:** ratio = (|ΔX shoulders| + |ΔX hips|) / (2 × torso), where torso is the distance between the shoulder midpoint and the hip midpoint. Null if torso < 1e-6.
  - **One side's shoulder and hip both present, and the other side's both missing:** ratio 0. The far side being hidden is itself a sign of a side view.
  - **Otherwise:** null.
- **Per rep:** the median of the non-null ratios over `rep.windows.rep`. Fewer than 3 non-null frames gives `unknown`.
  - Median ≥ `FRONT_MIN_RATIO` (0.4) is `front`.
  - Median ≤ `SIDE_MAX_RATIO` (0.25) is `side`.
  - Anything in between is `unknown`.
- **Measured on the fixtures (per-rep medians):** side clips 0.023–0.034, front clips 0.529–0.538. A square-on torso only reaches about 0.55, because the hip keypoints sit well inside the shoulders, so the front bound is 0.4 to allow a slight turn.

## 3. Evaluating a rep: `rules.ts`

```ts
export const NEAR_EXTREME_DEG = 1;
export const MIN_COVERAGE = 0.5;
export function phaseDuration(spec: ExerciseSpec, rep: RepRecord, phase: RulePhase): number;
export function evaluateRule(spec: ExerciseSpec, rule: Rule, rep: RepRecord, view: DetectedView): RuleOutcome;
export function evaluateRep(spec: ExerciseSpec, rep: RepRecord, opts?: { view?: View }): RepResult;
```

`spec` is the effective spec. Any `Rule` in `spec.rules` is evaluated the same way, including generated ones such as AI-16's `physio_limit`.

**Order for each rule:**
1. **View:** a rule with `view` other than `any` gets `skipped_view` unless the rep's view equals it. An `unknown` view runs only `any` rules.
2. **Threshold:** a threshold-name `value` resolves against `spec.phases`, which already has the overrides applied. That gives `threshold`.
3. **Value:**
   - **`duration_ms`:** `phaseDuration(spec, rep, rule.phase)`. Never unmeasured.
   - **Any other metric:** see "Reducing a window" below. It may come out `unmeasured`.
4. **Status:** `pass` when `value op threshold` holds, otherwise `flag`. No tolerance.

**`duration_ms` (`phaseDuration`).** The engine's `durations.outbound` ends at `count_min`, which is only part of the way down, so AI-07 measures phase time from the frames instead. `rep.durations` is left as it is.
- Let `p` be `metrics[spec.primary_angle.name]` on each frame of `rep.windows.rep` with `t <= rep.countedAt`.
- **`firstNear`:** the first such frame with `|p − rep.extreme| <= NEAR_EXTREME_DEG`.
- **`lastNear`:** the last such frame with `|p − rep.extreme| <= NEAR_EXTREME_DEG`.

| `phase` | Duration |
|---|---|
| `outbound` | `firstNear.t − rep.startedAt`: the way out, up to reaching the extreme |
| `peak` | `lastNear.t − firstNear.t`: the time spent at the extreme |
| `return` | `rep.countedAt − lastNear.t`: the way back, up to the count |
| `rep` | `rep.countedAt − rep.startedAt` (= `durations.rep`) |

These add up to the rep. A pause at the bottom isn't counted as lowering. If no frame qualifies (it shouldn't happen), fall back to `rep.durations[phase]`.

**Reducing a window** (any metric other than `duration_ms`):
1. **Window:** `frames = rep.windows[rule.phase]`. Take `valid`, the frames where `metrics[metric]` is not null.
2. **Coverage:** if `valid.length === 0` or `valid.length < MIN_COVERAGE × frames.length`, the outcome is `unmeasured` with `value: null`.
3. **`mid_` basis:** this applies only when the metric's angle spec uses `mid_` points (`joints`, or `from`/`to`).
   - A frame is two-sided when, for every `mid_<base>` the metric uses, both `left_<base>` and `right_<base>` are non-null in `frame.joints` (index by `JOINT_NAMES`).
   - Keep the two-sided frames if there are at least as many as one-sided ones, otherwise keep the one-sided frames.
4. **Reduce** in time order: `min`, `max`, `mean`, `first` or `last`. A missing `reduce` on a non-duration metric is treated as `mean`.

**The result (`evaluateRep`):**
- **View:** `opts.view` if given (`view_source: 'caller'`), else `detectView(rep.windows.rep, rep.imageAspect)` (`'detected'`).
- **`rep_index`:** `rep.index − 1`. The engine counts from 1 to match the screen; flags count from 0 (INT-01).
- **`flags`:** one `Flag` per `flag` outcome, in `spec.rules` order.
- **`outcomes`:** every rule, in `spec.rules` order.
- **`tint_joints`:** the union of the flagged rules' `joints`, in first-seen order.

## 4. The set: holding flags until it ends

```ts
export type RulesEvent =
  | { type: 'rep_evaluated'; result: RepResult }
  | { type: 'set_flags'; set: SetFlags };
export interface SetRules {
  /** Feed every engine event. Returns what it produced, or null. */
  handle(e: EngineEvent): RulesEvent | null;
  /** Null until `set_ended`. */
  summary(): SetFlags | null;
  reset(): void;
}
export function createSetRules(spec: ExerciseSpec | EffectiveSpec, opts?: { view?: View }): SetRules;
export function summarizeSet(spec: ExerciseSpec | EffectiveSpec, reps: RepResult[], reason: SetEndReason): SetFlags;
```

- **On `rep_closed`:** evaluate the rep, keep the result, and return `rep_evaluated`. Its `tint_joints` drive the silent amber tint. Nothing else is surfaced during the set (§7).
- **On `set_ended`:** build `SetFlags` and return `set_flags`. Events after that are ignored until `reset()`.
- **Other events:** return null.

**`SetFlags`:**
- **Counts:** `total_reps` is the number of evaluated reps, and `clean_reps` the ones with no flags. A partial is not a rep and has no flags.
- **`flags`:** in rep order, then rule order.
- **`rules`:** one `RuleAggregate` per rule.
  - `n`: reps flagged.
  - `evaluated`: reps that passed or flagged.
  - `mean_value`: mean value over the flagged reps, or null when `n` is 0.
- **`top`:** the aggregate with `n > 0` and the lowest `priority`, or null.
- **`extra_notes`:** `spec.extra_notes`, or `[]` for a plain `ExerciseSpec`.

## 5. Rest-note placeholders

```ts
export function formatValue(v: number): string;
export function fillRestNote(note: string, agg: RuleAggregate, totalReps: number): string;
export function restNote(spec: ExerciseSpec | EffectiveSpec, set: SetFlags): string | null;
```

- **Placeholders:**
  - `{n}`: `agg.n`
  - `{total}`: `totalReps`
  - `{value}`: `formatValue(agg.mean_value)`
  - `{t}`: `agg.mean_value / 1000` to 0.1, with a trailing `.0` dropped (`"0.8"`, `"1"`)
- **`formatValue`:** if |v| ≥ 10, round to an integer. Otherwise up to 2 decimals, with trailing zeros dropped.
- **`restNote`:** the `top` rule's `rest_note`, filled, then `set.extra_notes`, joined with single spaces. Null when `top` is null. This is the phone's fixed fallback; BE-07 and AI-11 may rephrase it from the same `SetFlags`.

## 6. Hook: `useFormRules.ts`

```ts
export function useFormRules(spec: ExerciseSpec | EffectiveSpec | null, opts?: {
  view?: View;
  onSetFlags?: (s: SetFlags) => void;
}): {
  onEvent: (e: EngineEvent) => void; // chain from useFormEngine's onEvent
  tintJoints: string[];              // last closed rep's flagged joints; [] after rep_started / set_ended / reset
  lastRep: RepResult | null;
  summary: SetFlags | null;          // set once set_ended arrives
  reset: () => void;                 // call with the engine's reset for a new set
};
```

- **Lifetime:** one `SetRules` per `spec` and `view`, rebuilt when either changes. `onSetFlags` is read through a ref.
- **Re-renders:** only when `tintJoints`, `lastRep` or `summary` change.

## 7. Engine changes (AI-06 follow-ups)

- **`lost` set end:** the counter's `step(t, value, person = true)` takes a third argument, and `engine.pushAbsent` passes `false`.
  - During a null run, the counter counts null frames and null frames with a person.
  - When the run reaches `set_end_still_ms`, the reason is `lost` if strictly more than half of those frames had a person, otherwise `absent`.
  - `Clip.expected.set_end` accepts `'lost'`.
- **`RepRecord.imageAspect`:** the engine's current upright aspect when the rep closed. It's `options.imageAspect`, updated by `setImageAspect`, and defaults to 9/16 the same way `angles.ts` does.

## 8. Fixtures

- **`Clip.expected.flags?`** is `{ rule_id: string; rep_index: number }[]`: the complete list for the clip, with base spec, no injuries and the view detected.
- **A fixture test** runs every clip with `expected.flags` through the engine and `createSetRules`, and compares the sorted flags.
- **The synthetic squat lean is lowered** so the clean squat clips pass `trunk_lean`. Rep counts don't change.
- **Off-form clips** are added so every rule type has a firing fixture:
  - a squat with shallow and leaning reps (side view)
  - a squat with knees in, filmed 30° off square-on. Square-on, the 2D knee angle stays at 180° and no reps count, so a front-view squat needs a slight turn. Squat and lunge `depth` are `view: side`, because the turned knee angle reads shallow.
  - a push-up with hip sag

## 9. Counting only real movement (follow-up from device testing)

A screen recording of a seated shoulder press showed three problems:
- **False reps.** With hands in the lap the elbow reads about 131°, which is already mid-rep, and arms hanging straight read like a lockout. Shifting in the chair, or wrists cropped at the frame edge, counted reps.
- **No still end.** Stillness was only checked in `start`, so a set resting mid-position never ended.
- **`wrist_stack` failed every rep,** because it reduced over the whole rep, including the lift from the lap.

**Primary gate (spec format):**
- `primary_angle.gate?: { metric, op, value }` (`PrimaryGate` in `types.ts`).
  - `metric` is an `angles` key. It can't be `duration_ms` or the primary itself.
  - `value` is a number.
- The engine evaluates the gate every frame from that frame's metrics: it passes if the metric is non-null and `metric op value` holds. With no gate, it always passes.
- The counter's `outbound → peak` transition needs the gate to pass on that frame, as well as `count_min` and `min_state_ms`. An attempt that never passes the gate returns to `start` as a partial, as before.
- `RepCounter.step(t, value, person = true, gate = true)`.
- **Shoulder press:**
  - New angle `arm_raise`: `segment_tilt` from `shoulder` to `wrist`, `side: "max"`, so the lower arm decides. 0° is the wrist straight above the shoulder.
  - Gate `{ "metric": "arm_raise", "op": "<=", "value": 60 }`.
  - `wrist_stack` moves to `phase: "peak"`, with value 35 (loosened from 30 after device testing). `target` (the lockout) is 150 and `tempo` 600 ms.
- **Validator:** checks that the gate metric exists and isn't `duration_ms` or the primary.

**Primary angle reliability (engine):**
- **Confidence:** the primary angle is null on a frame when any point it resolves (on the chosen side) has raw `c < minConfidence`, meaning it's held or missing. The 300 ms hold still feeds the other metrics. The engine passes `minConfidence` to the metric computer.
- **Jump rejection:** a primary value is rejected (treated as null for the counter and left out of the windows) when `|v − last| / max(t − lastT, 33) × 1000 > MAX_PRIMARY_DEG_PER_S` (720).
  - `last` and `lastT` are the last accepted value and its time.
  - After 3 rejections in a row, the next value is accepted and becomes the reference.
  - After a null frame there's no reference, and the next value is accepted.

**Still end anywhere (counter):**
- With `repCount >= 1`, the still hold runs in every state, not only `start`.
- It keeps an anchor: if `|v − anchor| > STILL_BAND_DEG` (10), the anchor moves to `v` and the hold resets. Otherwise, the frame's active time is added.
- When the hold reaches `set_end_still_ms`, the set ends `still`. An open tail closes first; an attempt in progress becomes a partial (the existing set-end behaviour).
- State transitions no longer reset the hold. Only movement does.
