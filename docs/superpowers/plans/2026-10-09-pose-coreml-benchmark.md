# YOLOv8n-pose Core ML + PoseBench Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export YOLOv8n-pose to Core ML at 320 and 256 px and ship a SwiftUI app (PoseBench) that shows a live skeleton, latency and fps on an iPhone, and copies benchmark rows for the PR.

**Architecture:**
- A uv-managed Python script exports and verifies the two `.mlpackage` files and drops them into the app.
- Pure logic lives in a local Swift package, `PoseCore`: the pose contract, tensor decoding, benchmark math and overlay geometry. It is tested on macOS with `swift test`.
- The app target, generated with XcodeGen, holds only the camera, Vision/Core ML and SwiftUI code.

**Tech Stack:** Python 3.11, uv, ultralytics, coremltools, pytest · Swift 5.10+, SwiftUI, AVFoundation, Vision, Core ML, XcodeGen · Xcode 26.6, iOS 17+

**Spec:** `docs/superpowers/specs/2026-10-09-pose-coreml-benchmark-design.md`

## Global Constraints

- Everything for this issue lives in `ml/pose_export/` and `docs/pose/` (issue note: stay inside the area folder).
- iOS deployment target 17.0, iPhone only, portrait only.
- Model files are named `yolov8n-pose-320.mlpackage` and `yolov8n-pose-256.mlpackage`, FP16, exported with `nms=False`; `*.mlpackage` is gitignored.
- Raw output is `[1, 56, N]` with N = (s/8)² + (s/16)² + (s/32)²: 2100 at 320, 1344 at 256.
- Person threshold is 0.25. The live view is throttled to 15 fps. "Holds 15 fps" means p95 < 66.7 ms.
- Benchmark: 2 s warm-up (discarded), then 10 s of measurement counting only person-found frames, throttle off.
- Joints are 17, in COCO order, with x and y normalized 0–1 in the **upright, unmirrored** image, origin top-left.
- Video-data connection: `videoRotationAngle = 90`, `isVideoMirrored = false` for both cameras, so frames are upright and unmirrored and Vision orientation is always `.up`. Only the overlay mirrors, for the front camera. The default camera is front.
- Compute units are `.all`. Vision crop/scale is `.scaleFit` (centered padding).
- Python dependencies are locked by `uv.lock`; no version is pinned by hand beyond `requires-python = "==3.11.*"`.
- Bundle id `com.del0m.posebench`. `DEVELOPMENT_TEAM` is left empty; the user picks their free Apple ID team in Xcode.
- Phone model in result rows is the `utsname` machine identifier (e.g. `iPhone14,5`). Mapping it to a marketing name is out of scope.

## Review Focus

1. **Front camera left/right swapped.** Raising your right arm must move the joint on the same side as your hand in the mirrored preview. Pinned by `OverlayGeometryTests.testFrontCameraMirrorsX` (Task 5).
2. **FP16 or strided MLMultiArray read as garbage.** Core ML may return FP16 outputs or non-contiguous strides, and reading them naively draws a scrambled skeleton. Pinned by `MultiArrayReaderTests` (Task 4).
3. **Frame aspect other than 9:16.** A 3:4 session preset changes the padding, and the skeleton must still land on the body. Pinned by `PoseDecoderTests.testUndoesPaddingFor3x4Frame` (Task 2).
4. **Person walks out mid-benchmark.** The measurement timer must pause rather than average in empty frames or finish early. Pinned by `BenchmarkRunTests.testTimerPausesWithoutPerson` (Task 3).
5. **Fresh clone, export not run.** The app must launch, say "Run `uv run export.py` first" and disable that size, never crash. Pinned by `ModelLocatorTests.testMissingModelReportsError` (Task 4). `CoreMLPoseEstimator.init` locates models only through `ModelLocator`.

---

### Task 1: Export pipeline (Python)

**Files:**
- Create: `ml/pose_export/pyproject.toml`, `ml/pose_export/uv.lock` (generated), `ml/pose_export/export.py`, `ml/pose_export/tests/test_export.py`, `ml/pose_export/.gitignore`

**Interfaces:**
- Produces: `expected_candidates(imgsz: int) -> int`, `check_output(arr: np.ndarray, imgsz: int) -> None` (raises `ExportError`), `main() -> None`. Writes `PoseBench/PoseBench/Models/yolov8n-pose-{320,256}.mlpackage`.

