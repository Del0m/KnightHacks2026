# AI-17 (#108): iOS cloud pose client, design

Status: approved plan, 2026-10-11. Stacked on PR #135 (SteadyForum rename). iOS only; Android, web and
automatic workout recording (INT-11, #109) are out of scope. The settings-screen consent toggle stays in
FE-15 (#40).

This file is the shared contract for the three work streams below. Each stream owns its files; do not
edit another stream's files. If the contract needs to change, stop and report it.

## Working rules (every stream)

- Test first. Write the behavioural tests, commit them alone (`test(<area>): ...`), run them and save
  the failing output, then implement and rerun with the tests unchanged (`feat(<area>): ...`).
- `git add` only your own paths (never `-A` / `.`). If `.git/index.lock` exists, wait a few seconds
  and retry. No `Co-Authored-By` lines and no mention of any AI assistant in commits, code or docs.
- Never save or log image bytes. Keep the existing code style (comment density, naming, terse files).
- Commands: mobile `cd apps/mobile && npx jest <path>`, `npx tsc --noEmit`, `npx expo lint`;
  PoseCore `cd ml/pose_export/PoseBench/PoseCore && swift test`; relay
  `cd apps/api && npx vitest run test/pose-stream.test.ts`. `pnpm` isn't installed; use `npx`.

## Relay facts (apps/api/src/routes/poseStream.ts, unchanged)

- On connect the relay sends `{"type":"ready"}`.
- Each binary frame is an 8-byte big-endian float64 `timestamp_ms` followed by a JPEG (starts `FF D8`).
- The relay answers each processed frame with exactly one of:
  - `pose`, which carries the same `timestamp_ms`, `result` (or null), `latency_ms`, `endpoint_ms` and `dropped`;
  - `status: warming`, after which it drops frames for 2 s and discards its own pending frame;
  - `error`.
- The relay holds one frame in flight plus one pending frame; the newest frame wins.

## Stream A: native encoder (owner: native agent)

Files: `ml/pose_export/PoseBench/PoseCore/Sources/PoseCore/CloudFrameEncoder.swift` (new), its tests and
fixtures under `Tests/PoseCoreTests/`, `apps/mobile/modules/steadyforum-pose/**` (spec, `src/index.ts`,
new `ios/HybridCloudFrameEncoder.swift`, factory, podspec, regenerated `nitrogen/generated/**`).

- PoseCore holds the testable logic:
  - `CloudFrameEncoder.targetSize(uprightWidth:uprightHeight:longSide: 320)`: keeps the aspect ratio
    and never upscales; each side is at least 1.
  - `CloudFrameEncoder.encode(...)` takes a `CIImage` or `CVPixelBuffer` plus the
    `CGImagePropertyOrientation` from `ImageOrientation.vision(...)`. It returns JPEG `Data` that is
    physically upright and unmirrored, with the longest side at most 320 and quality 0.70. Rotation is
    in the pixels, never an EXIF tag. It throws `PoseError` on an empty or invalid input.
- Swift tests build asymmetric fixtures with distinct coloured corner markers for every orientation,
  including the mirrored ones. They decode the JPEG with ImageIO and check:
  - marker positions, so rotation and mirroring are right;
  - dimensions and aspect ratio;
  - that small inputs aren't upscaled;
  - errors.
- Nitro spec (`PoseDetector.nitro.ts`):
  ```ts
  export interface CloudFrame { jpeg: ArrayBuffer; timestampMs: number; width: number; height: number }
  export interface CloudFrameEncoder extends HybridObject<{ ios: 'swift' }> {
    setFrameOutput(output: CameraFrameOutput): void
    encode(frame: Frame): CloudFrame   // throws on failure; never disposes the frame
  }
  // PoseDetectorFactory gains: createCloudFrameEncoder(): CloudFrameEncoder
  ```
  `src/index.ts` exports `createCloudFrameEncoder()` and the `CloudFrame`/`CloudFrameEncoder` types.
- `HybridCloudFrameEncoder` reuses `PoseFrameReader` for calibrated orientation, the upright size and
  the Unix-ms capture timestamp. That way cloud frames match on-device frames exactly. It reuses one
  `CIContext`.
- Regenerate the bindings with the repo's `nitrogen` devDependency (`cd apps/mobile/modules/steadyforum-pose
  && npx --prefix ../.. nitrogen` or equivalent) and commit the generated files.
- Also add an optional `timestampMs?: number` (the capture time) to the native `PoseDetection`, filled
  by both on-device detectors, so a no-person frame keeps its capture time.

## Stream B: transport (owner: transport agent)

Files: `apps/mobile/src/pose/cloud.ts`, `usePoseOutput.ts`, `types.ts`, `index.ts`, `cloudFrame.ts`
(delete it and its nitro-image use), the `steadyforum-pose` Jest mock if one is needed, and the tests
`src/pose/__tests__/{cloud,usePoseOutputCloud,usePoseOutput,cloudFrame}.test.ts`.

The JS uses the Stream A API through `createCloudFrameEncoder()` from `steadyforum-pose`. Mock it in tests.

### Types

```ts
// types.ts
export interface PoseDetection { result?: PoseResult; latencyMs: number; /** Capture time, Unix ms. */ timestampMs?: number }

// cloud.ts
export type CloudStatus = 'connecting' | 'tracking' | 'reconnecting' | 'stopped';
export type CloudFailure = 'warming' | 'connect' | 'inference' | 'timeout' | 'stale';
export interface CloudDrops { replaced: number; relay: number } // client-side replacement, relay `dropped`
```

### CloudPoseClient behaviour

- `start()` / `close()`. `close()` is final for that instance: it cancels all timers and the in-flight
  token request, closes the socket, sets status `stopped`, and ignores every later callback.
- Each connection attempt gets a new generation number. A socket, timer or token callback from an
  older generation does nothing.
- Each attempt calls `getToken()` for a fresh token. The token goes in the `Authorization: Bearer`
  header via React Native's WebSocket options and never in the URL.
- Statuses:
  - `connecting` until the first `ready`;
  - `ready` sets `tracking` and calls `onAvailability(true)`;
  - `warming` sets `reconnecting`;
  - any failure or close sets `reconnecting`, and `onAvailability(false)` if the socket was available.
- `onFailure(kind)` fires for:
  - each warming reply;
  - a connection failure: no token, socket error or close before `ready`, or no `ready` within 5 s;
  - a relay `error` (`inference`);
  - a result timeout: no reply within 5 s of transmitting;
  - a result discarded for age (`stale`).
- On `timeout` or `inference` the socket closes and reconnects as a new generation.
- Backoff before each reconnect: 500, 1000, 2000, 4000, 8000, then 15000 ms repeating. It resets only
  after an accepted, fresh `pose` reply, not on `ready`.
- Frames:
  - At most one transmitted frame awaits a reply, and there is at most one pending frame.
  - A newer `send()` replaces the pending frame and counts `replaced += 1`.
  - Nothing is sent before `ready`, or while another frame is in flight.
- While warming:
  - Pending frames are discarded rather than held.
  - At most one probe frame goes out every 2 s, measured from the last transmission.
  - Frames arriving in between are discarded without counting as replaced.
- Accepting a reply. A `pose` reply is accepted only when all of these hold:
  - it arrives on the current socket generation;
  - its `timestamp_ms` equals the in-flight frame's timestamp;
  - that timestamp hasn't been answered already;
  - `now - timestamp_ms <= 1000`.
- Discarding replies:
  - malformed, duplicate or obsolete replies are dropped silently;
  - a reply that fails only the age check is dropped and raises `onFailure('stale')`, and it still frees
    the in-flight slot.
- `result: null` becomes `result: undefined`, with `source: 'cloud'` on a result.
- An accepted reply calls `onPose({ result, latencyMs: latency_ms, timestampMs: timestamp_ms }, { replaced, relay: dropped })`.
  Counters are reported as deltas since the last call.
- Packet: `encodeFrame(timestampMs, jpeg)`, an 8-byte big-endian float64 followed by the JPEG bytes.
- Remove `probeCloud`. Reachability is now what the streaming socket observes, through `onAvailability`.

### usePoseOutput

- `engine: 'cloud'` keeps the existing API: `onPose`, `fps`, `dropped`, `model` and `error`.
- New options and output:
  ```ts
  cloud?: CloudConfig | null; // null/undefined => transport stopped (status 'stopped')
  interface CloudConfig { url: string; getToken(): Promise<string | null>; createSocket?: CreateSocket;
    onAvailability?(available: boolean): void; onFailure?(kind: CloudFailure): void }
  // PoseOutput adds:
  cloudStatus: CloudStatus | null;   // null for on-device engines
  ```
  `cloudState` is replaced by `cloudStatus`. Update every caller in your files; Stream C updates the
  screens.
- The transport runs only while `engine === 'cloud'` and `cloud` is non-null. A change to the URL or
  config identity, or an unmount, closes the client.
- Worklet behaviour:
  - Encoding runs at no more than 10 fps (`shouldProcess`).
  - The worklet calls `encoder.encode(frame)` and schedules delivery to JS with the JPEG and its
    `timestampMs`.
  - At most 2 deliveries may be outstanding between the worklet and JS (a synchronizable counter).
    Beyond that the frame isn't encoded and counts as dropped.
  - Every frame is disposed exactly once, in `finally`. That includes throttled, inactive and failed
    frames.
- `fps` counts accepted detections, including no-person ones.
- `dropped` = camera `onFrameDropped` + delivery-bound skips + `replaced` + relay `dropped`.
  Throttle skips are not counted.
- `model` is the last cloud result's model, else `'cloud'`.
- The encoder: create it with `createCloudFrameEncoder()` in a `useMemo` and call
  `setFrameOutput(frameOutput)` in a layout effect, as is done for the detector.

## Stream C: mode, consent, screens and integration (owner: UI agent; starts after B)

Files:
- `apps/mobile/src/pose/{mode,modeStore,usePoseMode,PoseDebugScreen}.tsx?` and their tests;
- `apps/mobile/src/screens/LiveSet/CameraCheck.tsx` and its tests;
- `apps/mobile/src/screens/Auth/session.tsx`;
- recording and engine consumers that read detection time (`src/engine/recording.ts`, `poseClock`
  usage) and their tests;
- `WorkoutCamera.tsx`: compile fixes only. Automatic recording is deferred.

- **Mode** (`selectPoseMode`): when cloud is the chosen source (consented, and the phone is slow or the
  user prefers cloud) and isn't available, return `paused`, never `coreml`. Core ML is used for a
  cloud-preferring phone only after an explicit tap.
- **Reachability:** `usePoseMode` drops the probe loop. `cloudReachable` is set by
  `reportCloudAvailability(available)`, which the camera screens wire to `CloudConfig.onAvailability`.
  In both `cloud` and `paused` the camera flow runs the cloud transport, so it can recover while paused.
- **Consent:**
  - Consent is stored per account under `cloudConsent:<userId>`.
  - The legacy device-wide `cloudConsent` key is never read as a grant (no migration).
  - `usePoseMode` takes the current account id; with no account, consent is false.
  - Revoking consent, logging out or switching accounts stops the transport immediately.
- **Auth:** `getApiToken` captures the auth generation and the user before awaiting
  `authClient.token()`, and returns null if either changed meanwhile.
- **Eligibility:** the cloud transport runs only when every one of these holds:
  - camera check or debug screen;
  - foreground and focused;
  - signed in;
  - consent for this account;
  - mode `cloud` or `paused`;
  - no local override.

  Otherwise `cloud` is null.
- **Camera-check privacy copy:** before consent, explain that cloud tracking sends camera frames to the
  SteadyForum API for pose detection. Frames are processed in memory and never stored. Offer
  consent and manual continuation.
- **Recovery UI** (camera check):
  - When to show it: on the first `onFailure` of any kind. It hides after a fresh tracked result.
  - Choices:
    - **Use local tracking**, only if the benchmark says Core ML passes (`MIN_ON_DEVICE_FPS`). It takes
      an explicit tap and is never automatic. Apple Vision is never offered here.
    - **Retry cloud**, which resets backoff with a new client.
    - **Continue without camera**.
  - After 15 s of continuous recovery, manual continuation becomes the primary choice.
  - Status text shows "Connecting…" or "Reconnecting…" visibly.
- **Local override:** this is component state in the camera-check session. Tapping local stops cloud
  retries and starts Core ML. It never changes the saved preference, and reopening the flow goes back to
  the saved preference.
- **Sources and staleness:**
  - Show the active source label in camera check and the debug screen.
  - The debug screen maps the mode to an engine with no implicit Core ML: `cloud`/`paused` → `cloud`,
    `coreml` → `coreml`, `vision` → `vision`.
  - Use `d.timestampMs ?? d.result?.timestamp_ms` as detection time.
  - Results older than `FRAME_STALE_MS` can't enable Ready.
  - Clear overlays, the result and framing readiness when the status leaves `tracking`.
  - Reset the debug form engine, rules and clock on any interruption or source switch.

## Verification (integrator)

- Run, in order:
  - the full mobile suite, typecheck and lint;
  - the relay tests;
  - PoseCore `swift test`;
  - an iOS simulator build with `npx expo prebuild` plus `xcodebuild`, or `expo run:ios`.
- Deliberate regressions must fail the tests: automatic Core ML fallback, and two frames in flight at once.
- Device gate (the owner runs it on an iPhone):
  - after warm-up, at least 8 fresh pose responses per second over 60 s, each fresh to within 1 s;
  - record latency, fps, drops and queue bounds.
