# Form engine design (AI-06)

Issue #46. This is the contract for `apps/mobile/src/engine/`. The types are in `apps/mobile/src/engine/types.ts`, which is the source of truth for shapes. It interprets the AI-05 spec format, `docs/specs/exercise-spec-format.md`, without changing it. Background: root `Architecture.md` §6.1 and §7.

```
PoseResult | null ──▶ JointSmoother ──▶ MetricComputer ──▶ RepCounter ──▶ EngineUpdate + events
                      (oneEuro.ts)       (angles.ts)        (repCounter.ts)   (engine.ts)
```

AI-07 (rules, flags, view gating, `applyOverride`) and AI-08 (set payload) build on `RepRecord`, and FE-05 builds on `useFormEngine`. The engine itself never evaluates rules.

## Modules

| File | Exports |
|---|---|
| `types.ts` | All shared types. |
| `specs.ts` | `EXERCISE_SPECS` and `getSpec(id)`. These are the five bundled JSON specs, imported through Metro `watchFolders`. |
| `oneEuro.ts` | `DEFAULT_ONE_EURO`, `OneEuroFilter`, `JointSmoother` |
| `angles.ts` | `jointAngle`, `segmentTilt`, `widthRatio`, `resolvePoint`, `createMetricComputer` |
| `repCounter.ts` | `createRepCounter(spec.primary_angle.direction, spec.phases)` |
| `engine.ts` | `createFormEngine(spec, options?)` |
| `useFormEngine.ts` | React hook for FE-05 |
| `index.ts` | Barrel |
| `__fixtures__/` | Synthetic clip generator, a fixture loader, and the JSON clips. These sit outside `__tests__` because Jest treats every file under `__tests__` as a test. |

## 1. Smoothing: `oneEuro.ts`

```ts
export const DEFAULT_ONE_EURO: OneEuroParams;
export class OneEuroFilter {
  constructor(params?: Partial<OneEuroParams>);
  filter(value: number, tMs: number): number;
  reset(): void;
}
export class JointSmoother {
  constructor(opts?: { filter?: Partial<OneEuroParams>; minConfidence?: number; holdMs?: number });
  push(joints: Joint[], tMs: number): SmoothedJoints; // 17 in, 17 out
  reset(): void;
}
```

- **The filter:** this is the standard One Euro filter (Casiez et al. 2012). Time is in ms and converted to seconds inside.
  - The first sample passes through unchanged.
  - If `dt <= 0` (a repeated or out-of-order timestamp), it returns the previous output and keeps its state unchanged.
- **One filter each for x and y on every joint**, so 34 filters. Positions are filtered in normalized coordinates.
- **Defaults:** `DEFAULT_ONE_EURO` is tuned on the noisy fixtures and the values are recorded in the code. They are configurable through `EngineOptions.filter`. Tests check that:
  - jitter on a still joint drops by at least half
  - the lag on a 1 Hz movement stays under about 60 ms
- **Confidence:**
  - **`c >= minConfidence` (default 0.3):** the joint is filtered. If the joint was missing, or its last good sample is older than `holdMs`, the joint's filters reset first. Smoothing never crosses a gap.
  - **`c < minConfidence`:** if the last good sample is no older than `holdMs` (default 300 ms), the output is the last smoothed x and y with the current raw `c`. Otherwise the output is `null` (missing).
  - **A joint never seen confidently** is `null`.
- **No-person frames** don't reach the smoother. The engine skips `push`, and the hold and reset rules use timestamps, so a gap expires on its own.

## 2. Metrics: `angles.ts`

All geometry runs on aspect-corrected points: `X = x * imageAspect`, `Y = y`. Joints are normalized per axis, so on a 9:16 frame an uncorrected 90° would measure wrong. `imageAspect` is the upright width ÷ height, and defaults to 9/16.

```ts
export function jointAngle(a: Vec, vertex: Vec, c: Vec): number | null; // interior angle, 0–180°; null if a segment has zero length
export function segmentTilt(from: Vec, to: Vec): number | null;         // unsigned angle of from→to vs image-up (−Y), 0–180°
export function widthRatio(a: Vec, b: Vec, c: Vec, d: Vec, minDen: number): number | null; // |Xa−Xb| / |Xc−Xd|, null if denominator < minDen
export function resolvePoint(point: Point, side: 'left' | 'right', joints: SmoothedJoints): Joint | null;
export function createMetricComputer(spec: ExerciseSpec, opts?: {
  imageAspect?: number; sideMargin?: number; minRatioDenominator?: number;
}): MetricComputer;
interface MetricComputer {
  compute(joints: SmoothedJoints): { metrics: Metrics; sides: MetricSides };
  setLocked(locked: boolean): void; // engine: lock from rep_started to rep_closed/partial
  reset(): void;
}
```

`Vec` is `{ x, y }`. The geometry helpers take points that are already aspect-corrected; only `createMetricComputer` applies `imageAspect`. `minDen` for `widthRatio` is compared in aspect-corrected units. `width_ratio` is a ratio of x-distances, so the aspect cancels out, but the threshold still applies in those units.

