# AI-09: joint-only capture and rep labelling proposal

Date: 2026-10-10. Status: proposed; the labelling feature is not implemented.

Issue: [#49 — Record and label form clips](https://github.com/Del0m/KnightHacks2026/issues/49).

## Outcome

Add a small tool that records joint sequences on the existing iPhone app, lets a reviewer adjust rep boundaries and assign form labels, and exports a validated dataset. Issue completion requires **at least 40 accepted, human-reviewed reps per exercise: 200 total** across squat, push-up, bicep curl, shoulder press and lunge. A recorded set, a frame or a synthetic fixture is not a labelled rep.

You confirmed that your iPhone already has Spotter installed. Start with a three-rep capture/export rehearsal. Collect the full dataset only after the new labelling/export path passes that rehearsal.

## What the documentation and code establish

- `Architecture.md` §6.3 specifies 17-joint inputs, a 32-frame training representation, named form-error labels, and retaining only joints. The issue's `docs/Architecture.md` link is stale: the design reference is the root file.
- AI-02, issue #42, is closed. `docs/pose/frame-processor-validation.md` records owner-confirmed alignment on both cameras, anatomical left-arm tracking, no-person clearing and at least 15 fps for 60 seconds on the tested iPhone build. That is prior device evidence, not validation of this proposed tool or every integrated build.
- `apps/mobile/src/app/pose-debug.tsx` exposes `spotter://pose-debug`. `PoseDebugScreen.tsx` already offers exercise selection, **Record clip** and **Stop and share clip**. Its `Share.share` call sends JSON text; a title ending in `.json` does not guarantee a file attachment or successful recipient-side import.
- `src/engine/recording.ts` already stores compact joint frames, confidence, timestamps, image dimensions and explicit no-person markers. It has no consent gate, reviewed rep annotations, durable draft storage or capture limit. `compactPose` spreads the input object, so it is not a strict export privacy filter.
- Engine events provide candidate boundaries. A counted rep finishes its rule window at `rep_closed`, after `rep_counted`; capture must retain the settle tail. Partial attempts may never become counted reps. Review must permit manual boundaries independently of the counter.
- The shared `SetRecord` describes workout records, not a dataset annotation. Add a separate versioned dataset schema rather than changing workout uploads.
- `databricks/notebooks/form_model.py` currently derives labels from rule flags and handles only a subset of labels explicitly. Hand-labelled training ingestion belongs to a follow-up integration/AI-10; capture alone does not update training.

References read: root architecture §§4, 6, 7, 13 and 15; mobile README and AGENTS; `Markdown/Mobile-Setup.md`, Working Rules and Project Rules; pose contract, pipeline and validation docs; exercise and set-record formats; form-engine and form-rule designs; current capture/engine code and exercise specs.

## Recommended design

```text
iPhone camera → existing on-device pose hook → consent-gated joint recorder
             → saved joint clip → skeleton replay + editable rep intervals
             → human labels → validation/coverage report → local dataset export
```

**No video file is created.** Camera buffers feed the existing model transiently. “Clip” means a replayable sequence of joints. This meets clip/boundary/label interaction without retaining images, audio or video. Do not use cloud inference in the dataset capture mode.

Keep the core schema, validators, import/export logic and tests under `ml/labelling/`, as #49 requests. Use a small iPhone UI adapter with an Expo Router route and feature screen under `apps/mobile/`; this is an explicit proposed scope extension needed for in-app collection, to coordinate with the frontend owner. Preserve existing navigation and the pose module. Documentation stays in `Markdown/`.

Proposed files:

```text
ml/labelling/
  schema.json              versioned joint clip + rep annotation contract
  src/                     pure validation, annotation, resampling and coverage functions
  tests/                   deterministic fixtures and behavioural tests
  data/                    local recordings/consent references; gitignored
apps/mobile/src/app/labelling.tsx
apps/mobile/src/screens/Labelling/   capture, skeleton review and export adapter
```

Use the existing Expo 57, Vision Camera v5, `usePoseOutput`, COCO joint order and exercise IDs. Avoid a second pose implementation or a new backend. Use durable local draft files and atomic replacement so a terminated app does not erase a reviewed clip. Select and verify an SDK 57-compatible file-sharing mechanism during implementation; `expo-file-system` is already declared, but lint currently has a resolution error. Native dependency additions require rebuilding the installed client.

### Capture and consent

Before Start, select an exercise and create a pseudonymous participant ID. Capture consent must record the participant, consent version, time and permitted purpose. Every person intentionally captured must consent; collect with one participant and no bystanders. Publication permission is separate and optional. Keep identities and consent records private; exports carry only a reference and allowed-use status.

Require known frame dimensions and an on-device detector before capture. Lock exercise, camera and model during a clip. Proposed maximum: 60 seconds, with five-rep clips as the normal collection unit. Backgrounding, camera failure, mode changes or interruption stop capture and mark a draft incomplete; never silently resume it as one continuous rep. Discard/retry and cancel-export paths preserve predictable state. Add deletion/withdrawal that removes linked local clips and derived exports; public release is outside this proposal.

### Review and labels

After Stop, replay the skeleton, scrub through frames and inspect timestamps. Show suggested engine intervals, but allow creating, trimming and deleting intervals manually—including uncounted partial attempts. Require a reviewer to save each annotation. Review the movement before revealing automatic rule suggestions to reduce anchoring.

Use `clean` or an exercise-valid error label from the existing JSON specs. Also allow `uncertain` and `discard` review states; neither counts toward 40. For multiple errors, preserve all observed labels and explicitly choose a primary label for a single-label classifier. Do not infer clean from missing flags, low confidence, skipped views or a failed detector. Keep `human_labels` and `rule_flags` separate with reviewer and boundary provenance.

Labels describe observable movement, not an injury diagnosis. An error that is invisible from the chosen camera angle is uncertain. Track view, side and any modified exercise/rehab context so a prescribed limited movement is not accidentally labelled a general form error.

### Contract and training export

Store schema version, participant/session/clip/rep IDs, exercise ID, camera view and position, image dimensions, model/source, relative frame timestamps, confidence, no-person markers, consent reference, reviewed interval, labels and review provenance. Use an explicit allowlist serializer that rejects extra fields: no images, encoded buffers, audio, video URLs, names or account credentials.

Rep intervals use frame indices with a documented start-inclusive/end-exclusive convention. Validate bounds, order, non-overlap, finite normalized coordinates and confidence, exactly 17 joints, monotonic timestamps, nonempty motion and exercise-compatible labels. Preserve original joint samples. Emit derived `32 × 17 × 2` training arrays plus a parallel confidence/validity mask, normalization metadata and duration. Preserve image aspect when doing geometry. Do not interpolate across long missing-person gaps; proposed review cutoff is 300 ms, to calibrate during the pilot. Rejected reps remain available for correction and do not enter training.

Export local JSONL plus a manifest with checksums, consent status and accepted counts by exercise, label and participant. Reject duplicate rep IDs and duplicate source intervals on import/merge. Group future evaluation by participant; with only your data, report a single-person demonstration dataset and avoid claiming independent generalization. Never put resampled versions of the same rep into different splits.

## Your collection schedule

Recommended starting target: **20 clean + 20 off-form reviewed reps per exercise**, in eight clips of five. This balance is a proposal, not an additional issue requirement. Discarded/uncertain samples mean replacements will be needed. Two consenting people doing 20 per exercise each is preferable to all 200 coming from you; one person still meets the numeric requirement if disclosed.

| Exercise | Starting view from spec | Clean | Off-form | Notes for review |
|---|---|---:|---:|---|
| Squat | Side | 20 | 20 | Range/lean visible from side; knees-in needs a separate front view |
| Push-up | Side | 20 | 20 | Keep shoulders, hips, wrists and ankles visible |
| Bicep curl | Side | 20 | 20 | Keep working shoulder, elbow and wrist visible |
| Shoulder press | Front | 20 | 20 | Keep wrists visible overhead; back-arch assessment needs a side view |
| Lunge | Side | 20 | 20 | Record left/right and balance lead legs across clips |

Use bodyweight or very light familiar movements. Do not force knee collapse, sagging, swinging or back arch under load to fill categories. A comfortable reduced-range variation can supply a `partial_range` example if a reviewer can establish it; if it is prescribed for you, record that context and do not mislabel it. Natural deviations can be reviewed without staging them. Stop if uncomfortable, rest between clips, and spread collection across sessions. There is no requirement to collect every error class or do 200 reps in one sitting.

For each five-rep clip:

1. Confirm consent, exercise, view and participant; start from a stable position with full relevant joints in frame.
2. Start the countdown, perform five comfortable reps and return to the resting/start position.
3. Stop after the final settle tail. Review all five intervals; count what you actually performed, even if automatic detection missed a partial attempt.
4. Assign human labels, reject unreadable reps, save and verify the accepted-count increment.
5. Rest. Export/check the first clip before continuing so a broken transfer never wastes a full session.

## Phone rehearsal: available now versus proposed

**Existing build:** open the app's developer route `spotter://pose-debug` if that build includes it. On a Mac terminal, with the iPhone plugged in, it can be opened using `xcrun devicectl device open url --device <device-id> 'spotter://pose-debug'`; find the ID with `xcrun devicectl list devices`. Alternatively open the route from the development client's navigation/deep-link tooling. An older standalone build may already show the debug screen, or may need an updated build to include the route.

Select squat, use the side view, prop the upright phone about 2–3 m away at roughly chest height, and confirm the skeleton follows your body. Choose on-device Core ML for consistent collection. Obtain consent before recording manually: the current recorder has no built-in gate. Tap **Record clip**, perform three comfortable reps, wait briefly at the top and tap **Stop and share clip**. Save/share the JSON text to your Mac and verify it can be parsed, contains frames with 17 joints, and retains the complete motions. This rehearses capture only; it does not produce reviewed dataset labels.

If using a development client, from `apps/mobile` run `npm start -- --lan`, then open Spotter and connect to Metro on the same Wi-Fi. The project prefers pnpm; the equivalent is `pnpm start --lan`. A standalone Release install contains its own JS bundle and will not automatically acquire the proposed labelling feature from Metro. Rebuild it after implementation using `pnpm exec expo run:ios --device --configuration Release` (or `npx expo run:ios --device --configuration Release`). Keep the existing bundle identifier and signing team to update your installed app. Expo Go cannot load this native pose plugin. See the local mobile README and [Expo local development guide](https://docs.expo.dev/guides/local-app-development/).

**New tool pilot, before bulk collection:** capture three clean and two comfortable modified-range reps; review all five manually; edit one boundary; discard one; close/reopen the app; confirm annotations persist; export to the Mac; validate the exported file; reimport and confirm labels and boundaries agree. Test leaving frame, backgrounding, denied consent and cancelling export. Confirm no unexpected video/photo file is created. Record build commit, phone/iOS version, model, fps, accepted counts and failures. Do not call the tool device-verified until you complete this pilot.

## Test-driven prompting: build in independently verifiable increments

For each prompt below: write behavioural tests first, run them and show the expected failure, implement the minimum change, then rerun unchanged tests. Report actual commands/results and any remaining device-only checks. Never change expected labels just to match the engine, and never count synthetic test data toward collection.

**Prompt 1 — contract and privacy**

> In `ml/labelling/`, define the joint-only dataset contract above. First test rejected consent, invalid exercises/labels, nonfinite/out-of-range coordinates, wrong joint counts, extra image/video fields, bad timestamps, overlapping/out-of-bounds intervals, duplicate imports and uncertain/discarded coverage. Demonstrate failures before implementing strict validation and allowlist export. Do not modify the workout schema or upload data.

**Prompt 2 — capture lifecycle**

> Reuse the current pose hook/clock/recorder through a small mobile adapter. First test Start blocked without consent or frame dimensions, camera/exercise locking, the 60-second cap, camera failure/background stop, no-person markers, final settle-tail retention, retry/reset, and durable draft restoration. Implement these behaviours with mocked detections; then leave real performance as a phone acceptance check.

**Prompt 3 — annotation and data quality**

> First test manually adding an uncounted partial rep, editing its boundaries, saving independent human labels, excluding uncertain reps, matching errors to exercise/view, and preserving reviewed annotations across export/import. Test interpolation on irregular timestamps, missing-data masks, no bridging long gaps, and exactly 32 derived frames per accepted rep. Implement skeleton review and deterministic preprocessing; automatic rule flags must never overwrite human labels.

**Prompt 4 — end-to-end acceptance**

> Test consent → recorded detections → reviewed intervals → saved/reopened draft → strict local export → reimport → accepted-count manifest. Coverage must fail at 39 reps for any MVP exercise even if the total exceeds 200; pass only with at least 40 per exercise and valid consent/review. Test deleting a participant and regenerating exports. Run the mobile tests, lint, typecheck and shared-contract checks, then guide the owner through the five-rep iPhone pilot. Report what is automated, what the owner confirmed, and what remains unverified.

## Verification performed for this proposal

On the current checkout, before any feature implementation:

| Check | Result |
|---|---|
| `npm test -- --runInBand recording PoseDebugScreen fixtures setRecord` in mobile | 148 tests passed, four suites |
| `node --test specs/*.test.mjs` at root | 147 tests passed |
| `npm run typecheck` in mobile | Passed |
| Local Metro iOS bundle request | Passed: 1,234 modules bundled; development server started on port 8082 |
| `npm run lint` in mobile | Failed: existing `src/models/modelUpdates.ts:16` cannot resolve `expo-file-system`; eight warnings |
| New labelling feature/device pilot | Not implemented or tested |

These checks support reuse of the existing capture and contracts. They do not prove this proposed feature works. Resolve the lint/dependency issue and verify the integrated build before collection. There is no existing `ml/labelling/` directory or `graphify-out/graph.json`; this proposal is based on direct documentation/source inspection, not a generated knowledge graph.

For this session, Metro is running at `http://10.32.220.216:8082`. On the same Wi-Fi, enter that address in the installed Spotter development client's server selector, then open `/pose-debug`. The development-client deep link is `spotter://expo-development-client/?url=http%3A%2F%2F10.32.220.216%3A8082`; the screen route after loading is `spotter://pose-debug`. This address may change on another network. LAN reachability and camera operation still require your phone check. A standalone Release build can use its existing debug screen without Metro, but cannot load this server as a development client.

## Delivery order and completion gate

1. Implement strict contract/privacy and dataset coverage tests under the issue folder.
2. Implement local capture and durable drafts; coordinate the small mobile UI extension.
3. Implement skeleton annotation, validated export and preprocessing.
4. Pass automated checks and your five-rep iPhone pilot.
5. Collect/review at least 40 accepted reps per exercise; record provenance and coverage, then hand off the dataset to AI-10.

Issue #49 is complete only when the usable tool, real reviewed dataset and consent evidence exist. Hub publication, training integration and model quality claims are follow-ups. No GitHub comment, push or publication was made as part of this draft.
