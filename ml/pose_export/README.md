# pose_export

Exports YOLOv8n-pose to Core ML (320 and 256 px) and includes **PoseBench**, a small iPhone app that shows the live skeleton, latency and fps, and copies benchmark rows for the PR. Issue #41.

How it all works: [docs/pose/how-it-works.md](../../docs/pose/how-it-works.md)

## Run it on your phone

You need a Mac with Xcode, [uv](https://docs.astral.sh/uv/), an iPhone 12 or newer on iOS 17+, and a cable.

1. **Export the models** (first time, or after changing `export.py`):

   ```bash
   cd ml/pose_export
   uv run export.py
   ```

   It should print two `wrote PoseBench/PoseBench/Models/yolov8n-pose-*.mlpackage` lines.

2. **Install the iOS platform in Xcode** (once): Xcode → Settings → Components → iOS → Get. It's several GB. Without it, Xcode can't build for a phone.

3. **Open the project:** `open PoseBench/PoseBench.xcodeproj`

4. **Set up signing** (once): click the PoseBench project, then the PoseBench target, then **Signing & Capabilities**. Set **Team** to your Apple ID (shown as "Personal Team"; add your account under Xcode → Settings → Accounts if it isn't listed). If Xcode says the bundle identifier is taken, change `com.del0m.posebench` to something unique, e.g. `com.<yourname>.posebench`.

5. **Run on the phone:** plug it in, unlock it, pick it as the run destination at the top of Xcode, and press **Run** (⌘R).
   - The first time, the phone asks you to turn on **Developer Mode** (Settings → Privacy & Security → Developer Mode) and restarts.
   - If the app won't open with "Untrusted Developer": on the phone go to Settings → General → VPN & Device Management, then your Apple ID, then **Trust**.

6. **Benchmark:** point the phone at a person (or prop it up and stand in frame), tap **Run benchmark**, and wait about 25 s. Tap **Copy row** and paste the table into the PR or [docs/pose/benchmark-results.md](../../docs/pose/benchmark-results.md).

### Using the app

- **320 / 256** switches the model size live.
- The **camera button** flips between front (default, to test on yourself) and back (what the real app uses on a tripod).
- The readout shows model size, latency per frame and the fps actually achieved. The live view is capped at 15 fps; the benchmark runs uncapped to find the phone's ceiling.

### Free Apple ID limits

- The app stops opening after **7 days**. Press Run in Xcode again to reinstall.
- At most **3 apps** signed this way per phone at once.

## Tests

```bash
cd ml/pose_export && uv run pytest                                # export checks
cd ml/pose_export/PoseBench/PoseCore && swift test                # decoder, benchmark, geometry
```

## Editing the Xcode project

`PoseBench/project.yml` is the source of truth for the project file. After changing it, regenerate with `brew install xcodegen` (once), then `xcodegen generate` in `PoseBench/`. Adding or removing Swift files in `PoseBench/PoseBench/` needs no regeneration: the folder is synced.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App shows "No models found" | Run step 1, then Run again in Xcode |
| "iOS 26.x is not installed" in Xcode | Step 2 |
| "Signing requires a development team" | Step 4 |
| Build fails with "resource fork, Finder information, or similar detritus not allowed" | Build products ended up in an iCloud-synced folder (e.g. inside ~/Documents). Keep Xcode's default DerivedData location (Xcode → Settings → Locations), not a folder inside the repo. |
| `uv run export.py` fails with `ExportError` about [0, 1] | Ultralytics changed its output format. Don't loosen the check; see how-it-works.md "The raw output". |
| Skeleton is offset from the body | Check the padding maths in how-it-works.md "Decoding, step by step" |
| Left/right swapped on the front camera | See how-it-works.md "Orientation and mirroring" |
