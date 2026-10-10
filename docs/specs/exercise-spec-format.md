# Exercise spec format

Each exercise is one JSON file in `specs/exercises/`. The form engine (`apps/mobile/src/engine/`, AI-06 and AI-07) interprets these files, so adding an exercise needs no code. The API serves them as `EXERCISE.form_spec` (BE-06). Background: root `Architecture.md` §6 and §7.

| File | What |
|---|---|
| `specs/exercises/<id>.json` | One spec. `id` matches the file name. MVP: `squat`, `push_up`, `bicep_curl`, `shoulder_press`, `lunge`. |
| `specs/exercises/schema.json` | JSON Schema for the shape. Specs reference it with `"$schema": "./schema.json"`, so editors autocomplete. |
| `specs/banned-phrases.json` | Banned phrases and imperative sentence openers. The LLM rest-note check uses the same list. |
| `specs/validate.mjs` | `node specs/validate.mjs` validates every spec. No dependencies. |
| `specs/validate.test.mjs` | `node --test specs/*.test.mjs` |

`specs/exercises/squat.json` is the reference spec to copy from.

## Top level

| Key | Meaning |
|---|---|
| `spec_version` | `1` |
| `id`, `name` | snake_case id, display name |
| `recommended_view` | `front` or `side`: the camera angle the setup screen suggests |
| `angles` | The metrics to compute each frame (below) |
| `primary_angle` | `{ name, direction }`: the `joint_angle` that drives the rep counter |
| `phases` | Rep counter thresholds (below) |
| `rules` | Form rules (below) |
| `injury_overrides` | `knee`, `shoulder`, `lower_back` (below) |

## Points

A point is one of three things:

- **A COCO joint name** from the [pose contract](../pose/pose-result-contract.md), such as `left_knee`.
- **An unsided base name** (`eye`, `ear`, `shoulder`, `elbow`, `wrist`, `hip`, `knee`, `ankle`), resolved by the metric's `side`.
- **`mid_<base>`**, the midpoint of the left and right joints.

Coordinates are the contract's normalized, upright, unmirrored image coordinates, and left and right are anatomical.

## Angles

All values are in degrees, except the ratio.

| `type` | Fields | Value |
|---|---|---|
| `joint_angle` | `joints: [a, vertex, c]`, `side` | Interior angle at `vertex`, 0–180. A straight limb is about 180. |
| `segment_tilt` | `from`, `to`, `side` (only when a point is unsided) | Unsigned angle between `from→to` and straight up in the image, 0–180. 0 means `to` is directly above `from`. |
| `width_ratio` | `numerator: [a, b]`, `denominator: [c, d]`, COCO names | `abs(x_a − x_b) / abs(x_c − x_d)` |

`side` is one of:

- `left` or `right`: that side only.
- `both_avg`: the mean of the two sides.
- `min` or `max`: the smaller or larger of the two.
- `most_visible`: the side whose points have the higher mean confidence.

`duration_ms` is a built-in metric: the time the rep spent in the rule's phase.

## Phases and the rep counter

`direction` is how the primary angle moves in the first half of the rep:

- `decreasing`: the joint bends (squat, push-up, curl, lunge).
- `increasing`: it straightens (shoulder press).

"Past X" means beyond X in that direction.

```
start ──past start_exit──▶ outbound ──past count_min──▶ peak ──back by reverse_deg──▶ return ──back past start_enter──▶ start (rep counted)
                              └──back before reaching count_min──▶ start (partial, not counted)
```

| Key | Meaning |
|---|---|
| `start_exit` | Leaving the start position begins a rep |
| `count_min` | The least range that counts as a rep |
| `target` | Full-range goal. **Used only by rules**, so a short rep is counted and flagged |
| `start_enter` | Coming back past it counts the rep. Sits beyond `start_exit` (hysteresis) |
| `reverse_deg` | How far the angle moves back from its extreme before `peak` becomes `return` |
| `min_state_ms` | Minimum time in a state before a transition |
| `set_end_still_ms` | Stillness in `start` that ends the set |

