# Pose benchmark results

On-device YOLOv8n-pose numbers from PoseBench (issue #41). Method: see [how-it-works.md](how-it-works.md#benchmark-method). To add a phone, run the benchmark in PoseBench, tap **Copy row**, and paste the rows into the table below.

## Results

| Phone | iOS | Size | Mean ms | p95 ms | Max fps | Holds 15 fps |
|---|---|---|---|---|---|---|

No phones measured yet.

**Columns:**
- **Phone** is the machine identifier (e.g. `iPhone14,5` is an iPhone 13). Look it up at https://www.theiphonewiki.com/wiki/Models.
- **Latency** is the time from handing a frame to Vision to the decoded joints, so it covers resize, model and decode.
- **Max fps** is 1000 ÷ mean, the ceiling if the phone ran inference back to back.
- **Holds 15 fps** means p95 < 66.7 ms.

## What it means

To fill in after the first run:

- **Default size to ship:** 320 if it holds 15 fps with headroom, otherwise 256.
- **Headroom at 15 fps:** 15 ÷ max fps is the share of the phone's capacity the live view uses. Lower means less heat and battery drain (Architecture §18).
- **AI-04's threshold:** the app falls back to cloud mode below about 12 fps (§4.1). Note how far above that these phones sit.
- **Neural Engine placement:** from Xcode's Core ML Performance report, if checked (see how-it-works.md).
