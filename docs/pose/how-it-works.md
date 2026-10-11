# How on-device pose works

How a camera frame becomes 17 joints on the phone, in the PoseBench test app (issue #41). The same pipeline goes into the real app through the vision-camera frame-processor plugin (AI-02), so this is written to be reused.

For the output format, see [pose-result-contract.md](pose-result-contract.md). For measured numbers, see [benchmark-results.md](benchmark-results.md).

## The path

```
yolov8n-pose.pt
  │  export.py: Ultralytics → Core ML, FP16, no NMS, at 320 and 256 px
  ▼
yolov8n-pose-{320,256}.mlpackage          (PoseBench/PoseBench/Models/, gitignored)
  │  Xcode compiles each into .mlmodelc at build time
  ▼
Camera (720p, upright, unmirrored)
  │  throttled to 15 fps: late frames are dropped, never queued
  ▼
Vision VNCoreMLRequest, .scaleFit  → letterboxes the frame into a square with centered padding
  │  Core ML runs the model, compute units .all (Neural Engine when it can)
  ▼
raw output [1, 56, N]
  │  MultiArrayReader: handles FP16 and padded strides → flat [56][N] floats
  ▼
PoseDecoder: pick the best candidate → undo padding → normalize
  ▼
PoseResult (17 joints, 0–1 coordinates) → overlay, and later the rep rules
```

| File | Job |
|---|---|
| `ml/pose_export/export.py` | Export and verify both sizes, copy them into the app |
| `PoseCore/PoseResult.swift` | The contract |
| `PoseCore/PoseDecoder.swift` | Raw tensor → `PoseResult`. A pure function. |
| `PoseCore/MultiArrayReader.swift` | `MLMultiArray` → `[Float]` |
| `PoseCore/ModelLocator.swift` | Finds the compiled models in the app bundle |
| `PoseCore/Benchmark.swift` | Stats, benchmark timing, markdown rows |
| `PoseCore/OverlayGeometry.swift` | Joint → screen point, including front-camera mirroring |
| `PoseCore/FrameProcessor.swift` | `PoseEstimating` protocol (the cloud seam) plus per-frame inference and benchmark bookkeeping |
| `PoseBench/PoseEstimator.swift` | The Vision/Core ML implementation of `PoseEstimating` |
| `PoseBench/CameraFeed.swift` | Capture session, rotation, throttle |
| `PoseBench/PoseBenchModel.swift` | Wires camera, processor and UI state together |
| `PoseBench/ContentView.swift` | Preview, skeleton, readout, controls |

Everything in `PoseCore` is plain Swift with tests that run on a Mac (`swift test` in `PoseCore/`), no phone or simulator needed.

## The raw output

YOLOv8n-pose looks at the image at three scales (strides 8, 16 and 32 pixels). Each grid cell at each scale proposes one candidate person:

| Input | Grid cells | N (candidates) |
|---|---|---|
| 320 px | 40² + 20² + 10² | 2100 |
| 256 px | 32² + 16² + 8² | 1344 |

Each candidate is one column of 56 numbers:

| Rows | Meaning | Units |
|---|---|---|
| 0–3 | Box centre x, centre y, width, height | input pixels |
| 4 | Person confidence | 0–1 |
| 5 + 3k | Joint k, x | input pixels |
| 6 + 3k | Joint k, y | input pixels |
| 7 + 3k | Joint k, visibility | 0–1 |

Joint k follows COCO order (k = 0 is the nose, k = 16 the right ankle).

The confidence and visibility values come out of the exported model already squashed to 0–1. `export.py` checks this on a real image after every export, so if a future Ultralytics version changes it, the export fails instead of the skeleton silently going wrong.

## Decoding, step by step

This is what `PoseDecoder.decode` does. A server running the raw model should do the same.

1. **Pick one person.** Take the column with the highest row-4 value. SteadyForum tracks one lifter, so there's no need for non-maximum suppression (the usual step that merges overlapping detections of several people).
2. **Threshold.** If that confidence is below **0.25**, there's no person: return nothing.
3. **Undo the letterbox.** Vision's `.scaleFit` shrank the frame to fit inside the square input and padded the rest equally on both sides. With frame size `W × H` and input size `S`:

   ```
   scale    = S / max(W, H)
   contentW = W × scale        padX = (S − contentW) / 2
   contentH = H × scale        padY = (S − contentH) / 2
   x = clamp((px − padX) / contentW, 0, 1)
   y = clamp((py − padY) / contentH, 0, 1)
   ```

   Example: a 720 × 1280 portrait frame into 256. The scale is 0.2, the content is 144 × 256, and there are 56 px of padding on the left and right. A joint at input x = 128 maps to (128 − 56) / 144 = 0.5, the middle of the frame.
4. **Build the result.** 17 joints with x, y and visibility as `c`, plus the person confidence as `score`.

## Orientation and mirroring

The camera sensor is landscape, and the front camera's preview is mirrored like a mirror. Two rules keep this simple:

- **Frames are fixed at capture.** `CameraFeed` sets the video connection's `videoRotationAngle` and `isVideoMirrored = false` for both cameras. Every frame the model sees is upright and unmirrored, so Vision always gets orientation `.up`.
- **The angle comes from `AVCaptureDevice.RotationCoordinator`, never a constant.** Each camera is mounted at its own angle. On an iPhone 17 Pro Max (iOS 26.6) the logs show the back camera needs **90°** but the new square front sensor needs **0°**. A hardcoded 90° turned the front image on its side. The coordinator also gives the preview layer its angle, which is re-applied after every camera switch, because a switch rebuilds the preview connection. `CameraFeed` logs both angles and the first frame size under the `camera` category, which is handy when a new phone behaves differently.
- **Why unmirrored matters:** the model decides left and right from how the body looks. In a mirrored image the lifter's real right knee looks like a left knee, and it would be labelled `left_knee`. The form rules care which knee caves in, so the contract requires anatomical left and right.
- **Only the drawing mirrors.** The front-camera preview is mirrored, which feels natural for selfies, so `OverlayGeometry` flips x for the front camera. That keeps the drawn dot on top of the hand you see. The joint data itself is never flipped.

AI-02 needs the same rule: rotate and un-mirror before inference, and mirror only in the UI.

## Core ML output quirks

`MultiArrayReader` exists because Core ML's output array isn't guaranteed to be a plain float buffer:

- It may be **FP16** (half precision) rather than FP32, depending on the model and device.
- Its **strides** may include padding, meaning rows are longer in memory than they are logically, for alignment. Reading it as a dense array scrambles the joints.

The reader indexes every element through the array's strides and converts to `Float`. Tests cover FP32, FP16 and padded strides.

## Is it actually on the Neural Engine?

Compute units `.all` *allows* the Neural Engine. Core ML still decides per layer and may run some layers on the GPU or CPU. To see the actual placement:

1. Open `ml/pose_export/PoseBench/PoseBench/Models/yolov8n-pose-320.mlpackage` in Xcode.
2. Go to the **Performance** tab, then the **+** button, pick your connected iPhone, and run the report.
3. The report shows the median prediction time and which compute unit each layer ran on.

That number covers the model alone. PoseBench's latency also includes Vision's resize and our decode, the real per-frame cost.

## Benchmark method

"Run benchmark" in PoseBench (the shared scheme's Run action builds **Release**, because unoptimized Debug code would inflate the decode part of the latency):

1. Turns the 15 fps throttle off, so we measure the ceiling, not the cap.
2. For each size: 2 s warm-up, discarded, because the first Core ML calls are slow while the model loads onto the Neural Engine. Then 10 s of measurement.
3. The measurement clock only runs while a person is in frame, because the decode path is only fully exercised with a person. Walking out pauses it.
4. Latency is the time from handing the frame to Vision until the decoded `PoseResult` returns.
5. It reports mean and p95 (95th percentile, nearest-rank) latency, max fps (1000 ÷ mean), and **holds 15 fps** (p95 < 66.7 ms, the time budget per frame at 15 fps).

## Reusing this in the real app (AI-02)

- **`PoseCore` as-is:** add it as a local Swift package to the Expo iOS project. It's pure Swift, with no app or UI code.
- **The `CoreMLPoseEstimator` logic:** the frame-processor plugin receives a `CVPixelBuffer` per frame, which is exactly what `estimate` takes. Copy the class, or move it into `PoseCore` if both need it.
- **The capture rule:** configure vision-camera for portrait, unmirrored frames (or rotate before inference), and mirror only in the overlay.
- **The `PoseEstimating` protocol** (in `PoseCore`): the seam where a cloud estimator for Android and slow iPhones (CONN-11) plugs in.

## Running in the Expo app

Issue #42 runs this pipeline in `apps/mobile`, an Expo 57 dev build with Vision Camera v5 and a local Nitro plugin. Setup: [apps/mobile/README.md](../../apps/mobile/README.md). The app consumes the same PoseCore sources as a local CocoaPod; the Swift-package suggestion above was the earlier integration outline.

At prebuild, `withPoseModels` copies both `.mlpackage` files from PoseBench's `Models/` folder into the generated iOS project. Xcode compiles them into the app bundle. If either model is missing, prebuild stops with the instruction to run `uv run export.py` in `ml/pose_export`.

One processed frame follows this path:

1. **Vision Camera v5 → worklet.** `usePoseOutput` receives a frame in sensor orientation, with `orientation` and `isMirrored` flags.
2. **`detect` → `ImageOrientation`.** The hook binds its frame output to `HybridPoseDetector` before frame callbacks start. The detector takes the native pixel buffer and the output's active capture connection. `ImageOrientation.vision` uses native rotation angles plus `isMirrored` to produce a Vision orientation and upright frame size. Quarter-turn corrections swap width and height before decode.
3. **Vision → Core ML.** `VNImageRequestHandler` receives the buffer and orientation. The `.scaleFit` request letterboxes it; compute units `.all` allow Core ML to use the Neural Engine.
4. **`MultiArrayReader` → `PoseDecoder`.** The decoder selects one person, removes letterbox padding, and returns 17 normalized joints with confidence. The plugin returns `PoseDetection` with `result` and `latencyMs`. `FrameTimestamp` converts the sample buffer's capture timestamp to Unix milliseconds using the host-clock offset, so processing delay is not added to `timestamp_ms`. No person means `result` is `undefined`.
5. **`scheduleOnRN` → `onPose`.** The worklet schedules the detection on the JS thread. Its `finally` block disposes the processed frame, including when inference throws. The JS callback updates the screen; per-frame errors are reported without stopping the stream.

Unlike PoseBench's capture path above, this app does not request physical buffer rotation at capture. Vision Camera v5 supplies orientation and mirror metadata. The detector reads the capture connection's actual `videoRotationAngle`, rather than assuming the reported quarter-turn flag matches the sensor's mounting. It passes the remaining correction to Vision, avoiding an extra buffer rotation. The screen uses `orientationSource="interface"` in the portrait app.

Front and back cameras do not necessarily share a sensor mounting or connection angle. The detector creates a detached reference connection from the active camera's input ports. Asking AVFoundation to orient that reference to the output's target gives the required angle for that camera. The reference is never added to a session and never processes frames. Only the difference between its angle and the live connection's angle is sent to Vision. A camera switch rebuilds the reference; no front/back-specific 90° constant or global flag swap is used. The reference uses the legacy `videoOrientation` setter for the interface target, then reads `videoRotationAngle`; it does not change the live connection. See [AVFoundation capture connections](https://developer.apple.com/documentation/avfoundation/avcaptureconnection) and [video rotation angles](https://developer.apple.com/documentation/avfoundation/avcaptureconnection/videorotationangle).

EXIF `.right` corrects counter-clockwise-rotated pixels; `.left` corrects clockwise-rotated pixels. Mirrored quarter-turns also flip horizontally after correction. Tests check actual landmark positions for all eight combinations, plus camera-specific angle differences and already-rotated buffers. See [Apple's EXIF right orientation](https://developer.apple.com/documentation/imageio/cgimagepropertyorientation/right) and [mirrored right orientation](https://developer.apple.com/documentation/imageio/cgimagepropertyorientation/rightmirrored).

**Throttle and drops:** `usePoseOutput` keeps the last processed frame time in a `createSynchronizable` value shared with the worklet. With the default `maxFps = 15`, frames arriving less than `1000 / 15` ms later are disposed immediately. A 0.001 ms tolerance prevents floating-point rounding from skipping a frame exactly on the boundary. A restarted camera timestamp resets the throttle. Frames are never queued. The hook sets Vision Camera's `dropFramesWhileBusy` to `true`, so it also drops incoming frames while the processor is busy. The fps readout counts successful detections delivered to JS in the last second, including frames with no person. The dropped readout counts camera-pipeline drops, not throttle skips.

**Mirroring:** the camera uses `mirrorMode="off"`, keeping inference input unmirrored and left/right anatomical. For the front camera, the preview alone is flipped with `scaleX: -1`, and the skeleton receives `mirrored = true` to flip its drawn x coordinates. The returned joints are unchanged. See [pose-result-contract.md](pose-result-contract.md) for coordinates and COCO joint order.

## Basic mode (Apple Vision)

Basic mode is a manual, iPhone-only option that uses Apple Vision body pose instead of YOLOv8n-pose (Architecture §4.1).

- **Same frame path.** It uses the same Vision Camera frame output, throttle and `ImageOrientation` calibration as the Core ML detector.
- **Different request.** `VNDetectHumanBodyPoseRequest` replaces `VNCoreMLRequest`. There is no square model input, so there is no letterbox to undo.
- **Same result.** `VisionPoseMapper` converts Vision's points to a `PoseResult` with `source = "vision"`. The joint mapping, y flip and score rule are in [pose-result-contract.md](pose-result-contract.md#apple-vision-mapping).
- **JS entry.** `useBasicPoseOutput` in `src/pose/basic.ts`, or `usePoseOutput({ engine: 'vision' })`. Both call `createBasicPoseDetector()` from `steadyforum-pose`, backed by the native `HybridBasicPoseDetector`. Both detectors share `PoseFrameReader` for orientation and timestamps.
- **Debug screen.** A Core ML / Vision toggle switches detectors on the same camera feed.

## In-app benchmark and mode selection (AI-04)

On first launch an iPhone measures YOLOv8n-pose and picks a pose mode (Architecture §4.1). Unlike PoseBench's 10 s camera run above, this check is short, silent and needs no camera.

- **Native loop.** `benchmarkPoseModel(size, warmUpMs, measureMs)` on the `steadyforum-pose` factory runs on a serial background queue and returns a promise.
  - It builds one mid-gray 1080×1920 frame in the camera's own pixel format (`420f`), so Vision does the same conversion and scaling as on a live frame.
  - It runs `PoseModelRunner`, the same model, request and decode code as the live `HybridPoseDetector`.
  - The first inference pays for Core ML's lazy model load and is never counted.
  - PoseCore's `TimedBenchmark` then discards 0.5 s of warm-up and measures for 1.5 s, and `BenchmarkMath.stats` gives the mean and p95.
  - The gray frame has no person, but the decoder still scans every candidate, so the decode cost is representative.
- **Pass mark.** `benchmark.ts` computes sustained fps as 1000 ÷ p95, so slow frames count. It tries 320 px first, then 256 px if 320 falls under `MIN_ON_DEVICE_FPS` (12). The live detector uses the size that passed.
  - If neither size passes, the result keeps the best fps and `size` is null, so `selectPoseMode` chooses cloud.
  - If the model fails to load, `fps` is null with the error message.
- **Cache.** `modeStore.ts` keeps the result, the user's preference and cloud consent in MMKV (`id: 'pose'`). The cached result is tagged with `poseModelId()`.
  - The id is each bundled model's name plus the export timestamp that Ultralytics writes into the Core ML metadata (`date`), for example `yolov8n-pose-320@2026-10-10T00:32:02…+yolov8n-pose-256@…`.
  - It is read from the compiled model's `metadata.json` without loading the model. If that file is missing, it falls back to the Core ML model description.
  - A re-export or downloaded model changes the id, and the next launch benchmarks again. Otherwise the benchmark only runs again when the user asks.
- **Hook.** `startPoseBenchmark()` runs once from `App.tsx`. `usePoseMode()` returns the mode, which is `pending` until a result exists unless the user picked Apple Vision, plus:
  - the benchmark and the size to use
  - `needsCloudConsent`, which FE-15 uses to show its prompt. It is true when the phone would use cloud with consent and signal (a slow iPhone, Android, or a user who picked cloud) but has no consent yet.
  - setters for the preference and consent
  - `rerunBenchmark()` for settings
  
  Until CONN-11, `cloudReachable` is stubbed to `false`.
- **Debug screen.** It shows the mode, the benchmark and consent, and has a "Re-run benchmark" button and a consent toggle. The camera unmounts while the benchmark runs, so the live detector doesn't compete for the Neural Engine.
