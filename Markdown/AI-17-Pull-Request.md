Closes #108. Cloud tracking works on a physical iPhone; the owner accepted the device check without recording the 8 fps / 60 s numbers (see Device check).

This adds cloud pose tracking on iPhone. It runs in the camera check and the pose debug screen, through the authenticated `/pose/stream` relay that's already in place. The pose output and the relay protocol are unchanged. What's new:

- The phone encodes frames natively.
- Flow control is strict, with one frame in flight and one pending.
- Recovery is visible on screen.
- Consent is stored per account.
- The camera check offers Core ML only when the user taps for it, and never switches on its own.

Rebased onto `main` after #135 (the SteadyForum rename) merged. Android, web and automatic workout recording (INT-11, #109) are not part of this PR. The settings-screen consent toggle stays in FE-15 (#40).

PR #131 had already merged a first cloud client on `main`. This PR replaces its frame encoder (VisionCamera + nitro-image) and its probe-based reachability check, and tightens the client.

## What runs where

| Situation | Source | What the user sees |
|---|---|---|
| Phone passes the benchmark, preference `auto` | Core ML | "On-device tracking" |
| Slow phone, signed in, no consent for this account | none | "Turn on cloud tracking?", with the privacy copy, then Allow / basic tracking / continue without camera |
| Cloud chosen, consented, relay answering | cloud | "Cloud tracking" |
| Cloud warming, timing out, failing or stale | cloud transport keeps retrying (mode `paused`) | "Reconnecting…" and recovery choices |
| Same, on a phone that passed the benchmark | cloud, until the user taps | **Use local tracking** is offered as well. It starts Core ML for this camera check only. |
| 15 s of continuous recovery | unchanged | "Continue without camera" becomes the primary choice |
| Backgrounded, navigated away, consent revoked, logged out or account changed | stopped | No socket, timers or frames |

## Changes

- **Native encoder (`steadyforum-pose` and PoseCore)**
  - PoseCore's `CloudFrameEncoder` turns frames upright and unmirrored, with the rotation written into the pixels rather than an EXIF tag. It scales the longest side to at most 320 px, keeps the aspect ratio, never upscales, and writes JPEG at quality 70.
  - The new Nitro `createCloudFrameEncoder()` uses `PoseFrameReader`, so orientation and capture time match the on-device detectors exactly. The bindings are regenerated.
  - The native `PoseDetection` gains an optional `timestampMs`, which both on-device detectors fill in.
  - `cloudFrame.ts` (the nitro-image path) is removed.
- **Transport (`cloud.ts`, `usePoseOutput.ts`)**
  - **Statuses:** `connecting`, `tracking`, `reconnecting` and `stopped`. `onAvailability` and `onFailure(kind)` cover `warming`, `connect`, `inference`, `timeout` and `stale`.
  - **Frame flow:** encoding is capped at 10 fps, with one frame in flight, one replaceable pending frame, and at most 2 frames queued between the worklet and JS. Every camera frame is disposed exactly once.
  - **Accepting replies:**
    - A reply must match the current socket generation and the in-flight timestamp, and be answered only once.
    - Results more than 1 s old are discarded.
    - `result: null` is treated as no person found.
  - **Timing:**
    - The connection and each result time out after 5 s.
    - Reconnect backoff runs 0.5, 1, 2, 4, 8, then 15 s, and resets only after a fresh pose reply.
    - While warming, pending frames are dropped and a probe goes out at most every 2 s after the latest warming reply.
  - **Fresh token:** each connection fetches a new token and sends it in the `Authorization` header.
  - **Stats:** `fps` counts accepted detections, including frames with no person. `dropped` adds up camera drops, the frame-queue limit, replaced frames and relay drops. Throttle skips aren't counted.
- **Mode and consent (`mode.ts`, `modeStore.ts`, `usePoseMode.ts`, `session.tsx`)**
  - When a consented phone wants cloud but cloud is unreachable, the mode is `paused`, never `coreml`.
  - Reachability comes from what the stream observes (`reportCloudAvailability`); the 30 s probe loop is gone.
  - Consent is stored under `cloudConsent:<userId>`. The old device-wide key is not migrated.
  - `getApiToken` returns null if the account changed while a token was being fetched.
