# AI-05: Exercise JSON specs — design

Issue: #45. Architecture: root `Architecture.md` §6 (form engine), §7 (quiet coaching), §18 (rest-note fallback). Joints: `docs/pose/pose-result-contract.md`.

## Goal

One declarative JSON spec per MVP exercise (squat, push-up, bicep curl, shoulder press, lunge). Each spec has:

- the angles to compute
- the rep phases
- the form rules, each with a fixed `rest_note`
- injury overrides for knee, shoulder and lower back

The form engine (AI-06: smoothing, angles, rep state machine) and rule evaluation (AI-07: flags, overrides) interpret these files without per-exercise code. BE-06 loads them into `EXERCISE.form_spec`.

## Files

| Path | What |
|---|---|
| `specs/exercises/<id>.json` | One spec per exercise. `id` matches the filename. |
| `specs/exercises/schema.json` | JSON Schema (draft 2020-12) for the shape. Specs point at it with `"$schema": "./schema.json"`. |
| `specs/banned-phrases.json` | Banned phrases and imperative sentence openers. Shared with the LLM rest-note check (§7, §18). |
| `specs/validate.mjs` | Dependency-free validator: the schema subset used by `schema.json`, plus semantic checks. |
| `specs/validate.test.mjs` | `node --test specs/*.test.mjs`. Every spec passes, and negative cases are rejected. |

Exercise ids: `squat`, `push_up`, `bicep_curl`, `shoulder_press`, `lunge`.

## Spec shape (`spec_version: 1`)

```json
{
  "$schema": "./schema.json",
  "spec_version": 1,
  "id": "squat",
  "name": "Squat",
  "recommended_view": "side",
  "angles": { "<name>": { "type": "...", "...": "..." } },
  "primary_angle": { "name": "knee", "direction": "decreasing" },
  "phases": { "start_exit": 160, "count_min": 135, "target": 95, "start_enter": 165,
              "reverse_deg": 5, "min_state_ms": 150, "set_end_still_ms": 8000 },
  "rules": [ { "...": "..." } ],
  "injury_overrides": { "knee": {}, "shoulder": {}, "lower_back": {} }
}
```

### Points

Wherever a spec names a point, it is one of:

- **A COCO joint name** (`left_knee`, `nose`, …; the 17 in the pose contract), used as is.
- **An unsided base name:** `eye`, `ear`, `shoulder`, `elbow`, `wrist`, `hip`, `knee`, `ankle`. It resolves to `left_<base>` / `right_<base>` according to the metric's `side`.
- **`mid_<base>`:** the midpoint of `left_<base>` and `right_<base>`, e.g. `mid_hip`. A midpoint ignores `side`.

Coordinates are the pose contract's normalized, upright, unmirrored image coordinates. Left and right are anatomical.

### Angles (metrics)

`angles` maps a metric name (snake_case) to one of three types. All angles are in degrees.

| `type` | Fields | Value |
|---|---|---|
| `joint_angle` | `joints: [a, vertex, c]`, `side` | Interior angle at `vertex` between `vertex→a` and `vertex→c`, 0–180. A straight limb is ~180. |
| `segment_tilt` | `from`, `to`, `side` (only needed when a point is unsided) | Unsigned angle between `from→to` and straight up in the image, 0–180. 0 means `to` is directly above `from`. |
| `width_ratio` | `numerator: [a, b]`, `denominator: [c, d]` (COCO names only) | `abs(x_a − x_b) / abs(x_c − x_d)`. Horizontal spans only. |

**`side`** decides how unsided points resolve:

| `side` | Meaning |
|---|---|
| `left`, `right` | That side only |
| `both_avg` | Compute both sides, average them |
| `min`, `max` | Compute both sides, take the smaller / larger value |
| `most_visible` | Use the side whose points have the higher mean confidence `c` |

`side` is required when the metric uses an unsided point. It is optional otherwise.

**Built-in metric `duration_ms`:** the time spent in the rule's `phase` for that rep. It isn't declared in `angles`, and a rule using it has no `reduce`.

### Primary angle and phases

`primary_angle.name` must be a `joint_angle` in `angles`. `direction` is the way the angle moves during the first half of the rep:

- `decreasing`: squat, push-up, curl, lunge (the joint bends)
- `increasing`: shoulder press (the elbow straightens)

**Rep state machine (AI-06).** "Past X" means beyond X in the rep's direction, i.e. below X for `decreasing` and above X for `increasing`.

