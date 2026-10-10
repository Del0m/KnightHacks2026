# Pose Frame-Processor Plugin Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit or push; each task ends with a suggested commit message for the owner.

**Goal:** Run YOLOv8n-pose (Core ML) on every Vision Camera v5 frame in a minimal Expo 57 dev build and deliver contract-shaped joints to JavaScript at 15+ fps.

**Architecture:** A local Nitro package (`apps/mobile/modules/spotter-pose`) exposes `PoseDetector.detect(frame)`, implemented in Swift on top of AI-01's `PoseCore` (consumed as a local CocoaPod). A `usePoseOutput` hook in `apps/mobile/src/pose/` wires it into a Vision Camera frame output, throttles to 15 fps and hops results to the JS thread. A debug screen draws the skeleton.

**Tech Stack:** Expo SDK 57 (React Native 0.86), react-native-vision-camera 5.2.x, react-native-vision-camera-worklets, react-native-worklets, react-native-nitro-modules, react-native-nitro-image, nitrogen, react-native-svg, expo-build-properties, Swift / Vision / Core ML, Jest, XCTest via `swift test`.

**Spec:** `docs/superpowers/specs/2026-10-10-pose-frame-processor-design.md`

## Global Constraints

- iOS only. iOS deployment target 17.0 (PoseCore's floor).
- `react-native-vision-camera` **v5**, not v4.
- Output matches `docs/pose/pose-result-contract.md` exactly: fields `source`, `model`, `timestamp_ms`, `score`, `joints` (17 × `{x, y, c}`, COCO order); no person → `undefined`, never empty `joints`.
- Joints are upright and unmirrored with anatomical left/right. Mirroring happens only in drawing.
- Model sizes: 320 (default) and 256. Any other size throws `unsupported size <n>; use 320 or 256`.
- Model names: `yolov8n-pose-320`, `yolov8n-pose-256` (from `ModelLocator.modelName(size:)`).
- Default `maxFps` 15.
- `apps/mobile/ios/` and `apps/mobile/android/` are generated and gitignored. `.mlpackage` files are never committed.
- Nitro codegen output (`nitrogen/generated/`) is committed.
- No "Claude" anywhere in code, comments or docs.
- Do not edit `Architecture.md` (owner has uncommitted edits).

## Review Focus

1. **Front camera left/right.** Frame output with mirroring left on would swap anatomical left and right. Expect: raising your real left arm moves `left_wrist` (index 9). Pinned by setting the frame output's mirror mode to off in Task 6 and the device check in Task 7.
2. **Landscape / sideways phone.** `orientation` `left`/`right` must swap width and height before decode, or joints are squashed. Pinned by `ImageOrientationTests` in Task 1.
3. **Models not exported.** A fresh clone without `uv run export.py` must fail at prebuild with the export instruction, not crash at runtime. Pinned in Task 5.
4. **Slow phone backlog.** When `detect` is slower than the frame interval, frames must be dropped, not queued. Pinned by `throttle` tests in Task 3 and the frame-drop check in Task 7.
5. **Inference error on one frame.** A throw from `detect` must not stop the stream. Pinned by the try/catch in Task 6, checked on device in Task 7.

---

### Task 1: PoseCore orientation helper and podspec

**Files:**
- Create: `ml/pose_export/PoseBench/PoseCore/Sources/PoseCore/ImageOrientation.swift`
- Create: `ml/pose_export/PoseBench/PoseCore/Tests/PoseCoreTests/ImageOrientationTests.swift`
- Create: `ml/pose_export/PoseBench/PoseCore/PoseCore.podspec`

**Interfaces:**
- Produces:
  ```swift
  public enum FrameRotation: Sendable { case up, down, left, right }
  public enum ImageOrientation {
      /// Vision orientation for a buffer whose pixels are rotated by `rotation` (and mirrored if
      /// `mirrored`) relative to upright, plus the frame size once upright.
      public static func vision(rotation: FrameRotation, mirrored: Bool, width: Int, height: Int)
          -> (orientation: CGImagePropertyOrientation, uprightWidth: Int, uprightHeight: Int)
  }
  ```
  Pod name `PoseCore`, Swift module `PoseCore`.

- [ ] **Step 1: Write the failing tests** in `ImageOrientationTests.swift`:
  - `testUp`: `(.up, false, 1920, 1080)` → `(.up, 1920, 1080)`
  - `testDown`: `(.down, false, 1920, 1080)` → `(.down, 1920, 1080)`
  - `testRightSwapsSize`: `(.right, false, 1920, 1080)` → `(.right, 1080, 1920)`
  - `testLeftSwapsSize`: `(.left, false, 1920, 1080)` → `(.left, 1080, 1920)`
  - `testMirroredVariants`: up→`.upMirrored`, down→`.downMirrored`, left→`.leftMirrored`, right→`.rightMirrored`, sizes as above.
  (Mapping is name-for-name, matching Vision Camera's own `CameraOrientation.toUIImageOrientation(isMirrored:)`.)
- [ ] **Step 2:** `cd ml/pose_export/PoseBench/PoseCore && swift test --filter ImageOrientationTests` → FAIL (`cannot find 'ImageOrientation'`).
- [ ] **Step 3:** Implement `ImageOrientation.swift` (import `ImageIO` for `CGImagePropertyOrientation`).
- [ ] **Step 4:** `swift test` → all PoseCore tests PASS.
- [ ] **Step 5: Podspec.** `PoseCore.podspec`: name `PoseCore`, version `0.1.0`, `s.platforms = { :ios => '17.0' }`, `s.swift_version = '5.10'`, `s.source = { :path => '.' }`, `s.source_files = 'Sources/PoseCore/**/*.swift'`, `s.frameworks = ['CoreML', 'CoreVideo', 'QuartzCore', 'ImageIO']`, license `AGPL-3.0`.
- [ ] **Step 6:** `brew install cocoapods` (if `pod` missing), then `pod ipc spec PoseCore.podspec` → prints JSON with `"name": "PoseCore"`.
- [ ] **Suggested commit:** `feat(pose): ImageOrientation helper and PoseCore podspec (#42)`

### Task 2: Minimal Expo app scaffold and contract types

**Files:**
- Create: `apps/mobile/` via `npx create-expo-app@latest apps/mobile --template blank-typescript` (SDK 57)
- Modify: `apps/mobile/app.json`, `apps/mobile/package.json`, `apps/mobile/.gitignore`
- Create: `apps/mobile/src/pose/types.ts`, `apps/mobile/src/pose/__tests__/types.test.ts`

**Interfaces:**
- Produces (`src/pose/types.ts`):
  ```ts
  export const JOINT_NAMES: readonly string[]   // 17 COCO names, same order as PoseResult.jointNames
  export const BONES: readonly [number, number][] // same 16 pairs as OverlayGeometry.bones
  export interface Joint { x: number; y: number; c: number }
  export interface PoseResult { source: 'coreml' | 'cloud'; model: string; timestamp_ms: number; score: number; joints: Joint[] }
  export interface PoseDetection { result?: PoseResult; latencyMs: number }
  export function isPoseResult(v: unknown): v is PoseResult  // 17 joints, numeric fields, known source
  ```

- [ ] **Step 1: Scaffold.** Run create-expo-app, then `npx expo install expo-dev-client expo-build-properties react-native-vision-camera react-native-vision-camera-worklets react-native-worklets react-native-nitro-modules react-native-nitro-image react-native-svg` and `npm i -D jest jest-expo @types/jest nitrogen`. Add scripts `"test": "jest"`, `"typecheck": "tsc --noEmit"`, jest preset `jest-expo`.
- [ ] **Step 2: app.json.** `name` "Spotter", `slug` "spotter", `ios.bundleIdentifier` "com.knighthacks.spotter", `ios.infoPlist.NSCameraUsageDescription` "Spotter uses the camera to see your form. Video never leaves your phone.", plugins: `expo-dev-client`, `["expo-build-properties", { "ios": { "deploymentTarget": "17.0" } }]` (extraPods added in Task 4). `.gitignore` includes `/ios`, `/android`.
- [ ] **Step 3: Failing tests** in `types.test.ts`: `JOINT_NAMES.length === 17`, `JOINT_NAMES[9] === 'left_wrist'`, `JOINT_NAMES[16] === 'right_ankle'`; `BONES.length === 16` and every index in 0..16; `isPoseResult` true for the contract example (17 joints, `source: 'coreml'`), false for `joints: []`, false for 16 joints, false for `null`.
- [ ] **Step 4:** `npm test -- types` → FAIL. Implement `types.ts`. → PASS.
- [ ] **Step 5:** `npm run typecheck` → no errors.
- [ ] **Suggested commit:** `feat(mobile): minimal Expo 57 dev-build scaffold and pose contract types (#42)`

### Task 3: Throttle and overlay geometry (pure TS)

**Files:**
- Create: `apps/mobile/src/pose/throttle.ts`, `apps/mobile/src/pose/overlayGeometry.ts`
- Test: `apps/mobile/src/pose/__tests__/throttle.test.ts`, `apps/mobile/src/pose/__tests__/overlayGeometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // throttle.ts — both functions are worklet-safe ('worklet' directive first line)
  export function shouldProcess(nowMs: number, lastMs: number | null, maxFps: number): boolean
  // overlayGeometry.ts
  export type Fit = 'contain' | 'cover'
  export function jointToView(j: { x: number; y: number }, image: { width: number; height: number },
                              view: { width: number; height: number }, mirrored: boolean, fit: Fit): { x: number; y: number }
  ```

- [ ] **Step 1: Failing tests.**
  - throttle: `shouldProcess(0, null, 15)` true; `shouldProcess(60, 0, 15)` false; `shouldProcess(67, 0, 15)` true (interval = 1000/15 ≈ 66.7); `shouldProcess(1000, 0, 0)` true (0 = unlimited).
  - overlay, `contain` (same numbers as `OverlayGeometryTests.swift`, image 1080×1920, view 390×844): centre (0.5,0.5) → (195, 422); top-left (0,0) → (0, 75.3); (0.2,0.5) mirrored → x 312, unmirrored → x 78 (±0.1).
  - overlay, `cover`, image 1080×1920, view 390×600: scale = max(390/1080, 600/1920) = 0.3611; fitted 390×693.3; (0.5,0.5) → (195, 300); (0,0) → (0, -46.7) (±0.1).
- [ ] **Step 2:** `npm test -- throttle overlayGeometry` → FAIL.
- [ ] **Step 3:** Implement. `jointToView` is OverlayGeometry.point with `min` (contain) or `max` (cover) as the scale.
- [ ] **Step 4:** Tests PASS; `npm run typecheck` clean.
- [ ] **Suggested commit:** `feat(pose): frame throttle and overlay geometry (#42)`

### Task 4: `spotter-pose` Nitro module (native detector)

**Files:**
- Create in `apps/mobile/modules/spotter-pose/`: `package.json` (name `spotter-pose`, `main`/`react-native` `src/index.ts`, peerDeps react-native, react-native-nitro-modules, react-native-vision-camera), `nitro.json`, `SpotterPose.podspec`, `src/specs/PoseDetector.nitro.ts`, `src/index.ts`, `ios/HybridPoseDetectorFactory.swift`, `ios/HybridPoseDetector.swift`, `nitrogen/generated/**` (generated)
- Modify: `apps/mobile/package.json` (dependency `"spotter-pose": "file:./modules/spotter-pose"`), `apps/mobile/app.json` (extraPods)

**Interfaces:**
- Consumes: `ImageOrientation.vision`, `FrameRotation` (Task 1); `ModelLocator`, `PoseDecoder`, `MultiArrayReader`, `PoseResult`, `PoseError` (PoseCore); Vision Camera's `HybridFrameSpec` and `NativeFrame` (`sampleBuffer`), `frame.orientation`, `frame.isMirrored`.
- Produces: Nitro spec exactly as spec §4 (`Joint`, `PoseResult`, `PoseDetection`, `PoseDetector`, `PoseDetectorFactory`), and in `src/index.ts`:
  ```ts
  export function createPoseDetector(size: number): PoseDetector
  export type { PoseDetector, PoseDetection, PoseResult, Joint } from './specs/PoseDetector.nitro'
  ```
  `createPoseDetector` uses `NitroModules.createHybridObject<PoseDetectorFactory>('PoseDetectorFactory')`.

- [ ] **Step 1: Spec + nitro.json.** `nitro.json`: `cxxNamespace ["spotterpose"]`, `ios.iosModuleName "SpotterPose"`, autolinking `PoseDetectorFactory` → swift `HybridPoseDetectorFactory`. Use `react-native-vision-camera-barcode-scanner@5.2.3`'s `nitro.json` and podspec as the reference layout.
- [ ] **Step 2:** `cd apps/mobile/modules/spotter-pose && npx nitrogen` → `nitrogen/generated/ios/SpotterPose+autolinking.rb` and `HybridPoseDetectorSpec.swift` exist.
- [ ] **Step 3: Podspec.** Copy barcode-scanner's podspec shape: `s.name "SpotterPose"`, `s.platforms = { :ios => '17.0' }`, source_files `ios/**/*.swift`, `load 'nitrogen/generated/ios/SpotterPose+autolinking.rb'`, `add_nitrogen_files(s)`, dependencies `VisionCamera`, `NitroModules`, `PoseCore`, `React-jsi`, `React-callinvoker`, `install_modules_dependencies(s)`, frameworks `Vision`, `CoreML`, `AVFoundation`.
- [ ] **Step 4: extraPods.** In app.json `expo-build-properties` → `ios.extraPods: [{ "name": "PoseCore", "path": "../../../ml/pose_export/PoseBench/PoseCore" }]` (path relative to `apps/mobile/ios/`).
- [ ] **Step 5: Swift.**
  - `HybridPoseDetectorFactory.createPoseDetector(size:)` throws `RuntimeError.error(withMessage: "unsupported size \(n); use 320 or 256")` unless size ∈ {320, 256}; otherwise returns `HybridPoseDetector(size:)`.
  - `HybridPoseDetector.init(size:)`: identical model setup to `ml/pose_export/PoseBench/PoseBench/PoseEstimator.swift` (`.all` compute units, `.scaleFit`). `model` property = `ModelLocator.modelName(size:)`.
  - `detect(frame:)`: cast to `NativeFrame`, `CMSampleBufferGetImageBuffer` (throw `RuntimeError` if nil); map `frame.orientation` → `FrameRotation`; call `ImageOrientation.vision(rotation:mirrored: frame.isMirrored, width:height:)` with the buffer's size; `VNImageRequestHandler(cvPixelBuffer:orientation:)`; read output with `MultiArrayReader.floats`; `PoseDecoder.decode(..., frameWidth: uprightWidth, frameHeight: uprightHeight, model:, timestampMs: Int64(Date().timeIntervalSince1970 * 1000))`; convert to Nitro `PoseResult` (`source: "coreml"`, `timestamp_ms` as Double); latency from just before `perform` to after decode, ms.
- [ ] **Step 6: Build check.** In `apps/mobile`: `npm install && npx expo prebuild -p ios --clean` → `Pod installation complete` and Podfile.lock lists `PoseCore`, `SpotterPose`, `VisionCamera`. Then `xcodebuild -workspace ios/Spotter.xcworkspace -scheme Spotter -configuration Debug -destination 'generic/platform=iOS' -quiet build CODE_SIGNING_ALLOWED=NO` → `BUILD SUCCEEDED`. (Models are added in Task 5; until then the app builds but `createPoseDetector` throws `modelMissing` at runtime, which is expected.)
- [ ] **Step 7:** `npm run typecheck` clean; `git status --porcelain apps/mobile/modules/spotter-pose/nitrogen` shows only new files from this task (rerun `npx nitrogen` → no diff).
- [ ] **Suggested commit:** `feat(pose): spotter-pose Nitro detector on PoseCore (#42)`

### Task 5: `withPoseModels` config plugin

**Files:**
- Create: `apps/mobile/plugins/withPoseModels.js`, `apps/mobile/plugins/__tests__/withPoseModels.test.js`
- Modify: `apps/mobile/app.json` (add `"./plugins/withPoseModels"` to plugins)

**Interfaces:**
- Produces:
  ```js
  module.exports = withPoseModels                      // ConfigPlugin
  module.exports.findModels = (modelsDir) => string[]  // absolute .mlpackage paths; throws if any missing
  module.exports.MODEL_NAMES = ['yolov8n-pose-320', 'yolov8n-pose-256']
  ```
  Default `modelsDir`: `path.resolve(projectRoot, '../../ml/pose_export/PoseBench/PoseBench/Models')`.

- [ ] **Step 1: Failing tests** (Jest, temp dirs via `fs.mkdtempSync`): both `.mlpackage` dirs present → returns 2 paths ending in `yolov8n-pose-320.mlpackage` and `yolov8n-pose-256.mlpackage`; one missing → throws an error whose message contains `uv run export.py` and `ml/pose_export`.
- [ ] **Step 2:** `npm test -- withPoseModels` → FAIL. Implement `findModels`. → PASS.
- [ ] **Step 3: Plugin.** `withXcodeProject`: copy each `.mlpackage` (recursive `fs.cpSync`) into `ios/<projectName>/Models/`, add it to the main target as a source file (`project.addSourceFile` with the target's group) so Xcode compiles it to `.mlmodelc`. Idempotent across repeated prebuilds (skip if the file reference already exists).
- [ ] **Step 4:** With models absent (`mv` the Models dir aside): `npx expo prebuild -p ios --clean` → fails with the export message. Restore, run `uv run export.py` in `ml/pose_export` if needed, prebuild again → success; `grep -c "yolov8n-pose-320.mlpackage" ios/Spotter.xcodeproj/project.pbxproj` ≥ 1.
- [ ] **Step 5:** Xcode build as in Task 4 Step 6 → `BUILD SUCCEEDED`; `find ios/build -name "yolov8n-pose-320.mlmodelc"` (or in DerivedData app bundle) finds it.
- [ ] **Suggested commit:** `feat(mobile): config plugin bundles pose models at prebuild (#42)`

### Task 6: `usePoseOutput`, skeleton and debug screen

**Files:**
- Create: `apps/mobile/src/pose/usePoseOutput.ts`, `apps/mobile/src/pose/PoseSkeleton.tsx`, `apps/mobile/src/pose/PoseDebugScreen.tsx`, `apps/mobile/src/pose/index.ts`
- Modify: `apps/mobile/App.tsx` (render `PoseDebugScreen` only)

**Interfaces:**
- Consumes: `createPoseDetector` (Task 4); `shouldProcess`, `jointToView` (Task 3); `PoseDetection`, `PoseResult`, `BONES` (Task 2); Vision Camera v5 `useFrameOutput`, `useCameraDevice`, `usePermission`, `Camera`; `scheduleOnRN` from `react-native-worklets`.
- Produces:
  ```ts
  export function usePoseOutput(opts: { size?: 320 | 256; maxFps?: number; onPose: (d: PoseDetection) => void }):
    { frameOutput: CameraFrameOutput; fps: number; error: string | null; model: string | null }
  export function PoseSkeleton(props: { result: PoseResult | undefined; imageSize: { width: number; height: number };
                                        viewSize: { width: number; height: number }; mirrored: boolean; fit: Fit }): JSX.Element | null
  // index.ts re-exports usePoseOutput, PoseSkeleton, types
  ```

- [ ] **Step 1: Hook.** Detector created in `useMemo` on `size`; creation error caught into `error`. `useFrameOutput({ pixelFormat: 'yuv', onFrame })`. Frame output mirror mode **off** (so `isMirrored` reflects only a physically mirrored buffer and joints stay anatomical). In `onFrame` (worklet): if `!shouldProcess(now, last, maxFps)` → `frame.dispose(); return`; else `try { const d = detector.detect(frame); scheduleOnRN(handle, d) } catch (e) { scheduleOnRN(handleError, String(e)) } finally { frame.dispose() }`. `fps` = processed results in the last 1000 ms, updated on the JS thread at most every 500 ms. Also count `onFrameDropped` events into a `dropped` value surfaced on the debug screen.
- [ ] **Step 2: Skeleton.** `react-native-svg`: a `Line` per `BONES` pair where both joints have `c ≥ 0.3`, a `Circle` r=4 per joint with `c ≥ 0.3`; points via `jointToView`. Returns `null` when `result` is undefined.
- [ ] **Step 3: Debug screen.** Full-screen `Camera` (preview resize mode cover → `fit: 'cover'`), `PoseSkeleton` overlay (`mirrored` = front camera), top readout: `fps`, `latencyMs` (1 decimal), `score` (2 decimals), `model`, dropped count; bottom button toggles front/back (default front). Error banner when `error` is set. Permission denied → message + button calling `Linking.openSettings()`. `imageSize` = upright frame size: use the frame output's resolution, swapping to portrait.
- [ ] **Step 4:** `npm run typecheck` clean; `npm test` all PASS.
- [ ] **Step 5:** Xcode build as in Task 4 Step 6 → `BUILD SUCCEEDED`.
- [ ] **Suggested commit:** `feat(pose): usePoseOutput hook and pose debug screen (#42)`

### Task 7: On-device verification and docs

**Files:**
- Create: `apps/mobile/README.md`
- Modify: `docs/pose/how-it-works.md` (append section "Running in the Expo app")

- [ ] **Step 1: Run on phone.** `npx expo run:ios --device --configuration Release` with the iPhone plugged in (free Apple ID signing, as PoseBench).
- [ ] **Step 2: Device checklist** (owner runs; record pass/fail for the PR):
  - Front camera, portrait: skeleton lines up with the body.
  - Raise real left arm: the dot for `left_wrist` (index 9) follows it. Log one `PoseResult` with `console.log` to confirm `joints[9].x` changes.
  - Back camera: skeleton lines up.
  - Readout shows fps ≥ 15 at 320 on iPhone 17 Pro Max; record mean latency. Repeat on an older iPhone if available.
  - Leave running 60 s: dropped count not climbing continuously; app stays responsive.
  - Walk out of frame: skeleton disappears (result undefined), no crash.
- [ ] **Step 3: README** (`apps/mobile/README.md`): prerequisites (Xcode 26, `brew install cocoapods`, free Apple ID, `uv`); five commands: `cd ml/pose_export && uv run export.py`, `cd apps/mobile && npm install`, `npx expo prebuild -p ios`, `npx expo run:ios --device`, `npm test`. One line on what the debug screen shows and that FE-01/FE-05 replace it.
- [ ] **Step 4: how-it-works.md** new section: frame path (Vision Camera v5 frame → `detect` → `ImageOrientation` → Vision `.scaleFit` → `PoseDecoder` → `scheduleOnRN` → `onPose`); why frames aren't rotated at capture (v5 delivers sensor orientation + flag); the 15 fps throttle drops frames rather than queueing; mirror mode off keeps left/right anatomical.
- [ ] **Step 5: PR notes draft** (in the final message to the owner, not a file): deviations (native code in `modules/`, PoseCore podspec + `ImageOrientation`), FE-01 stub note, suggested `Architecture.md` §4 edit "v4" → "v5 (Nitro frame-processor plugins)", device checklist results.
- [ ] **Suggested commit:** `docs(pose): Expo app setup and frame path (#42)`