**Points:**
- **COCO name:** that joint.
- **Unsided base** (`knee`): `left_knee` or `right_knee`, depending on which side is being evaluated.
- **`mid_<base>`:** the average of left and right (x, y and `c`) when both are present, otherwise whichever one is present, otherwise `null`. Side views often lose the far joint, and the two sides nearly overlap there anyway.
- **`nose`:** that joint.

**Side modes** apply to `joint_angle` and `segment_tilt` when the metric has at least one unsided point. A metric whose points are all sided, `mid_` or `nose` has no side choice, and its `sides` entry is `'both'`. `width_ratio` is also always `'both'`. The default mode is `most_visible`.

| Mode | Value | `sides[name]` |
|---|---|---|
| `left` / `right` | That side's value; null if missing | that side |
| `both_avg` | Mean of the sides that are present | `'both'` when both are present, else the one used |
| `min` / `max` | Smaller or larger of the sides present | the side chosen |
| `most_visible` | The value from the sticky chosen side (below) | that side |

**`most_visible` is sticky and is tracked per metric:**
- **Visibility:** a side's visibility is the mean raw `c` over that side's resolved points. A missing point counts as 0.
- **First choice:** the side with the higher visibility. Ties go to `left`.
- **Unlocked:** it switches only when the other side's visibility is at least `sideMargin` (default 0.1) above the current side's.
- **Locked** (during a rep): it keeps the current side.
- **Fallback, locked or not:** if the chosen side's value is null and the other side's isn't, it switches to the other side.
- **`reset()`** clears the choice and the lock.

**`sides[name]` is `null` whenever the metric's value is `null`**, in every mode. An unknown point name resolves to `null`, so its metric is always `null`.

## 3. Rep counter: `repCounter.ts`

```ts
export function createRepCounter(direction: Direction, phases: Phases): RepCounter;
interface RepCounter {
  step(t: number, value: number | null): CounterStep; // value = primary angle
  end(t: number, reason: SetEndReason): CounterStep;  // manual end; also used internally
  reset(): void;
}
```

**Definitions:**
- **Direction:** let `s = +1` for `decreasing` and `-1` for `increasing`.
- **Past X:** `deeper(v, X)` means `s * (X - v) > 0`. "Back past X" is `shallower(v, X)`, meaning `s * (v - X) > 0`.
- **Extreme:** the deepest value so far in the attempt.

**Time:**
- **Active time:** the sum of `t - prevT` over consecutive frames where both have a non-null value. Time across null frames, or from a null frame to the next one, doesn't count.
- **`stateMs`:** the active time since entering the current state.
- **Gated transitions:** a transition fires on the first frame where its condition holds and `stateMs >= min_state_ms`. Nothing is queued: if the condition stops holding, the transition doesn't fire.

**Transitions (non-null `value`):**

| From | Condition | To | Effects |
|---|---|---|---|
| `start` | `deeper(v, start_exit)` (gated) | `outbound` | `attempt++`, `rep_started`, `startedAt = t`, `extreme = v`. If a settle tail is open, `rep_closed` for it **first**, and this frame is not in that rep. |
| `outbound` | `deeper(v, count_min)` (gated) | `peak` | `peakAt = t` |
| `outbound` | `shallower(v, start_enter)` (gated) | `start` | `partial`, and the attempt's frames are discarded |
| `peak` | `s * (v - extreme) >= reverse_deg` (back from the extreme, gated) | `return` | `returnAt = t` |
| `return` | `shallower(v, start_enter)` (gated) | `start` | `repCount++`, `rep_counted {index: repCount}`, `countedAt = t`, open the settle tail |

**More rules:**
- **Extreme:** it updates whenever `deeper(v, extreme)` in `outbound`, `peak` or `return`. Going deeper again during `return` doesn't change the state.
- **`stateMs` reset:** entering a state sets `stateMs = 0`, and the frame that entered it adds no time.

**Settle tail.** It runs from the count until the rep closes. Rule windows keep collecting frames as the `return` window.
- **Moved back:** `tailBest` is the shallowest value since the count. If `s * (tailBest - v) >= reverse_deg`, then `rep_closed`, and this frame is **not** in the rep.
- **Hold (no more progress):** the hold restarts (anchor = `tailBest`, hold time 0) whenever `tailBest` has gained at least 1° toward the start since the anchor (`SETTLE_PROGRESS_DEG`). Otherwise the frame's active time is added. When the hold time reaches `min_state_ms`, `rep_closed` fires and this frame **is** in the rep. Restarting on progress rather than on a `reverse_deg` jump keeps a slow lockout (slower than `reverse_deg` per `min_state_ms`) in the window until it stops rising.
- **Next rep starts:** see the `start → outbound` row above. In practice the hold or moved-back always closes the tail first, because `start_exit` needs `min_state_ms` in `start` and sits at least `reverse_deg` deeper than `start_enter` in every bundled spec. The rule is a safety net.
- **Set end:** `rep_closed`, then `set_ended`.
- **Order within a frame:** check the tail first, then the `start_exit` transition.