```
start ──past start_exit──▶ outbound ──past count_min──▶ peak ──reversed by reverse_deg──▶ return ──back past start_enter──▶ start (rep counted)
                              │
                              └──back before start_exit without reaching count_min──▶ start (partial, not counted)
```

| Key | Meaning |
|---|---|
| `start_exit` | Leaving the start position begins a rep (`outbound`). |
| `count_min` | The least range that counts as a rep. Crossing it enters `peak`. |
| `target` | The form goal for full range. **Used only by rules**, never for counting, so a short rep is counted *and* flagged. |
| `start_enter` | Coming back past it counts the rep. Sits beyond `start_exit` for hysteresis. |
| `reverse_deg` | How far the angle must move back from its extreme before `peak` becomes `return`. |
| `min_state_ms` | Minimum time in a state before a transition is accepted. Stops jitter from double counting. |
| `set_end_still_ms` | Time in `start` without movement that ends the set (§6.1: 8 s). |

**Rule windows close when the rep settles, not at the count.** The rep is counted the moment the angle crosses `start_enter`. The frames that rules reduce over for `return` and `rep` keep going until the angle stops moving toward the start position: it moves back by `reverse_deg`, or holds within `reverse_deg` for `min_state_ms`, or the set ends, or the next rep starts. That way a lockout check such as "elbow max on return ≥ 160" with `start_enter` at 155 sees the top of the movement. `duration_ms` for `return` still stops at the `start_enter` crossing, so tempo isn't inflated by the pause at the top.

Required ordering:

- **`decreasing`:** `target ≤ count_min < start_exit < start_enter`
- **`increasing`:** `target ≥ count_min > start_exit > start_enter`

The validator checks the ordering both for the base spec and for the result of applying each injury override.

### Rules

```json
{
  "id": "depth",
  "phase": "peak",
  "view": "any",
  "check": { "metric": "knee", "reduce": "min", "op": "<=", "value": "target" },
  "severity": "form",
  "priority": 1,
  "label": "partial_range",
  "joints": ["left_hip", "right_hip", "left_knee", "right_knee"],
  "rest_note": "Next set, try lowering until your hips are level with your knees."
}
```

| Field | Meaning |
|---|---|
| `id` | snake_case, unique in the spec. Stored as `FORM_FLAG.rule_id`. |
| `phase` | The window the check reduces over: `outbound`, `peak`, `return`, or `rep` (the whole rep, `outbound` through `return`). |
| `view` | `front`, `side` or `any`. AI-07 skips the rule when the detected camera view doesn't match. Detecting the view is AI-06/07's job. |
| `check.metric` | A key of `angles`, or `duration_ms`. |
| `check.reduce` | `min`, `max`, `mean`, `first` or `last` over the phase's frames. Omitted for `duration_ms`. |
| `check.op` | `<=`, `>=`, `<`, `>`. |
| `check.value` | A number, or one of the threshold keys `start_exit`, `count_min`, `target`, `start_enter`, so injury overrides to phases carry through to rules. |
| `severity` | `form` or `safety`. Only `safety` may trigger the optional haptic (§7). |
| `priority` | Integer ≥ 1, unique within the spec. 1 is most important. The rest note shows only the top-priority flagged rule (§7). |
| `label` | Form-model label (§6.3), used for dataset labelling. One of the labels below. |
| `joints` | COCO joint names that FE-06 tints amber when the rule flags. At least one. |
| `rest_note` | The fixed note shown during rest when the LLM note fails the banned-phrase check. |

**The rule passes when the check holds.** Otherwise that rep gets a flag `{ rule_id, severity, rep_index }`, held until the set ends (AI-07).

**Labels:** `partial_range`, `knees_in`, `forward_lean`, `fast_lowering`, `hip_sag`, `incomplete_lockout`, `elbow_drift`, `torso_swing`, `back_arch`, `wrists_off_stack`. A clean rep is `clean`, which is not a rule label.

**Placeholders in `rest_note`:**

| Placeholder | Meaning |
|---|---|
| `{n}` | Number of reps that raised this rule's flag |
| `{total}` | Reps in the set |
| `{value}` | Mean of the reduced metric over the flagged reps, rounded (degrees or ratio) |
| `{t}` | `{value}` in seconds, one decimal. Allowed only when `metric` is `duration_ms`. |

### Injury overrides

