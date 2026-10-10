Closes #44.

On first launch, an iPhone now benchmarks YOLOv8n-pose for about 2 s per input size, on a synthetic frame. It caches the result and picks the pose mode from it.

- **12+ sustained fps:** on-device `coreml`.
- **Slower:** cloud, and the app flags that it needs consent for FE-15's prompt.
- **Re-run:** the benchmark can be run again on request. The debug screen stands in for settings.

Branched from AI-03 (`ai-03-basic-mode-vision`), which should merge first.

## How the mode is picked

| Situation | Result |
|---|---|
| iPhone, 320 px holds 12+ sustained fps | `coreml` at 320 |
| iPhone, 320 is too slow but 256 holds 12+ | `coreml` at 256 |
| iPhone, neither size passes, or the model fails to load | cloud; `needsCloudConsent` until the user agrees |
| Android | cloud, with no benchmark |
| User picked Apple Vision | `vision`, without waiting for the benchmark |
| Before the first result | `pending` |

- **Sustained fps** is 1000 ÷ p95 latency, so slow frames count. The bar is `MIN_ON_DEVICE_FPS` (12).
- **Caching:** the result is cached in MMKV with the user's preference and cloud consent.
- **When it runs again:** only when the bundled model's id changes, meaning a new export or a downloaded model, or when the user re-runs it.

## Changes

- **PoseCore:** `TimedBenchmark` is a pure timing loop with an injected clock. It discards the warm-up results and returns the measured latencies, with at least one sample. The stats come from the existing `BenchmarkMath`.
- **Native module (`spotter-pose`):**
  - **`PoseModelRunner`:** model loading, the Vision request and decoding moved here out of `HybridPoseDetector`. The live detector and the benchmark now time exactly the same path, and the detector's behaviour is unchanged.
  - **`benchmarkPoseModel(size, warmUpMs, measureMs)`:** returns a promise and runs on a serial background queue.
    - It uses a mid-gray 1080×1920 `420f` frame, the camera's own format.
    - The first inference (model load) is discarded, then 0.5 s of warm-up, then 1.5 s is measured.
    - A missing model or a load failure rejects with the error message.
  - **`poseModelId()`:** returns `<model>@<export date>` for each size. The date is the `date` that Ultralytics writes into the Core ML metadata. It is read from the compiled model's `metadata.json`, falling back to the model description. Nitrogen output is regenerated.
- **JS (`src/pose`):**
  - **`benchmark.ts`:** `runPoseBenchmark` (320, then 256), `sustainedFps`, and the pass/fail choice as a pure helper.
  - **`modeStore.ts`:** an MMKV store (`id: 'pose'`) for the benchmark, the preference and consent. It returns defaults and ignores corrupt values.
  - **`usePoseMode.ts`:**
    - `startPoseBenchmark()` runs once from `App.tsx`. It does nothing when the cache is current, and concurrent calls share one run.
    - `usePoseMode()` returns the mode, the benchmark, `benchmarking`, the live `size`, `needsCloudConsent`, the preference and consent setters, and `rerunBenchmark`.
    - `CLOUD_REACHABLE_STUB` is `false` until CONN-11.
    - Model load failures are saved. Unexpected errors are kept in memory only, so the next launch tries again.
  - **`react-native-mmkv` 4.3.2:** added with `expo install`. `apps/mobile/__mocks__/react-native-mmkv.ts` reuses the library's own in-memory mock, so Jest never loads Nitro's native module.
- **Debug screen:**
  - Shows the mode, consent, the benchmark size, p95 and fps, and any benchmark error.
  - Adds "Re-run benchmark" and "Allow cloud / Revoke cloud consent" buttons.
  - The Core ML / Vision toggle now saves the preference (`auto` ↔ `vision`).
  - The live detector uses the benchmarked size.
  - The camera is unmounted while a benchmark runs, so the two don't compete for the Neural Engine.
- **Docs:**
  - Root `Architecture.md` §4.1 covers the benchmark rules and the code layout.
  - `docs/pose/how-it-works.md` has a new "In-app benchmark and mode selection" section.
  - The spec is in `docs/superpowers/specs/2026-10-10-pose-benchmark-mode-design.md`.

## Validation

- **`swift test` in PoseCore:** 61 tests pass, 4 of them new for `TimedBenchmark`. They cover discarding warm-up results, at least one sample, zero-length windows, and errors that propagate.
- **Jest:** 78 tests pass. New tests cover:
  - sustained fps and choosing between the sizes
  - 320 passes, falls back to 256, or neither passes
  - model load failure
  - Android skipping native code
  - store defaults, round trips and corrupt values
  - cache hit and invalidation by model id
  - shared concurrent runs
  - not saving unexpected errors
  - `needsCloudConsent` for a slow iPhone, Android and the cloud preference
  - preference and consent persistence, and Vision not waiting for the benchmark
  - re-runs
  - the debug screen's re-run with the camera unmounted, and the consent toggle
- **`tsc --noEmit`:** clean for the pose, module and `App.tsx` files. The remaining errors are already in the FE app files (`src/app`, `src/screens`, `src/state`; `expo-router` and others aren't installed in this tree).
- **Build:** `expo prebuild --platform ios`, pod install, and an iOS Simulator build (`xcodebuild`, Debug) succeed.
- **iPhone 17 Pro Max (`iPhone18,2`), Release build:** the first-launch benchmark picked `coreml` at 320.
  - p95 7.3 ms, 136.8 sustained fps, about 11× the 12 fps bar.
  - That's faster than PoseBench's 10.8 ms p95 on the same phone. The synthetic run has no camera capture or preview competing with it, and no person to decode, so treat it as a ceiling, not the live rate.

## Not included

- **Rest of the device check:** to do before merge.
  - "Re-run benchmark"
  - a relaunch reusing the cached result
  - the preference surviving a restart
  - an older iPhone near the threshold
- **Lint:** not run, because `eslint` is not installed in `apps/mobile`.
- **Consent screen:** FE-15. It renders from `needsCloudConsent` and calls `setCloudConsent`.
- **Cloud client and reachability:** CONN-11. It replaces `CLOUD_REACHABLE_STUB`.
- **Settings UI:** the debug-screen buttons stand in for now, and FE's settings screen calls `rerunBenchmark` and `setPreference`.
- **Thermal-state handling** during the benchmark.
