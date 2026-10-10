Closes #43.

Adds Apple Vision body pose as a manual, on-device basic mode on iPhone, mapped to the same 17 COCO joints as YOLOv8n-pose. It also changes the architecture: Android runs no pose model on the phone and always uses cloud mode, and basic mode is never chosen automatically. Slow or unsupported iPhones go to cloud mode instead.

## Pose modes

| Situation | Mode |
|---|---|
| iPhone, YOLOv8 holds 12+ fps | `coreml` |
| iPhone too slow, or the model fails to load | `cloud` (needs consent) |
| Android, always | `cloud` (needs consent) |
| User switches on-device to cloud | `cloud` (needs consent) |
| User picks Apple Vision (iPhone only) | `vision` |
| Cloud needed, no consent | `unavailable` (Live Set gated, manual logging works) |
| Cloud needed, unreachable | `paused` |

A phone that can run YOLOv8 falls back to it, instead of pausing, when the user's chosen cloud mode loses consent or signal.

`selectPoseMode` in `apps/mobile/src/pose/mode.ts` is a pure function. AI-04 supplies the real benchmark fps and caches the result.

## Changes

- **PoseCore:** `VisionPoseMapper` converts Vision's 19 points to the 17 COCO joints (neck and root dropped).
  - It flips y from Vision's bottom-left origin.
  - Undetected and zero-confidence joints become `(0, 0, c = 0)`.
  - Score is the mean joint confidence, with the same 0.25 cut-off as `PoseDecoder`.
  - With several people, the highest score wins.
  - `PoseSource` gains `vision`.
- **Native module:** `HybridBasicPoseDetector` runs `VNDetectHumanBodyPoseRequest`. It is created with `createBasicPoseDetector()` on the existing factory and returns the existing `PoseDetector` spec. The orientation calibration and timestamp code moved into a shared `PoseFrameReader`, so both detectors read frames the same way. Nitrogen output is regenerated.
- **JS:**
  - `usePoseOutput` takes `engine: 'coreml' | 'vision'`.
  - `src/pose/basic.ts` adds `useBasicPoseOutput` and `isBasicModeSupported`.
  - The TS contract accepts the `vision` source.
- **Debug screen:**
  - A "Use Apple Vision / Use Core ML" toggle on iPhone.
  - Fixes the skeleton not appearing until the first camera flip. On a cold start, `onConfigured` can fire before the resolution is known, so the first pose now fills it in.
- **Docs:**
  - `Architecture.md` §4.1 has a new flowchart and mode rules. ML Kit and Android TFLite are removed throughout, and the §4, §5, §15 and §18 rows are updated.
  - `docs/pose/pose-result-contract.md` adds the `vision` source and the Apple Vision mapping.
  - `docs/pose/how-it-works.md` adds a basic-mode section.
- **Issue #43** is updated to strike the ML Kit criterion.

## Validation

- `swift test` in PoseCore: 57 tests pass, 12 of them new for the mapper. They cover joint order, y flip, missing and zero-confidence joints, score, threshold, multiple people and clamping.
- Jest: 56 tests pass. New tests cover:
  - every mode transition, including the user switching on-device to cloud
  - the basic-mode hook, and switching engines on a live hook
  - the contract's sources
  - the debug toggle and the startup skeleton fix
- `tsc --noEmit` is clean for pose and module files. The errors that remain are already there in `src/screens/Train` and `src/state`.
- `expo prebuild --clean` and an iOS Simulator build succeed.
- Checked on a physical iPhone with Apple Vision:
  - the skeleton lines up on the front and back cameras
  - left and right are anatomical
  - the skeleton shows on a cold start without a camera flip

  Apple Vision is visibly less accurate than YOLOv8, as expected.

## Not included

- **Lint:** not run, because `eslint` is not installed in `apps/mobile`.
- **Real benchmark and cached mode choice:** AI-04.
- **Consent screen:** FE-15.
- **Cloud endpoint and client:** CONN-11. Mode selection already returns `cloud`, `paused` and `unavailable` for these to build on.
- **Settings UI for the manual mode choice:** the debug-screen toggle stands in for now.