**Rule windows close when the rep settles, not at the count.** The rep is counted the moment the angle crosses `start_enter`. The frames that rules reduce over for `return` and `rep` keep going until the angle stops moving toward the start position: it moves back by `reverse_deg`, or holds within `reverse_deg` for `min_state_ms`, or the set ends, or the next rep starts. That way a lockout check such as "elbow max on return ≥ 160" with `start_enter` at 155 sees the top of the movement. `duration_ms` for `return` still stops at the `start_enter` crossing, so tempo isn't inflated by the pause at the top.

Required order:

- **`decreasing`:** `target ≤ count_min < start_exit < start_enter`
- **`increasing`:** the reverse

## Rules

| Field | Meaning |
|---|---|
| `id` | Unique snake_case. Stored as `FORM_FLAG.rule_id`. |
| `phase` | `outbound`, `peak`, `return`, or `rep` (whole rep): the frames the check reduces over |
| `view` | `front`, `side` or `any`. The rule is skipped when the detected camera view differs. |
| `check` | `{ metric, reduce, op, value }`. `reduce` is `min`, `max`, `mean`, `first` or `last`, and is omitted for `duration_ms`. `op` is `<=`, `>=`, `<` or `>`. `value` is a number or a threshold name (`start_exit`, `count_min`, `target`, `start_enter`). |
| `severity` | `form` or `safety`. Only `safety` may use the optional haptic. |
| `priority` | Unique integer, where 1 is most important. The rest note covers only the top flagged rule. |
| `label` | Form-model label (Architecture §6.3) |
| `joints` | COCO joints that tint amber when the rule flags |
| `rest_note` | Fixed note, shown when the LLM's version fails the tone check |

**The rule passes when the check holds.** Otherwise the rep gets a flag `{ rule_id, severity, rep_index }`, held until the set ends.

Placeholders in `rest_note`:

- `{n}`: reps flagged
- `{total}`: reps in the set
- `{value}`: mean reduced value over the flagged reps
- `{t}`: that value in seconds. Allowed only for `duration_ms` rules.

## Injury overrides

All three keys are required in every spec. Each one has:

| Field | Meaning |
|---|---|
| `phases` | Partial patch of `phases` |
| `rules` | `{ <rule id>: { value?, severity?, rest_note? } }`. `value` replaces `check.value`. |
| `disable_rules` | Rule ids to skip |
| `extra_note` | Required. Shown with rest notes for users with this injury. No placeholders. |

`applyOverride(spec, injury)` in `specs/validate.mjs` is the reference merge. For users with several injuries, apply `knee`, `shoulder`, `lower_back` in that order and keep the more conservative value for each threshold. Physio-entered limits (`REHAB_LIMIT`) go on top, per user.

## Tone

Every `rest_note` and `extra_note` describes the movement, not the person, and gives no commands (Architecture §7). The validator rejects:

- any phrase in `banned-phrases.json` `phrases` (case-insensitive, whole words, `’` treated as `'`)
- any sentence starting with a word from `imperative_openers`
- `!`

| Reads as | Example | Passes |
|---|---|---|
| Suggestion with context | "Next set, try lowering until your hips are level with your knees." | yes |
| Fact plus reason | "Your knees drifted inward on {n} reps. Pointing them over your toes keeps them comfortable." | yes |
| Gerund | "Keeping your chest a little taller makes this easier on your back." | yes |
| Pain routed to a professional | "Any pain is worth raising with your physio or a doctor." | yes |
| Command | "Keep your chest up." / "Stop the range wherever you feel discomfort." | no |
| Judgement | "That rep was bad." | no |

## Adding an exercise

1. Copy `squat.json` to `<id>.json` and set `id`.
2. Pick the primary joint angle and its direction. Set the thresholds from a few recorded reps.
3. Write the rules, each with a unique priority and a fixed `rest_note`.
4. Fill in all three injury overrides. One that doesn't matter for the exercise can be just an `extra_note`.
5. Run `node specs/validate.mjs`.