- [ ] **Step 1: Create the uv project.** `pyproject.toml` has `requires-python = "==3.11.*"`, dependencies `ultralytics` and `coremltools`, and a dev group with `pytest`. `.gitignore` contains `*.pt`, `*.mlpackage`, `.venv/`, `__pycache__/`, `runs/`. Run `uv sync` in `ml/pose_export/`. Expected: `uv.lock` created, no errors.

- [ ] **Step 2: Write the failing tests** in `tests/test_export.py`:

```python
def test_expected_candidates():
    assert expected_candidates(320) == 2100
    assert expected_candidates(256) == 1344

def test_check_output_accepts_valid():
    arr = np.full((1, 56, 1344), 0.5, dtype=np.float32)
    check_output(arr, 256)  # no raise

def test_check_output_rejects_wrong_shape():
    with pytest.raises(ExportError):
        check_output(np.zeros((1, 56, 2100), np.float32), 256)

def test_check_output_rejects_confidence_out_of_range():
    arr = np.full((1, 56, 1344), 0.5, np.float32); arr[0, 4, 0] = 3.0
    with pytest.raises(ExportError):
        check_output(arr, 256)

def test_check_output_rejects_visibility_out_of_range():
    arr = np.full((1, 56, 1344), 0.5, np.float32); arr[0, 7, 0] = -2.0  # joint 0 visibility row
    with pytest.raises(ExportError):
        check_output(arr, 256)
```

- [ ] **Step 3: Run** `uv run pytest -v`. Expected: FAIL, import error.

- [ ] **Step 4: Implement `export.py`.** `check_output` asserts the shape `(1, 56, expected_candidates(imgsz))` and that row 4 and rows `7, 10, …, 55` (index `5 + 3k + 2`) are within [0, 1]. `main()` does the following for each size in (320, 256):
  - `YOLO("yolov8n-pose.pt").export(format="coreml", imgsz=s, half=True, nms=False)`
  - rename the result to `yolov8n-pose-{s}.mlpackage`
  - load it with `coremltools.models.MLModel` and confirm the image input is `s × s`
  - predict on Ultralytics' `ASSETS / "bus.jpg"`, resized to `s × s` with PIL
  - run `check_output` on the output
  - replace `PoseBench/PoseBench/Models/yolov8n-pose-{s}.mlpackage`
  - print the destination
  Paths resolve relative to `Path(__file__).parent`.

- [ ] **Step 5: Run** `uv run pytest -v`. Expected: 5 passed.

- [ ] **Step 6: Run the real export:** `uv run export.py`. Expected: two "wrote …/Models/yolov8n-pose-*.mlpackage" lines and no `ExportError`. If the range check fails, Ultralytics' output layout differs from the spec: stop and report, don't loosen the check.

- [ ] **Step 7: Commit** `pyproject.toml uv.lock export.py tests/ .gitignore` with message `feat(pose): Core ML export script with output verification (#41)`.

---

### Task 2: PoseCore package, contract and decoder

**Files:**
- Create: `ml/pose_export/PoseBench/PoseCore/Package.swift`, `Sources/PoseCore/PoseResult.swift`, `Sources/PoseCore/PoseDecoder.swift`, `Tests/PoseCoreTests/PoseDecoderTests.swift`, `docs/pose/pose-result-contract.md`

**Interfaces:**
- Produces:

```swift
public struct Joint: Equatable, Codable, Sendable { public let x: Float; public let y: Float; public let c: Float }
public enum PoseSource: String, Codable, Sendable { case coreml, cloud }
public struct PoseResult: Equatable, Codable, Sendable {
    public static let jointNames: [String]          // 17, COCO order (spec §6)
    public let source: PoseSource; public let model: String
    public let timestampMs: Int64                     // JSON key "timestamp_ms"
    public let score: Float; public let joints: [Joint]
}
public enum PoseDecoder {
    public static let minScore: Float = 0.25
    /// output: flat row-major [56][n]. frameWidth/Height: upright (post-orientation) image size.
    public static func decode(output: [Float], candidates n: Int, inputSize: Int,
                              frameWidth: Int, frameHeight: Int,
                              model: String, timestampMs: Int64) -> PoseResult?
}
```

- [ ] **Step 1: Create `Package.swift`.** swift-tools-version 5.10, platforms `.iOS(.v17), .macOS(.v14)`, library `PoseCore`, test target `PoseCoreTests`.