`injury_overrides` must have exactly `knee`, `shoulder` and `lower_back`, matching `INJURY.body_part`. Each one has:

```json
{
  "phases": { "target": 110 },
  "rules": { "tempo": { "value": 1200 }, "trunk_lean": { "severity": "safety" } },
  "disable_rules": [],
  "extra_note": "The range here is set shorter to suit a knee that's still recovering."
}
```

| Field | Meaning |
|---|---|
| `phases` | Optional. A partial patch of `phases`, merged over the base. |
| `rules` | Optional. Map of rule id → patch of `value`, `severity` and/or `rest_note`. The patch replaces `check.value`. |
| `disable_rules` | Optional. Rule ids to skip for this injury. |
| `extra_note` | Required. Shown alongside rest notes for users with this injury. Same tone rules as `rest_note`, and no placeholders. |

**Several injuries (AI-07):** apply the overrides in the order `knee`, `shoulder`, `lower_back`. For a numeric value, keep the more conservative one: whichever is less far past `start_exit` in the rep's direction for `target`/`count_min`, and the stricter bound for rule values. Specs only define single-injury overrides.

Overrides lower demands or tighten safety limits. SteadyForum never diagnoses or prescribes. A physio's own limits (`REHAB_LIMIT`) are applied by AI-07 on top and are out of scope here.

## Tone rules (validator-enforced)

Applies to every `rest_note` (base and override patches) and every `extra_note`. Notes describe the movement, never the person, and never give commands (§7).

- **Banned phrases:** no phrase from `specs/banned-phrases.json` `phrases`. Matching is case-insensitive and on word boundaries, and `’` is normalized to `'`.
- **No imperative opener:** no sentence may start with a word from `imperative_openers`. "Next set, try lowering…" passes, because the sentence starts with "Next". "Lower slowly." fails.
- **No exclamation marks.**
- **Placeholders:** only the ones listed above.
- **Gerunds are fine:** "Keeping your chest a little taller makes this easier on your back."
- **Pain:** any mention of pain or discomfort routes to the physio, phrased descriptively, e.g. "Any pain here is worth raising with your physio or a doctor."

## Starting thresholds per exercise

These are starting values, not tuned on recorded clips. Each spec's rules:

| Spec | View | Primary | Rules (id: metric, label) |
|---|---|---|---|
| `squat` | side | knee `hip-knee-ankle`, most_visible, decreasing | `depth`: knee ≤ target, partial_range · `knee_tracking` (front): knee/ankle width ≥ 0.9, knees_in · `trunk_lean` (side): trunk tilt ≤ 45, forward_lean · `tempo`: outbound ≥ 800 ms, fast_lowering |
| `push_up` | side | elbow `shoulder-elbow-wrist`, most_visible, decreasing | `depth`: elbow ≤ target, partial_range · `hip_sag` (side): `shoulder-hip-ankle` min ≥ 160, hip_sag · `lockout`: elbow max on return ≥ 160, incomplete_lockout · `tempo`: outbound ≥ 800 ms, fast_lowering |
| `bicep_curl` | side | elbow, most_visible, decreasing | `range`: elbow ≤ target, partial_range · `elbow_drift`: `hip-shoulder-elbow` max ≤ ~25, elbow_drift · `torso_swing` (side): trunk tilt max ≤ ~10, torso_swing · `tempo`: **return** ≥ 800 ms (lowering is the return half), fast_lowering |
| `shoulder_press` | front | elbow, most_visible, increasing | `lockout`: elbow max ≥ target, incomplete_lockout · `back_arch` (side): trunk tilt max ≤ ~15, back_arch, safety · `wrist_stack` (front): forearm tilt `elbow→wrist` max ≤ ~20, wrists_off_stack · `tempo`: return ≥ 800 ms, fast_lowering |
| `lunge` | side | knee, side `min` (the front, more-bent knee), decreasing | `depth`: knee ≤ target, partial_range · `trunk_lean` (side): trunk tilt ≤ ~20, forward_lean · `tempo`: outbound ≥ 800 ms, fast_lowering |

Overrides: each of the three injuries is present in every spec. Where an injury barely affects an exercise (knee for curl and press), the override is an `extra_note` plus at most a gentler tempo.

## Out of scope

- The engine itself (AI-06), rule evaluation and flag storage (AI-07), and the spec endpoint (BE-06).
- Camera-view detection.
- Tuning thresholds on recorded clips.
- Physio-entered `REHAB_LIMIT` values.
