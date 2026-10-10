# AI-09 joint capture and labelling

This tool implements the AI-09 local dataset workflow. The owner captures and reviews their own movements on the iPhone. Consent permits private model development and evaluation; publication is not permitted. Training notebook changes belong to AI-10.

The delivery target is 10 p.m. Eastern on October 10, 2026. The implemented tool and a device pilot are separate from collecting the required dataset. Issue #49 is complete only when at least **40 accepted, human-reviewed reps per exercise** exist for squat, push-up, bicep curl, shoulder press and lunge: at least 200 total. Synthetic automated fixtures, recordings without saved human review, uncertain reps and discarded reps do not count. A deficit for one exercise cannot be offset by more reps of another exercise.

## Install and open

The route is `spotter://labelling`. Dataset capture uses Core ML at 320 pixels and retains joints only. It does not create an image, audio or video recording. The camera buffers are processed on the phone. Confirm the selected exercise, camera view, side and standard/modified/prescribed context before starting. A modified movement remains a recorded context, not a medical diagnosis.

Native sharing and checksum dependencies require rebuilding the installed app. From `apps/mobile`, use the project's Expo CLI through pnpm:

```sh
pnpm exec expo run:ios --device
```

For a standalone Release build and performance acceptance:

```sh
pnpm exec expo run:ios --device --configuration Release
```

Keep bundle identifier `com.knighthacks.spotter` and the existing signing team to update the installed app. The owner's known phone is an iPhone 17 Pro Max; the current installed build configuration and iOS version must be recorded during the pilot. A development client can load Metro changes with `pnpm start --lan`. A standalone Release app needs its updated bundled code. Expo Go cannot load the custom pose plugin.

## Capture and review

1. Create the pseudonymous participant/session and record consent. Keep the private consent evidence separate from dataset exports. Start is blocked without consent, known frame dimensions or the on-device detector.
2. Prop the phone upright, keep relevant joints visible, and select the exercise's observable camera view. Capture a short set, return to the resting position, and retain the final settle tail before stopping. Camera, model and exercise are locked during the clip. The maximum clip length is 60 seconds.
3. Review skeleton playback on the phone. Scrub and create, trim or delete rep intervals, including manually identified partial attempts that the automatic counter missed. Boundaries are source-frame indices with a start-inclusive/end-exclusive convention.
4. Save a human label and reviewer provenance for every usable interval. `clean` means no observable error in the **recorded view**, not a guarantee about every possible view. Choose an explicit primary label when multiple observed errors apply. Exercise/view-incompatible errors cannot be accepted.
5. Rule flags become visible after saving human judgement. They never overwrite human labels. Mark unreadable/ambiguous movements uncertain or discard them; neither state contributes to coverage.
6. Save before leaving review. Reopening restores saved annotations; an interrupted recording restores an incomplete draft. Backgrounding, camera failure or a mode change stops the session and records the reason. Resume collection as a new clip.

The recorder preserves original joint values and no-person markers. Drafts use verified immutable revisions, retaining the newest two valid generations. If a write fails, the app must report that saving failed. Capture checkpoints can preserve only the last successful checkpoint after abrupt termination; saved annotations must be confirmed through the actual reopen pilot.

## Share and validate on the Mac

Share one dataset bundle from the phone and separately share the private consent evidence JSON. Store both locally outside tracked source. The bundle carries source clips, accepted training rows, checksums, provenance and coverage summaries. The summaries do not replace private consent evidence. Cancelling the share sheet preserves the draft/export; an opened share sheet is not evidence of successful transfer.

Use **Node 25** from the repository root; it executes the pure TypeScript modules through native type stripping. Replace the example paths with the actual saved files:

```sh
node ml/labelling/cli.mjs validate /private/path/bundle.json --consents /private/path/consents.json
node ml/labelling/cli.mjs unpack /private/path/bundle.json --consents /private/path/consents.json --out /private/path/new-dataset-folder
node ml/labelling/cli.mjs merge /private/path/bundle-a.json /private/path/bundle-b.json --consents /private/path/consents.json --out /private/path/new-merged-bundle.json
```

Validation reimports the bundle through the strict local parser, checks source/training agreement and SHA-256 checksums, verifies matching active consent evidence, and prints trusted coverage. Missing private evidence fails validation. Merge rejects duplicate clip IDs, rep IDs and duplicate source intervals. No command uploads data. Output files/directories must be new; existing content is never overwritten.