- [ ] **Step 2: Write the failing tests.** A helper `makeOutput(n:, best:, score:, kpt:)` fills a `[Float](repeating: 0, count: 56*n)` and sets column `best`'s row 4 to `score` and its keypoint rows to `kpt`, given in input pixels.
  - `testPicksMostConfidentCandidate`: two candidates with scores 0.6 and 0.9. The result's `score == 0.9` and its joints come from the 0.9 column.
  - `testReturnsNilBelowThreshold`: best score 0.2 gives `nil`.
  - `testAlways17JointsInCocoOrder`: `joints.count == 17`, `PoseResult.jointNames.first == "nose"`, `.last == "right_ankle"`.
  - `testUndoesPaddingFor9x16Frame`: input 256, frame 1080×1920. Content is 144×256, padX = 56. A keypoint at input (56, 0) gives (0, 0); at (200, 256) gives (1, 1); at (128, 128) gives (0.5, 0.5).
  - `testUndoesPaddingFor3x4Frame`: input 320, frame 1080×1440. Content is 240×320, padX = 40. A keypoint at (160, 160) gives (0.5, 0.5); at (40, 0) gives (0, 0).
  - `testClampsToUnitRange`: a keypoint at input (0, 0) in the 9:16 case (inside the padding) gives x = 0, not negative.
  - `testJSONUsesSnakeCaseTimestamp`: encoding a result contains `"timestamp_ms"` and `"source":"coreml"`.

- [ ] **Step 3: Run** `swift test` in `PoseCore/`. Expected: compile failure, types missing.

- [ ] **Step 4: Implement `PoseResult` and `PoseDecoder.decode`.**
  - Value at row r, column i is `output[r * n + i]`.
  - Padding is undone like this:

```
scale    = Float(inputSize) / Float(max(frameWidth, frameHeight))
contentW = Float(frameWidth)  * scale;  padX = (Float(inputSize) - contentW) / 2
contentH = Float(frameHeight) * scale;  padY = (Float(inputSize) - contentH) / 2
x = clamp((px - padX) / contentW, 0, 1);  y = clamp((py - padY) / contentH, 0, 1)
```

  - Joint k reads rows `5+3k` (x), `6+3k` (y) and `7+3k` (c).
  - `source` is `.coreml`.

- [ ] **Step 5: Run** `swift test`. Expected: all PoseDecoderTests pass.

- [ ] **Step 6: Write `docs/pose/pose-result-contract.md`.** Include:
  - the JSON example and field rules from spec §6, copied verbatim
  - the 17 joint names in order
  - "no person means `null`"
  - an **"Open for CONN-11"** list: transport (WebSocket per Architecture §4.1), frame encoding (JPEG ~320 px, ~10 fps), auth, and `source: "cloud"`
  - a note that a server running Ultralytics can map `results[0].keypoints.xyn` and `.conf` directly onto `joints`

- [ ] **Step 7: Commit** with message `feat(pose): PoseCore contract and decoder with tests (#41)`.

---

### Task 3: Benchmark math and run timing

**Files:**
- Create: `PoseCore/Sources/PoseCore/Benchmark.swift`, `PoseCore/Tests/PoseCoreTests/BenchmarkTests.swift`

**Interfaces:**
- Produces:

```swift
public struct BenchmarkStats: Equatable, Sendable {
    public let size: Int; public let meanMs: Double; public let p95Ms: Double
    public var maxFps: Double { 1000 / meanMs }
    public var holds15fps: Bool { p95Ms < 66.7 }
}
public enum BenchmarkMath {
    public static func stats(size: Int, latenciesMs: [Double]) -> BenchmarkStats?   // nil if empty
    public static let tableHeader: String  // "| Phone | iOS | Size | Mean ms | p95 ms | Max fps | Holds 15 fps |\n|---|---|---|---|---|---|---|"
    public static func markdownRow(_ s: BenchmarkStats, device: String, os: String) -> String
}
public struct BenchmarkRun {
    public enum Phase: Equatable { case warmingUp, measuring, done }
    public init(size: Int, warmUp: TimeInterval = 2, measure: TimeInterval = 10)
    public private(set) var phase: Phase
    public mutating func record(latencyMs: Double, personFound: Bool, at time: TimeInterval)
    public var stats: BenchmarkStats? { get }   // non-nil once .done
}
```

