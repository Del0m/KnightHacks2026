# Pose benchmark results

On-device YOLOv8n-pose numbers from PoseBench (issue #41). Method: see [how-it-works.md](how-it-works.md#benchmark-method). To add a phone, run the benchmark in PoseBench, tap **Copy row**, and paste the rows into the table below.

## Results

| Phone | iOS | Size | Mean ms | p95 ms | Max fps | Holds 15 fps |
|---|---|---|---|---|---|---|
| iPhone18,2 | iOS 26.6.2 | 320 | 9.8 | 10.8 | 102 | ✅ |
| iPhone18,2 | iOS 26.6.2 | 256 | 8.5 | 9.2 | 117 | ✅ |

`iPhone18,2` is an iPhone 17 Pro Max. Measured 2026-10-10 from a Release build of commit `6e0a3d8`, front camera, one person in frame.

**Columns:**
- **Phone** is the machine identifier. Look it up at https://www.theiphonewiki.com/wiki/Models.
- **Latency** is the time from handing a frame to Vision to the decoded joints, so it covers resize, model and decode.
- **Max fps** is 1000 ÷ mean, the ceiling if the phone ran inference back to back.
- **Holds 15 fps** means p95 < 66.7 ms.

## What it means

- **Both sizes hold 15 fps by a wide margin.** The worst p95, 10.8 ms at 320, uses about a sixth of the 66.7 ms budget per frame at 15 fps.
- **Ship 320 as the default.** Dropping to 256 saves only 1.3 ms per frame (13%), and the larger input gives the model more pixels per joint, which matters with the phone 2–3 m away. Keep 256 as the fallback in Architecture §18 for slower phones.
- **Headroom at 15 fps:** the live view uses about 15% of this phone's inference capacity at 320 (15 ÷ 102) and about 13% at 256 (15 ÷ 117). The Neural Engine is idle most of the time, which is good news for the heat and battery concerns in §18.
- **AI-04's threshold:** the app falls back to cloud mode below about 12 fps (§4.1). This phone sits roughly 8× above that at 320.
- **Caveat: this is the newest, fastest iPhone.** The team's phones go back to the iPhone 12, which has an older Neural Engine. Expect higher latency there, likely still well within 15 fps, but measure at least one older phone before relying on 320 everywhere.
- **Not yet checked:** Neural Engine placement per layer (Xcode's Core ML Performance report, see how-it-works.md), and long-run thermal behaviour, since these were roughly 10 s runs.