- **Screens**
  - **`useCloudConfig`** builds the transport config only when the screen is eligible. "Retry cloud" creates a fresh client with its backoff reset.
  - **CameraCheck:**
    - It has the consent copy, the source caption, "Connecting…"/"Reconnecting…", and the recovery panel.
    - It is keyed by engine, so a flip between cloud and paused keeps the camera running.
    - Stale frames can't turn on Ready, and the pose and readiness are cleared when tracking stops.
  - **PoseDebugScreen:**
    - Maps the mode to an engine with no implicit Core ML.
    - Streams only while eligible.
    - Shows the source, cloud status and capture-to-result latency next to fps and dropped.
    - Resets the form engine, rules and clock on any interruption or source switch.
    - Gains a **Use cloud** / **Use automatic** toggle. A phone that passes the benchmark otherwise never runs cloud, and the settings toggle is FE-15.
- **Engine:** the clip recorder and `useFormEngine` time no-person frames by their capture time.
- **`app.json`:** the camera permission text no longer says "Video never leaves your phone".
- **Docs:**
  - Root `Architecture.md` §4.1: "Lost connection" now describes the explicit tap, not an automatic switch; also consent per account and code pointers.
  - `docs/pose/pose-result-contract.md`: the phone side.
  - `apps/mobile/README.md`: the "Cloud tracking (iOS)" section.
  - Design contract: `docs/superpowers/specs/2026-10-11-ai17-cloud-pose-client-design.md`.

## Validation

**Test-first:** each group's tests were committed alone and run against the old code, then the implementation landed with the tests unchanged.