- [ ] **Step 1: Write the failing tests.**
  - `testMeanAndP95`: latencies `1…20` (as Double) give mean 10.5 and p95 19. p95 uses nearest rank: `sorted[ceil(0.95·n) − 1]`.
  - `testHolds15fpsBoundary`: p95 66.6 gives true; 66.7 gives false.
  - `testMarkdownRow`: mean 6.24, p95 8.91, size 256, device `iPhone14,5`, os `iOS 26.1` give exactly `| iPhone14,5 | iOS 26.1 | 256 | 6.2 | 8.9 | 160 | ✅ |`. Max fps is rounded to an integer, and ❌ is used when it does not hold.
  - `testWarmUpDiscarded`: frames at t = 0…1.9 are not counted. The phase is `.measuring` at t ≥ 2.
  - `testTimerPausesWithoutPerson`: person frames every 0.1 s from t = 2–7, no-person frames from t = 7–20, then person frames from t = 20–25.1. The run is `.done` only after the person frames resume, and its stats include only person-found latencies.
  - `testEmptyStatsIsNil`: `stats(size:latenciesMs: [])` is `nil`.

- [ ] **Step 2: Run** `swift test`. Expected: compile failure.

- [ ] **Step 3: Implement.**
  - Warm-up is measured in wall-clock time from the first `record` call.
  - Measured time accumulates `time − previousTime` only when both the current and previous frames had a person.
  - Latencies are appended only for person-found frames during `.measuring`.
  - The phase becomes `.done` when the accumulated time reaches `measure`.

- [ ] **Step 4: Run** `swift test`. Expected: all tests pass.

- [ ] **Step 5: Commit** with message `feat(pose): benchmark stats and run timing (#41)`.

---

### Task 4: Reading Core ML output and locating models

**Files:**
- Create: `PoseCore/Sources/PoseCore/MultiArrayReader.swift`, `PoseCore/Sources/PoseCore/ModelLocator.swift`, `PoseCore/Tests/PoseCoreTests/MultiArrayReaderTests.swift`, `PoseCore/Tests/PoseCoreTests/ModelLocatorTests.swift`

**Interfaces:**
- Produces:

```swift
public enum MultiArrayReader {
    /// Flattens a [1, 56, n] MLMultiArray (float16 or float32, any strides) to row-major [56][n].
    public static func floats(_ a: MLMultiArray) throws -> [Float]   // throws PoseError.badOutput
}
public enum PoseError: Error, Equatable { case modelMissing(String), badOutput(String) }
public enum ModelLocator {
    public static func modelName(size: Int) -> String               // "yolov8n-pose-\(size)"
    /// Finds the compiled model ("<name>.mlmodelc") in the bundle.
    public static func url(size: Int, in bundle: Bundle) throws -> URL  // throws .modelMissing(name)
}
```

- [ ] **Step 1: Write the failing tests.**
  - `testReadsFloat32Contiguous`: a `[1, 56, 3]` float32 array with value `r*10 + i` gives the flat array with the same values.
  - `testReadsFloat16`: the same data in `.float16` gives values equal within 0.01.
  - `testReadsCustomStrides`: build with `MLMultiArray(dataPointer:shape:dataType:strides:deallocator:)` using padded strides `[56*8, 8, 1]` for shape `[1, 56, 3]`. The output must equal the contiguous case.
  - `testRejectsWrongRank`: a `[56, 3]` array throws `.badOutput`.
  - `ModelLocatorTests.testMissingModelReportsError`: `url(size: 320, in: Bundle(for: …test class…))` throws `.modelMissing("yolov8n-pose-320")`.

- [ ] **Step 2: Run** `swift test`. Expected: compile failure.

- [ ] **Step 3: Implement.** Index each element with `a.strides`. Read `.float16` through `UnsafePointer<Float16>`. Read `.float32` directly. Throw on other data types.

- [ ] **Step 4: Run** `swift test`. Expected: all tests pass.

- [ ] **Step 5: Commit** with message `feat(pose): MLMultiArray reader and model locator (#41)`.

---

### Task 5: The app (camera, estimator, overlay, UI)

