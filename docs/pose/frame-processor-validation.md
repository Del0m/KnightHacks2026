# Expo pose plugin validation

Issue #42 (AI-02). The iOS plugin, debug screen and setup docs are implemented. The owner confirms both-camera alignment, sustained 15 fps for 60 seconds, correct left-arm tracking and clearing the skeleton when nobody is visible. These results apply to the tested standalone branch; integration with FE-01 on current main has not been tested.

## Automated checks

Checked on 2026-10-10 with Xcode 26.6, Expo 57 and Vision Camera 5.2.3.

| Check | Result |
|---|---|
| `npm test -- --runInBand` in `apps/mobile` | 29 tests passed, 6 suites |
| `npm run typecheck` | Passed |
| `swift test` in PoseCore | 45 tests passed, including eight landmark cases and native connection-angle cases |
| `expo prebuild -p ios --no-install`, then `pod install` | Passed; PoseCore, SpotterPose and VisionCamera installed |
| `expo export --platform ios` | Passed; iOS Hermes bundle generated |
| Nitro regeneration into a temporary directory | Matches checked-in generated files |
| Unsigned Release build for generic iOS | Passed; both compiled models and the JS bundle are present |
| Signed Release build with orientation correction | Passed; signature verified and app reinstalled on the owner's iPhone |
| Lint | Not configured; Expo tried to install tooling, which was cancelled |

The throttle regression test processes 150 of 300 nominal 30 fps frames over 10 seconds. Without the floating-point boundary fix, it processed only 120. This is a unit test, not a measurement of phone inference speed.

Native build command, from `apps/mobile`:

```bash
xcodebuild -workspace ios/Spotter.xcworkspace -scheme Spotter \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/spotter-pose-final-build \
  build CODE_SIGNING_ALLOWED=NO
```

The build reports `BUILD SUCCEEDED`. The resulting app contains `yolov8n-pose-320.mlmodelc`, `yolov8n-pose-256.mlmodelc` and `main.jsbundle`. Signing is disabled for this compile check. The newer signed calibration build also passes. Dependency warnings remain. The detached calibration connection uses the deprecated but supported `videoOrientation` interface-target setter; its actual angle is read through `videoRotationAngle`.

The frame-lifecycle tests cover throttle skips, inference failures, synchronizable read/write failures, disposal, continued processing and separate pipeline-drop counts. Screen tests cover camera-switch dimensions and rejected permission requests. Timestamp tests verify that capture spacing survives different processing delays. Capture-to-Unix conversion assumes the video-only session uses the host clock; check timestamps after resume on the phone.

## Device results

On 2026-10-10, the signed Release app was installed and launched on the connected iPhone 17 Pro Max. The owner reported 15 fps, 13 ms inference latency and a 0.94 person score. The front-camera pose was upright, but the back-camera pose was upside down. These are live readouts, not a timed benchmark or a sustained 60-second result. The phone's iOS version was read with `devicectl`. [PoseBench results](benchmark-results.md) measure the separate native app from issue #41.

| Phone | iOS | Model size | Build | Processed fps | Inference ms | Result |
|---|---|---|---|---|---|---|
| iPhone 17 Pro Max | 26.6.2 | 320 | Release | 15 | 13 | Score 0.94; front upright, back inverted before correction |
| iPhone 17 Pro Max | 26.6.2 | 320 | Release, per-camera calibration | At least 15 for 60 s, owner-confirmed | Not remeasured | Both cameras aligned; left-arm tracking and no-person clearing confirmed |

The first quarter-turn correction passed synthetic landmark tests but the owner reported that it broke the front camera. Those tests verified EXIF transforms, not whether Vision Camera's flags described the actual pixels on both sensors. The detector now derives the correction from the active camera's native connection angles. The new tests cover different target angles, existing buffer rotation, wrapping and unmirroring. A layout effect binds the output before frame callbacks are registered. On 2026-10-10, the owner confirmed both skeletons were upright and aligned through front → back → front, then confirmed sustained 15 fps for 60 seconds, correct left-arm tracking and no-person clearing. No separate drop-count trace or final-build latency benchmark was supplied.

The owner runs the device checks. From the repository root:

```bash
cd apps/mobile
npx expo run:ios --device --configuration Release
```

Setup and signing: [apps/mobile/README.md](../../apps/mobile/README.md).

- [x] The native Release app opens on the iPhone and shows live pose readouts.
- [x] Decoded results contain 17 COCO joints with confidence, covered by automated tests; live skeleton rendering works on the phone.
- [x] Front-camera skeleton is upright and lines up with the body after switching back to front.
- [x] Back-camera skeleton is upright and lines up after switching cameras.
- [x] The real left arm tracks the correct left-side joints.
- [x] Processed fps holds at least 15 at 320 px on a recent iPhone for 60 seconds, confirmed by the owner. Initial latency readout: 13 ms.
- [x] The app stays responsive during the 60-second run.
- [x] Walking out of frame clears the skeleton without a crash.

The owner confirmed the requested device checks. The PR can close #42 after its changes are integrated and reviewed. Final-build mean/p95 latency, a recorded drop-count trace, older phones and longer thermal runs remain unmeasured.

## Integration notes

- FE-01's navigation/theme scaffold is now on main. This tested branch still has a standalone debug entry point. Preserve main's Expo Router, pnpm setup and app configuration when integrating the plugin. FE-05 can replace the debug screen while keeping `usePoseOutput` and the native plugin. The integrated FE-01 app has not been built or device-tested here.
- The native package lives in `apps/mobile/modules/spotter-pose/`; app-facing code lives in `apps/mobile/src/pose/`.
- PoseCore adds a local CocoaPod definition, orientation handling and capture-time conversion. The decoder is shared with PoseBench.
- Suggested owner edit to `Architecture.md` §4: change Vision Camera v4 to “v5 (Nitro frame-processor plugins)”.