Unpack writes exact `clips.jsonl` and `training.jsonl` bytes plus `manifest.json`. Accepted training rows have exactly 32 timestamp-based samples with 17 joints, confidence and validity masks. Coordinates retain upright anatomical orientation; only image-aspect correction is applied. Confidence below 0.3 is masked, and interpolation does not bridge no-person observations or gaps over 300 ms. Preserve the source clips for boundary correction and future preprocessing changes.

Deletion on the phone removes linked app-managed drafts/exports and keeps a withdrawal tombstone. Exported copies on the Mac or other destinations must be deleted manually, including unpacked files and merged bundles. Rebuild any retained merged dataset and coverage after withdrawal. Keep consent evidence private; do not commit it or publish this dataset. With a single participant, report a one-person demonstration dataset and make no independent participant generalization claims.

## Device acceptance: not yet verified

Start with a **three-rep capture/export rehearsal** before bulk collection. Then perform the five-rep annotation pilot: three comfortable clean reps and two comfortable modified-range attempts. Review all intervals, edit one boundary, discard one rep, save, close/reopen the app, and confirm the exact labels/boundaries persist. Transfer the bundle and consent evidence to the Mac, validate, unpack/reimport offline, and verify accepted counts. Synthetic tests do not supply this evidence.

- [ ] Record build commit/configuration, phone/iOS version, model, input size and failures.
- [ ] Confirm both camera previews/skeletons align, anatomical left/right remains correct, and no-person markers clear the replay.
- [ ] Confirm consent rejection blocks Start; exercise/camera/model controls stay locked during capture.
- [ ] Confirm the last rep includes its settle tail and manual partial attempts can be saved independently of counter results.
- [ ] Background during capture and test interruption/recovery; test camera failure and leaving frame.
- [ ] Confirm the 60-second cap and draft/review restoration after closing and reopening.
- [ ] Cancel sharing, confirm data persists, then physically save the file on the Mac and run the validator.
- [ ] Confirm no unexpected image/video/audio file is created.
- [ ] Confirm responsiveness and approximately 15 processed fps while capture checkpoints run; record dropped frames and failures.
- [ ] Record actual reviewed accepted counts by exercise and the remaining collection deficit.

Use familiar comfortable movements and rest between clips. Do not force dangerous deviations to fill labels. There is no requirement to collect every error class or all 200 reps in one session.

## Automated checks

From the repository root:

```sh
node --test ml/labelling/tests/*.test.mjs
node --test specs/*.test.mjs
```

From `apps/mobile`:

```sh
pnpm test -- --runInBand
pnpm run typecheck
pnpm run lint
```

Actual check results belong in the delivery report. Passing automated checks verifies code paths and synthetic behavior; the checklist above remains unverified until the owner performs and confirms it. Preserve the original proposal at `Markdown/AI-09-Proposal.md` as design history.

## Implementation verification — October 10, 2026

- `npm test -- --runInBand` in mobile: 607 tests passed across 46 suites.
- `node --test ml/labelling/tests/*.test.mjs`: 44 tests passed; generated samples are test-only.
- `node --test specs/*.test.mjs`: 147 shared-contract tests passed.
- Mobile `npm run typecheck`: passed.
- Mobile `npm run lint`: zero errors; eight pre-existing warnings. TypeScript-aware import resolution fixes the previous `expo-file-system` resolution error.
- `npx expo export --platform ios --output-dir /private/tmp/ai09-ios-export`: passed.
- Connected device reports iPhone 17 Pro Max, iOS 26.6.2 (23G90). Native Release installation and owner pilot results are recorded separately when completed.

Tests were added before the modules existed and failed with missing-module errors. Additional hardening regressions failed on existing behaviour before their fixes, including invalid consent, revision recovery/pruning, shared closure frames, confidence thresholds and impossible calendar dates. Mobile environment setup was corrected to simulate a foreground iPhone; expected capture/privacy outcomes were retained.

The generated `ios/` checkout contained Finder/iCloud conflict copies of the Xcode project/workspace, causing CocoaPods to reject automatic project selection. Those copies were temporarily preserved separately for the build, without manually editing native project files. Subsequent builds must resolve or temporarily isolate duplicate generated projects if they remain present.