**Files:**
- Create: `PoseCore/Sources/PoseCore/OverlayGeometry.swift`, `PoseCore/Tests/PoseCoreTests/OverlayGeometryTests.swift`, `PoseBench/project.yml`, `PoseBench/PoseBench/Models/.gitkeep`, `PoseBench/PoseBench/PoseEstimator.swift`, `PoseBench/PoseBench/CameraFeed.swift`, `PoseBench/PoseBench/PoseBenchModel.swift`, `PoseBench/PoseBench/ContentView.swift`, `PoseBench/PoseBench/PoseBenchApp.swift`, `PoseBench/PoseBench.xcodeproj` (generated), `docs/pose/how-it-works.md`

**Interfaces:**
- Consumes: everything in Tasks 2–4.
- Produces:

```swift
// PoseCore
public enum OverlayGeometry {
    /// Maps a normalized joint into a view showing the image with aspect-fit; mirrors x for the front camera.
    public static func point(_ j: Joint, imageSize: CGSize, viewSize: CGSize, mirrored: Bool) -> CGPoint
    public static let bones: [(Int, Int)]   // COCO skeleton pairs by joint index
}
// App
/// The seam for cloud offloading: a later RemotePoseEstimator (CONN-11) conforms to this.
protocol PoseEstimating: AnyObject {
    var modelName: String { get }
    /// buffer is upright and unmirrored.
    func estimate(_ buffer: CVPixelBuffer, timestampMs: Int64) throws -> (result: PoseResult?, latencyMs: Double)
}
final class CoreMLPoseEstimator: PoseEstimating { init(size: Int) throws }   // throws PoseError.modelMissing or the Core ML load error
final class CameraFeed { var position: AVCaptureDevice.Position; var minFrameInterval: TimeInterval
                         var onFrame: ((CVPixelBuffer) -> Void)? }
```

- [ ] **Step 1: Write the failing tests** in `OverlayGeometryTests`. Use image 1080×1920 and view 390×844. The aspect-fit rect is width 390, height 693.3, offsetY 75.3.
  - `testBackCameraCenter`: (0.5, 0.5) gives (195, 422).
  - `testBackCameraTopLeft`: (0, 0) gives (0, 75.3) within 0.1.
  - `testFrontCameraMirrorsX`: (0.2, 0.5) with `mirrored: true` gives x = 390 × 0.8 = 312.
  - `testBonesReferenceValidJoints`: every index is in 0..<17.

- [ ] **Step 2: Run** `swift test`, then implement `OverlayGeometry`, then run `swift test` again. Expected: fail, then pass.

- [ ] **Step 3: Write `project.yml`.**
  - App target `PoseBench` (iOS 17.0, iPhone only, portrait only), sources `PoseBench/`, local package dependency `PoseCore` at path `PoseCore`.
  - Info.plist keys: `NSCameraUsageDescription` = "PoseBench uses the camera to test the pose model on this phone. Video never leaves the device.", `UISupportedInterfaceOrientations` = portrait.
  - `PRODUCT_BUNDLE_IDENTIFIER: com.del0m.posebench`, `DEVELOPMENT_TEAM: ""`.
  - Install XcodeGen with `brew install xcodegen`, then run `xcodegen generate` in `PoseBench/`. Expected: `PoseBench.xcodeproj` created.

