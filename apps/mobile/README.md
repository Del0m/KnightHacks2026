# Mobile pose app

Minimal Expo 57 dev build for the iOS pose plugin (issue #42). Vision Camera v5 sends frames to the bundled YOLOv8n-pose Core ML model. The debug screen shows the returned joints.

Frame path: [how-it-works.md](../../docs/pose/how-it-works.md#running-in-the-expo-app). Output format: [pose-result-contract.md](../../docs/pose/pose-result-contract.md).

Checks and device results: [frame-processor-validation.md](../../docs/pose/frame-processor-validation.md).

## Prerequisites

- A Mac with Xcode 26.4 or newer (Xcode 26), with the iOS platform installed under **Settings → Components**.
- Node.js 22.13 or newer and npm. See the [Expo 57 requirements](https://docs.expo.dev/versions/v57.0.0/).
- CocoaPods: `brew install cocoapods`.
- [uv](https://docs.astral.sh/uv/) for the model export.
- An iPhone on iOS 17+, a cable, and a free Apple ID for signing.

## Setup in five commands

Start in the repository root. Run these steps in order in the same terminal.

1. **Export both models:**

   ```bash
   cd ml/pose_export && uv run export.py
   ```

   This writes the 320 and 256 px `.mlpackage` files into `PoseBench/PoseBench/Models/`. They are gitignored.

2. **Install the app dependencies:** return to the repository root first.

   ```bash
   cd ../..
   cd apps/mobile && npm install
   ```

3. **Generate the iOS project:**

   ```bash
   npx expo prebuild -p ios
   ```

   `withPoseModels` copies both models into the generated project and adds them to the app target. Xcode compiles them into `.mlmodelc` files in the app bundle. `ios/` is generated and gitignored; configure it through `app.json` and config plugins.

   Set up signing once: open the `.xcworkspace` in `ios/`, select the app target, then **Signing & Capabilities → Team → Personal Team**. Add your Apple ID under **Xcode → Settings → Accounts** if needed. If the bundle identifier is taken, change `ios.bundleIdentifier` in `app.json` to a unique value and run prebuild again. This is the same signing setup as [PoseBench](../../ml/pose_export/README.md#run-it-on-your-phone).

4. **Build and run on the phone:** plug it in and unlock it.

   ```bash
   npx expo run:ios --device
   ```

   For real fps numbers, use `npx expo run:ios --device --configuration Release`. The first install may require **Settings → Privacy & Security → Developer Mode**, then a restart. If the app shows “Untrusted Developer”, trust your Apple ID under **Settings → General → VPN & Device Management**. Free Apple ID installs need signing again after 7 days.

5. **Run the tests** from `apps/mobile` (after stopping the dev server, or in another terminal):

   ```bash
   npm test
   ```

   `npm run typecheck` checks TypeScript. `npm run ios` is the shortcut for `expo run:ios`; [Expo's local build guide](https://docs.expo.dev/guides/local-app-development/) covers the CLI.

## Debug screen

The screen starts with the front camera and the 320 px model. It shows the camera preview, a skeleton, processed fps, inference latency in ms, person score, model name, and dropped count. The button switches between front and back cameras. The skeleton disappears when no person is found; low-confidence joints are hidden.

The hook caps inference at 15 fps. The dropped count tracks camera-pipeline drops since the screen mounted, not frames deliberately skipped by the throttle. Latency covers Vision preprocessing, inference and decode; it does not include the hop to the JS thread or drawing.

This branch uses a standalone debug entry point. FE-01's navigation and theme are now on main; preserve them when integrating this plugin. FE-05 replaces the debug screen with the live-set screen. Both can reuse `src/pose/usePoseOutput.ts` and the native plugin in `modules/steadyforum-pose/`.

## Cloud tracking (iOS)

Phones that fail the on-device benchmark, or users who pick cloud, stream frames to the API's `/pose/stream` relay. This runs only on iPhone, and only in the camera check and debug screen. Android, web and the workout screen are not wired up yet.

- **Phone config:** `EXPO_PUBLIC_API_URL` (https becomes wss) and a signed-in Neon Auth session. The phone never sees the Hugging Face token.
- **API config:** `POSE_ENDPOINT_URL` (see `apps/api/README.md`).
- **Consent:** asked in the camera check, per account.
- **When cloud stops answering:** the camera check shows "Reconnecting…" and recovery choices. "Use local tracking" appears only if this iPhone passed the benchmark.
- **Debug screen:** shows the source, the cloud status, fps, dropped frames and capture-to-result latency. Use it for the device check: after warm-up you should see at least 8 fresh poses per second, held for 60 s.

Tests:

```bash
npx jest src/pose src/screens/LiveSet               # mobile, cloud client and screens
(cd ../api && npx vitest run test/pose-stream.test.ts)  # relay
(cd ../../ml/pose_export/PoseBench/PoseCore && swift test)  # encoder orientation and size
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Prebuild says “Pose models not found” | From the repository root, run `cd ml/pose_export && uv run export.py`, then rerun prebuild from `apps/mobile`. |
| The app fails in Expo Go | The pose plugin uses native code. Use the dev build installed with `npx expo run:ios --device`. |
