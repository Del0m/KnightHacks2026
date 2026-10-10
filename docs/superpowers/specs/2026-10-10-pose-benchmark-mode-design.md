# AI-04: On-device benchmark and mode selection — design

Issue: #44. Builds on AI-03 (`selectPoseMode` in `apps/mobile/src/pose/mode.ts`). Architecture: root `Architecture.md` §4.1.

## Goal

On first launch, an iPhone runs YOLOv8n-pose for about 2 s per input size and caches the result. Pose mode comes from that result plus the user's preference and cloud consent:

- **On-device (`coreml`):** sustained fps of 12 or more.
- **Cloud prompt:** anything slower, so FE-15 asks for consent.

The user can re-run the benchmark later from settings. For now the debug screen stands in for the settings screen.

## Decisions

| Topic | Decision |
|---|---|
| Benchmark input | A native synthetic loop over one generated 1080×1920 YUV (`420f`) pixel buffer. No camera or person needed, and no UI. |
| Fps metric | Sustained fps = `1000 / p95Ms`. On-device needs at least `MIN_ON_DEVICE_FPS` (12). |
| Sizes | Try 320 first. If it falls short, try 256. The live detector uses the size that passed. |
| Timing per size | Discard the first inference (model load). Then a 0.5 s warm-up, discarded, then a 1.5 s measurement. |
| Storage | `react-native-mmkv` v4 (Nitro), instance `id: 'pose'`. Reads are synchronous. |
| Cache invalidation | Only when `poseModelId()` changes, i.e. a new export or a downloaded model. Re-run is otherwise manual. |
| Launch | Runs silently at app start. Mode is `'pending'` until the benchmark resolves. |
| Cloud prompt | The hook exposes `needsCloudConsent`, and FE-15 renders the prompt from it. `cloudReachable` is stubbed to `false` until CONN-11. |
| Preference | `auto` / `cloud` / `vision` is saved in the same store. |
| Re-run | `rerunBenchmark()` from the hook, plus a debug-screen button. |

## Native contract (`apps/mobile/modules/spotter-pose`)

Additions to `src/specs/PoseDetector.nitro.ts`:

```ts
export interface PoseBenchmark {
  size: number       // 320 or 256
  model: string      // "yolov8n-pose-320"
  meanMs: number
  p95Ms: number      // nearest-rank, same as PoseCore BenchmarkMath
  samples: number    // measured inferences (after warm-up)
}

export interface PoseDetectorFactory extends HybridObject<{ ios: 'swift' }> {
  // ...existing createPoseDetector / createBasicPoseDetector
  /** Fingerprint of the bundled YOLOv8 models; changes when a model is re-exported or replaced. Never throws. */
  poseModelId(): string
  /** Runs YOLOv8 back to back on a synthetic frame off the JS thread. Rejects if the model is missing or fails to load. */
  benchmarkPoseModel(size: number, warmUpMs: number, measureMs: number): Promise<PoseBenchmark>
}
```

`src/index.ts` exports two wrappers, `getPoseModelId()` and `benchmarkPoseModel(size, warmUpMs, measureMs)`, plus the `PoseBenchmark` type.

**Native implementation:**
- **`PoseModelRunner`:** a new module file. It holds the YOLOv8 model loading (`ModelLocator`, compute units `.all`), the `VNCoreMLRequest` with `.scaleFit`, and `perform` + `MultiArrayReader` + `PoseDecoder` on a `CVPixelBuffer` with an orientation. `HybridPoseDetector.detect` uses it, and its behaviour stays the same.
- **Benchmark:** runs on a background queue through a Nitro `Promise.async`. It loads the model, builds the synthetic buffer and runs one discarded inference. It then calls PoseCore's `TimedBenchmark` and computes the stats with `BenchmarkMath.stats`.
- **`TimedBenchmark` (PoseCore):** pure, with an injected clock and an injected `work` closure that returns latency in ms. It runs `work` until `warmUp` has elapsed and discards those results. It then runs until `measure` has elapsed and returns the latencies. It always returns at least one sample.
- **`poseModelId`:** for each size, `<modelName>@<export date>`, using the Ultralytics Core ML metadata (`MLModel.modelDescription.metadata[.creatorDefinedKey]["date"]`). The date is read without compiling the model if that is cheap; otherwise from the compiled model description. With no date it is `<modelName>`, and with no model it is `<modelName>@missing`. The two sizes are joined with `+`.
- Regenerate the Nitrogen output (`npx nitrogen` in the module).