| Group | Red | Green |
|---|---|---|
| Native encoder (Swift) | build fails: `cannot find 'CloudFrameEncoder' in scope` | `Executed 77 tests, with 0 failures` |
| Transport | `Tests: 29 failed, 11 passed, 40 total` | `Tests: 40 passed, 40 total` |
| Warming probe timing | `Tests: 1 failed, 20 passed, 21 total` | `Tests: 21 passed, 21 total` |
| 1. Fallback gate | `Tests: 5 failed, 28 passed, 33 total` (plus one suite that couldn't load: new module missing) | `Tests: 37 passed, 37 total` |
| 2. Consent per account and copy | `Tests: 4 failed, 29 passed, 33 total` | `Tests: 33 passed, 33 total` |
| 3. Account-scoped token | `Tests: 2 failed, 10 passed, 12 total` | `Tests: 12 passed, 12 total` |
| 4. Lifecycle and eligibility | `Tests: 5 failed, 21 passed, 26 total` | `Tests: 26 passed, 26 total` |
| 5. Sources, staleness, resets | `Tests: 7 failed, 30 passed, 37 total` | `Tests: 37 passed, 37 total` |
| 5b. Capture time in recording | `Tests: 1 failed, 7 passed, 8 total` | `Tests: 8 passed, 8 total` |
| Debug-screen cloud toggle | `Tests: 1 failed, 15 passed, 16 total` | `Tests: 16 passed, 16 total` |

**Deliberate regressions** (temporary, not committed):

- **`selectPoseMode` falls back to Core ML automatically:** `Tests: 5 failed, 849 passed, 854 total`, including "offers local tracking on a capable phone, and starts Core ML only after the tap".
- **CameraCheck starts Core ML on the first failure:** `Tests: 2 failed, 852 passed, 854 total`.
- **A second frame is allowed in flight:** 5 failures, including "keeps one frame in flight and one pending…" and "holds at most 2 deliveries…".
- **The encoder's `.upMirrored` and `.left` are swapped:** the orientation tests fail on the swapped corner markers.

**Full checks:**

`cd apps/mobile && npx jest --ci` (the baseline before this PR was 808 tests):

```
Tests:       855 passed, 855 total
```

`npx tsc --noEmit`: clean. `npx expo lint`: `✖ 6 problems (0 errors, 6 warnings)`; the baseline was 9 warnings.

`cd apps/api && npx vitest run test/pose-stream.test.ts`:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

`cd ml/pose_export/PoseBench/PoseCore && swift test`:

```
Executed 77 tests, with 0 failures (0 unexpected)
```

**Native build:** `npx expo prebuild -p ios`, then `pod install`, then `xcodebuild … -sdk iphonesimulator` (iPhone 17 Pro, Xcode 26.6) gave `** BUILD SUCCEEDED **`. The generated Info.plist has the new camera text.

## Device check

**Setup:** an iPhone 17 Pro Max with a debug build over USB. The API ran on a laptop with `POSE_ENDPOINT_URL` set; the phone reached it at `http://<host>.local:3000`. For that local test only, the HTTPS check in `api.ts` was relaxed for `.local` hosts. That change isn't in this PR.

Done:

- [x] Cloud tracking works end to end on the phone: socket auth, warming, then tracking.
- [x] Frames arrive upright.
- [x] Recovery behaved as intended while the endpoint was rejecting calls (HTTP 403, see below): the client backed off and showed "Reconnecting…".
- [x] **Endpoint timing**, measured from the laptop with a warm endpoint over keep-alive: round trip **79 ms median** (64–290 ms), endpoint inference **12 ms**. That allows about 12 fps with one frame in flight.

Not measured on the phone (accepted by the owner; covered only by tests):

- The 8 fps / 60 s gate. The laptop timing above suggests about 12 fps is possible, but no phone numbers were recorded.
- Explicit **Use local tracking**, consent revocation mid-stream, and switching cameras during cloud tracking.

**Hugging Face token:** the endpoint belongs to the `bubblesmal` account. A personal fine-grained token gets **403** (`missing permissions: inference.endpoints.infer.write`), even when it has that permission for its own account. The API's `HF_TOKEN` must be `bubblesmal`'s token (as `docs/runbooks/demo-checklist.md` says), or the endpoint has to move into a shared organisation.

## Deploying

- **Hosted API (`https://knighthacks2026.onrender.com`):** `/health` currently reports `cloud_pose: disabled`. Set `POSE_ENDPOINT_URL` there, and make `HF_TOKEN` the `bubblesmal` token, before cloud mode can connect from a phone. Phones need an HTTPS API, so this hosted one, not a laptop on `http`.
- **Phones:** this adds a native module (the encoder), so test phones need a fresh native build. A JavaScript-only update to an older build fails when it encodes the first cloud frame.

## Not included

- Android, web, and cloud in the workout screen (INT-11, #109). WorkoutCamera is unchanged.
- The settings consent and preference toggle (FE-15, #40).
- Backend or endpoint tuning.

## Honest notes

- **Device coverage.** The encoder has now run on a phone (iPhone 17 Pro Max): cloud tracking worked and frames arrived upright, so the camera's YUV-to-RGB step through `CIImage(cvPixelBuffer:)` is confirmed there. The automated orientation tests still use BGRA buffers on macOS. The fps gate wasn't measured (see Device check).
- **`cloudReachable` isn't reset when a screen closes its stream.** The next camera screen can briefly show `cloud` rather than `paused`. Both modes run the same transport, so nothing visible changes.
- **A fast phone that prefers cloud but hasn't consented still uses Core ML**, as `selectPoseMode` already did. Asking that user for consent belongs to the FE-15 toggle.
- **Every failure, including a single stale result, raises the recovery panel.** The panel hides on the next fresh pose. On a jittery connection it may flicker, so judge that on the device.
- **Two existing tests changed:**
  - In `cloud.test.ts`, one warming test was retimed. It had encoded the original spec's wording (2 s from the last send), but the relay holds for 2 s from its warming reply, so the first probe was being dropped unanswered.
  - In `PoseDebugScreen.test.tsx`, "toggles between YOLOv8 and Apple Vision" now saves a fast benchmark first. It relied on the old behaviour where a `pending` mode meant Core ML.
- **`Architecture.md` §3** used to say "Video never leaves the phone". It now names cloud mode as the exception, after review.
