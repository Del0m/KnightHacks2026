Closes #45.

This adds declarative JSON specs for the five MVP exercises in `specs/exercises/`: squat, push-up, bicep curl, shoulder press and lunge. Each spec has:

- angles
- rep phases
- form rules, each with a fixed `rest_note`
- injury overrides for knee, shoulder and lower back

A dependency-free validator enforces the shape, the references, the threshold order and the no-commands tone of every note.

Branched from `main`. It depends on nothing, and nothing here touches app code.

## What each spec gives the engine

| Spec | View | Counts reps on | start_exit / count_min / target / start_enter | Rules, by priority | Injury overrides |
|---|---|---|---|---|---|
| `squat` | side | knee, decreasing | 160 / 135 / 95 / 165 | depth, knee_tracking (front), trunk_lean (side), tempo | **knee:** target 110, tempo 1.5 s. **lower_back:** target 105, trunk lean ≤ 35 as safety. **shoulder:** note only. |
| `push_up` | side | elbow, decreasing | 150 / 120 / 90 / 155 | hip_sag (side), depth, lockout, tempo | **shoulder:** target 110, count_min 125, tempo 1.2 s. **lower_back:** hip line ≥ 165 as safety. **knee:** note only. |
| `bicep_curl` | side | elbow, decreasing | 145 / 100 / 60 / 150 | range, torso_swing (side), elbow_drift (side), tempo on the lowering | **shoulder:** elbow drift ≤ 15. **lower_back:** torso swing ≤ 6 as safety. **knee:** note only. |
| `shoulder_press` | front | elbow, **increasing** | 100 / 135 / 160 / 95 | back_arch (side, safety), lockout, wrist_stack (front), tempo on the lowering | **shoulder:** target 145, count_min 125, tempo 1.2 s. **lower_back:** back arch ≤ 10. **knee:** note only. |
| `lunge` | side | front (more-bent) knee, decreasing | 160 / 130 / 95 / 165 | depth, trunk_lean (side), tempo | **knee:** target 110, tempo 1.5 s. **lower_back:** trunk lean ≤ 15 as safety. **shoulder:** note only. |

Every injury override also carries an `extra_note`. Where an injury matters, the note mentions the physio or a doctor.

## Changes

- **Spec format (`spec_version: 1`):** the full reference is in `docs/specs/exercise-spec-format.md`.
  - **`angles`:** each one is a `joint_angle`, a `segment_tilt` from vertical, or a `width_ratio`.
    - Points are COCO names, unsided names resolved by `side`, or `mid_<joint>`.
    - `side` is `left`, `right`, `both_avg`, `min`, `max` or `most_visible`.
    - `duration_ms` is a built-in metric.
  - **Phases:** one state machine fits all five exercises: `start → outbound → peak → return`, with a `direction` per exercise.
    - `count_min` (what counts as a rep) is separate from `target` (the form goal), so a shallow rep is counted *and* flagged.
    - The press runs with `direction: "increasing"`.
  - **Rule checks:** each one is a structured `{ metric, reduce, op, value }`, not an expression string. AI-07 needs no parser.
    - `value` can name a threshold (`"target"`), so an override's phase changes carry through to the rules.
  - **Rule metadata:** each rule carries `view`, `severity` (`form` or `safety`), a unique `priority`, a §6.3 model `label`, the `joints` FE-06 tints, and `rest_note` (with `{n}`, `{total}`, `{value}`, and `{t}` for duration rules only).
  - **Rule windows:** they close when the movement settles, not when the rep is counted, so a lockout check sees the full extension.
  - **Overrides:** all three are required in every spec. They can patch phases, patch a rule's value, severity or note, and disable rules. `extra_note` is required.
- **`specs/exercises/schema.json`:** a JSON Schema (draft 2020-12). Specs reference it, so editors autocomplete, and BE-06 can reuse it.
- **`specs/banned-phrases.json`:** banned phrases plus imperative sentence openers. It is the one list for both the fixed notes and the LLM rest-note check (§7, §18).
- **`specs/validate.mjs`:**
  - A small JSON Schema subset validator, covering the keywords `schema.json` uses.
  - Semantic checks:
    - the id matches the file name
    - rule ids and priorities are unique
    - metrics and points resolve
    - `reduce` is present exactly when it's needed
    - thresholds are in order for the direction, both in the base spec and after each override is applied
    - override references point at real rules
    - tone and placeholders are valid in every `rest_note` and `extra_note`
  - **`applyOverride(spec, injury)`:** the reference merge for AI-07.
  - **CLI:** `node specs/validate.mjs`.
- **Docs:**
  - **Root `Architecture.md`:**
    - **§6.1:** the state diagram now shows `count_min`, `reverse_deg` and the settle window.
    - **§6.2:** a new example spec. The old knee note, "Stop the range wherever you feel discomfort.", was itself a command; it is replaced.
    - **§6.3:** the label list.
    - **§7:** a pointer to the banned-phrase file.
    - **§15:** the layout.
  - **Design contract:** `docs/superpowers/specs/2026-10-10-exercise-specs-design.md`.

## Validation

`node specs/validate.mjs`:

```
✓ bicep_curl.json
✓ lunge.json
✓ push_up.json
✓ shoulder_press.json
✓ squat.json
```

`node --test specs/*.test.mjs`:

```
ℹ tests 38
ℹ suites 6
ℹ pass 38
ℹ fail 0
```

The tests cover:

- all five specs valid
- each schema keyword
- id/filename mismatch
- duplicate ids and priorities
- primary-angle errors
- missing `side`
- unknown metrics
- `reduce` rules
- threshold order for both directions and after overrides
- bad override references
- patch and disable on the same rule
- the tone of override notes, including §6.2's old "Stop the range…" note
- placeholder rules
- banned phrases, curly apostrophes, imperative openers in any sentence, `!`, word boundaries and hyphenated openers
- `applyOverride` merging without mutating the base spec

An independent check with Ajv 8.17.1 (draft 2020-12), run outside the repo, also validates all five specs against `schema.json` with no errors.

## Not included

- **Untuned thresholds:** these are starting values from typical joint angles. None has been checked against recorded clips or real pose output. Tuning needs AI-06's engine running on recorded reps.
- **Untested metric definitions:** nothing in this PR computes an angle, so whether `segment_tilt`, `width_ratio` and `most_visible` behave well on noisy joints is untested. For example, `most_visible` might flip sides between frames.
- **Fragile metric choices:** the lunge uses the more-bent knee (`side: "min"`) as the front leg, and the curl and press use the more visible arm. Alternating-arm curls and walking lunges haven't been considered beyond that.
- **Engine, rules and flags:** AI-06 and AI-07. Camera-view detection for `view` is also theirs.
- **Several injuries at once:** the docs describe the merge order and the "more conservative wins" rule, but there is no code for it. `applyOverride` handles one injury.
- **Physio limits (`REHAB_LIMIT`):** applied per user by AI-07, on top of these specs.
- **Loading specs:** loading them into Neon and serving them is BE-06. Bundling them into the app (Metro would need `specs/` in `watchFolders`) is for AI-06 to decide.
- **Tone check limits:** the check is a word list and catches only listed imperative verbs. Clinical wording and physio sign-off on the notes haven't been reviewed.
- **No mobile changes:** lint and `tsc` weren't run, because no mobile code changed.