## JS contract (`apps/mobile/src/pose`)

**`benchmark.ts`**

```ts
export const BENCHMARK_SIZES = [320, 256] as const;
export const WARM_UP_MS = 500;
export const MEASURE_MS = 1500;

export interface BenchmarkResult {
  modelId: string;            // poseModelId() at run time; 'none' off iOS
  size: 320 | 256 | null;     // size that passed, else null
  fps: number | null;         // sustained fps of the passing size, else best seen; null if the model failed or not iOS
  meanMs: number | null;
  p95Ms: number | null;
  ranAt: number;              // Unix ms
  error: string | null;       // model load failure message
}

export function sustainedFps(p95Ms: number): number;   // 1000 / p95Ms
export function runPoseBenchmark(platform: string): Promise<BenchmarkResult>;
```

How `runPoseBenchmark` behaves:
- **Off iOS:** returns `{ modelId: 'none', size: null, fps: null, ... }` straight away.
- **Model fails to load:** the result has `fps: null` and `error` set.

**`modeStore.ts`**
- Store: `createMMKV({ id: 'pose' })`. Keys are `benchmark` (JSON), `preference` and `cloudConsent`.
- Functions:
  - `loadBenchmark()` / `saveBenchmark()`
  - `loadPreference()` / `savePreference()`, defaulting to `'auto'`
  - `loadCloudConsent()` / `saveCloudConsent()`, defaulting to `false`

**`usePoseMode.ts`**
- `startPoseBenchmark(platform = Platform.OS)` is idempotent. It does nothing when the cached `modelId` matches the current id.
  - The current id is `getPoseModelId()` on iOS and `'none'` elsewhere.
  - Completed results are saved, including ones where the model failed to load.
  - Unexpected throws are not saved, so the benchmark retries on the next launch.
- `rerunBenchmark()` always runs and saves.
- A module-level store with `useSyncExternalStore` backs `usePoseMode()`, which returns:

```ts
{
  mode: PoseMode | 'pending';     // 'pending' while there is no benchmark result yet, unless the preference is Apple Vision
  benchmark: BenchmarkResult | null;
  benchmarking: boolean;
  size: 320 | 256;                // benchmark.size ?? 320
  needsCloudConsent: boolean;     // !cloudConsent && selectPoseMode({...inputs, cloudConsent: true, cloudReachable: true}) === 'cloud'
  preference: PosePreference; setPreference(p): void;
  cloudConsent: boolean; setCloudConsent(c: boolean): void;
  rerunBenchmark(): Promise<void>;
}
```

- `cloudReachable` is the constant `false` (`CLOUD_REACHABLE_STUB`) until CONN-11.

**Other changes:**
- **`App.tsx`:** calls `startPoseBenchmark()` once at module load or on mount.
- **`PoseDebugScreen`:**
  - Shows the mode, the benchmark (size, p95, fps, error) and the consent state.
  - Adds a "Re-run benchmark" button.
  - Adds a consent toggle for testing.
  - The Core ML / Vision toggle now writes `preference` (`auto` ↔ `vision`).
  - The live hook gets `size` from `usePoseMode`.
  - While `benchmarking` is true, the camera is not mounted, so the camera's pose detector doesn't compete with the benchmark for the Neural Engine.
- **`index.ts`:** exports the new public API.

## Testing

- **`swift test` (PoseCore):** `TimedBenchmark` with a fake clock covers warm-up discard, the measure window, at least one sample, and stats.
- **Jest** (with `react-native-mmkv` and `spotter-pose` mocked):
  - `sustainedFps`
  - size fallback: 320 passes; 320 fails and 256 passes; both fail and the best fps is kept
  - model load failure
  - Android
  - store defaults and round trips
  - `startPoseBenchmark`: cache hit, miss and modelId invalidation, idempotency, and a throw that isn't cached
  - `usePoseMode`: pending → resolved, `needsCloudConsent`, preference and consent persistence, rerun
  - debug screen: re-run button, camera hidden while benchmarking, toggle writes the preference
- **Also:** `tsc --noEmit` on the pose and module files, an iOS Simulator build, and a check on a physical iPhone.

## Docs

- **Root `Architecture.md` §4.1:** the benchmark details and cache rules.
- **`docs/pose/how-it-works.md`:** an "In-app benchmark" section.
- **`Markdown/AI-04-Pull-Request.md`.**

## Out of scope

- Consent screen (FE-15).
- Cloud client and reachability (CONN-11).
- A real settings screen.
- Thermal-state handling.