**Durations** (`RepTiming.durations`):

| Duration | From | To |
|---|---|---|
| `outbound` | `startedAt` | `peakAt` |
| `peak` | `peakAt` | `returnAt` |
| `return` | `returnAt` | `countedAt` |
| `rep` | `startedAt` | `countedAt` |

Times are plain timestamp differences, null gaps included. `closedAt` is the closing frame's `t`.

**Set end.** After `ended`, `step` returns the current state with no events and `window: null`.
- **`still`:** in `start`, with `repCount >= 1`. It keeps an anchor value: if `|v - anchor| > reverse_deg` the anchor becomes `v` and the hold time goes back to 0, otherwise the frame's active time is added. Entering `start` (count or partial) resets it. When the active hold time reaches `set_end_still_ms`, the set ends. The tail always closes first, because `min_state_ms` is much shorter than `set_end_still_ms`.
- **`absent`:** null values continuously for `set_end_still_ms` of wall time (`t - firstNullT`), with `repCount >= 1`.
- **`manual`:** `end(t, 'manual')`.
- **On any end:** an open tail emits `rep_closed`. An attempt still in `outbound`, `peak` or `return` emits `partial`, and the state goes back to `start`. Then `set_ended {reason}` fires.

**Null value:** no transitions, no window, and the tail and still holds don't advance. The only check is `absent`.

**`window`:** this is assigned after the frame's transitions.
- **`outbound`, `peak` or `return`:** the frame goes in that window of the current attempt.
- **`start` with an open tail:** the `return` window of the tail's attempt, except on the frame that closed it by moving back.
- **Otherwise:** null.

## 4. Engine: `engine.ts`

```ts
export function createFormEngine(spec: ExerciseSpec, options?: EngineOptions): FormEngine;
interface FormEngine {
  readonly spec: ExerciseSpec;
  push(pose: PoseResult | null): EngineUpdate; // a null pose has no timestamp: pass pushAbsent instead
  pushAbsent(tMs: number): EngineUpdate;       // no person at tMs
  endSet(tMs: number): EngineUpdate;           // manual set end
  reset(): void;
}
```

**Each frame:**
1. Smooth the joints.
2. Compute the metrics.
3. Step the counter with `metrics[primary_angle.name]`.
4. Buffer `EngineFrame`s per attempt according to `window`. Frames with a null primary angle aren't buffered.

**Events:**
- **Translation:** counter events map to `EngineEvent`s. On `rep_closed`, the attempt's buffers become `RepRecord.windows`, where `rep` is the concatenation in time order.
- **`RepRecord.side`:** `sides[primary]` at the frame where the primary angle reached `extreme`.
- **On `partial`:** the buffers are dropped.

**Side locking:** `MetricComputer.setLocked(true)` on `rep_started`, and `false` on `rep_closed` or `partial`.

## 5. Hook: `useFormEngine.ts`

```ts
export function useFormEngine(spec: ExerciseSpec | null, opts?: EngineOptions & {
  onEvent?: (e: EngineEvent) => void;
}): {
  onPose: (d: PoseDetection) => void; // pass to usePoseOutput
  state: RepState; repCount: number; ended: boolean;
  primary: number | null; primarySide: MetricSide | null; // published at most every 250 ms
  endSet: () => void; reset: () => void;
};
```

- **Lifetime:** one engine per `spec` (and `imageAspect`), rebuilt when either changes.
- **Re-renders:** these happen only when `state`, `repCount` or `ended` change, plus a throttled `primary` for the debug readout.
- **Absent frames:** `PoseDetection` without a `result` becomes `pushAbsent(Date.now())`.

## 6. Fixtures: `__fixtures__/`

```jsonc
{
  "name": "squat_noisy",
  "exercise": "squat",               // spec id
  "source": "synthetic",             // or "recorded"
  "description": "8 reps, σ=0.006 noise, 10–15 fps, two 0.5 s dropouts",
  "image": { "width": 1080, "height": 1920 },   // upright; imageAspect = width / height
  "expected": { "reps": 8, "partials": 0, "set_end": "still" },  // set_end: "still" | "absent" | null
  "frames": [ /* PoseResult, or { "absent": true, "timestamp_ms": n } for no person */ ]
}
```

- **Coordinates:** rounded to 4 decimals, with `c` rounded to 2.
- **Size:** about 2 MB total across all clips.
- **The PoseDebugScreen recorder** writes this same format with `source: "recorded"` and `expected` left for a person to fill in.
- **`load.ts`** exports `loadFixtures(): Fixture[]` (every `*.json` in the folder) and a `Fixture` type.
- **`synth.ts`** is a seeded generator that rebuilds every synthetic clip from 2D stick-figure kinematics in pixel space. It drives the primary joint angle along a known trajectory, so the expected counts hold by construction. A test checks that the committed JSON matches the generator's output. `UPDATE_FIXTURES=1 npx jest` rewrites the files.