- [ ] **Step 4: Implement the app files.**
  - **`CoreMLPoseEstimator`:**
    - `MLModelConfiguration.computeUnits = .all`
    - `VNCoreMLRequest` with `imageCropAndScaleOption = .scaleFit`, run synchronously with `VNImageRequestHandler(cvPixelBuffer:orientation: .up)`
    - latency is measured with `CACurrentMediaTime()` around `perform` plus decode
    - the output is `MultiArrayReader.floats`, then `PoseDecoder.decode`
    - the frame size is the buffer's own width and height, which are already upright
  - **`CameraFeed`:**
    - session preset `.hd1280x720`, `alwaysDiscardsLateVideoFrames = true`
    - frames are delivered on a serial queue, and dropped when less than `minFrameInterval` has passed since the last accepted frame
    - the video-data output's connection gets `videoRotationAngle = 90` and `isVideoMirrored = false`, re-applied after every camera switch
    - switching cameras reconfigures the session inside `beginConfiguration` and `commitConfiguration`
  - **`PoseBenchModel` (`@MainActor ObservableObject`):**
    - holds the estimator as `any PoseEstimating`, never the concrete class (spec §3)
    - a Core ML load error, as opposed to a missing model, shows its `localizedDescription` on screen
    - published state: size, camera position, latest `PoseResult?`, latency, effective fps (frames accepted per second over a 1 s window), the error message, available sizes (those whose `CoreMLPoseEstimator.init` didn't throw), benchmark state and the copy-ready rows
    - "Run benchmark" sets `minFrameInterval = 0`, runs a `BenchmarkRun` for 320 then 256 by swapping estimators, then restores `1.0/15`
    - it cancels on `scenePhase != .active`
    - the device identifier comes from `utsname().machine`, and the OS string is `"iOS \(UIDevice.current.systemVersion)"`
    - "Copy row" writes `tableHeader + rows` to `UIPasteboard.general.string`
  - **`ContentView`:**
    - an `AVCaptureVideoPreviewLayer` wrapper with `videoGravity = .resizeAspect`, plus a `Canvas` overlay drawing `OverlayGeometry.bones` and joints with `c ≥ 0.3`
    - top readout: size · ms · fps, or "no person"
    - a bottom bar with the 320/256 segmented picker (missing sizes disabled), the camera flip button, "Run benchmark", and "Copy row" (enabled when rows exist)
    - full-screen messages for camera denied (with a Settings button) and for missing models ("Run `uv run export.py` first")

- [ ] **Step 5: Build for device without signing.** Run `xcodebuild -project PoseBench.xcodeproj -scheme PoseBench -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`. Expected: `** BUILD SUCCEEDED **`, with the two models compiled into `.mlmodelc` in the build log.

- [ ] **Step 6: Write `docs/pose/how-it-works.md`.** Cover:
  - the end-to-end path (export → `.mlpackage` → Xcode compiles to `.mlmodelc` → Vision `.scaleFit` → `[1, 56, N]` → decode)
  - the 56-row tensor layout table, and why N is 2100 or 1344
  - the padding-undo formula, step by step, so CONN-11 can mirror it in Python
  - orientation and mirroring: why frames are rotated and unmirrored at capture (anatomical left/right), and why only the overlay mirrors
  - why there's no NMS (one person)
  - FP16 and strides in `MultiArrayReader`
  - how to check Neural Engine placement in Xcode: open the `.mlpackage` → Performance → run a report on the connected phone
  - which files AI-02 should reuse (`PoseCore` as-is, the logic of `CoreMLPoseEstimator`)

- [ ] **Step 7: Commit** with message `feat(pose): PoseBench app with live skeleton and benchmark (#41)`. Include `project.yml`, the generated `.xcodeproj`, the app sources, the OverlayGeometry files and the doc. Don't commit models.

---

### Task 6: README, on-phone run and results

**Files:**
- Create: `ml/pose_export/README.md`, `docs/pose/benchmark-results.md`

- [ ] **Step 1: Write `ml/pose_export/README.md`.** Keep it to roughly 6 steps:
  - `uv run export.py`
  - open `PoseBench/PoseBench.xcodeproj`
  - Signing & Capabilities → Team → your Apple ID (Personal Team); change the bundle id if it's taken
  - plug in the phone, turn on Developer Mode on the phone, and press Run
  - on the phone: Settings → General → VPN & Device Management → trust the developer
  - press "Run benchmark", then "Copy row"
  Also note the 7-day expiry and the 3-app limit for free accounts, and link `docs/pose/how-it-works.md`.

- [ ] **Step 2: The user runs it on their phone** (manual, done with the user):
  - the skeleton follows the body on the front and back cameras
  - on the front camera, raising your right arm moves the overlay arm on the same side as in the preview
  - left/right labels are anatomically correct: temporarily color `right_wrist` red and confirm it sits on your real right hand on both cameras (revert after)
  - the 320/256 toggle switches models
  - a benchmark run completes and "Copy row" pastes two rows

- [ ] **Step 3: Write `docs/pose/benchmark-results.md`.** Include:
  - the pasted table
  - the date and app commit
  - a conclusion: which size to ship by default, whether both hold 15 fps, and the headroom (15 ÷ max fps as a share of the phone's capacity)
  - a note on what it means for AI-04's 12 fps threshold
  - Neural Engine placement from the Xcode Performance report, if checked

- [ ] **Step 4: Commit** with message `docs(pose): README and benchmark results (#41)`, then open the PR with the table in the description. The PR is created only after the user confirms.
