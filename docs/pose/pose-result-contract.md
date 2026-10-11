# Pose result contract

This is the one shape for "the joints of one person in one frame". Every pose source produces it: the on-device Core ML path (issue #41, `PoseCore/PoseResult.swift`), Apple Vision body pose (manual basic mode on iPhone), and the cloud endpoint for Android and slow iPhones (CONN-11). The rep counter and form rules (AI-06, AI-07) consume only this, so they can't tell which source the joints came from.

## Shape

```json
{
  "source": "coreml",
  "model": "yolov8n-pose-256",
  "timestamp_ms": 1739000000000,
  "score": 0.91,
  "joints": [ { "x": 0.52, "y": 0.18, "c": 0.97 }, "... 17 total" ]
}
```

| Field | Meaning |
|---|---|
| `source` | `"coreml"` (on-device YOLOv8), `"vision"` (Apple Vision body pose, manual basic mode on iPhone) or `"cloud"` (CONN-11) |
| `model` | Which model produced it, e.g. `yolov8n-pose-256`; `apple-vision-body-pose` for `"vision"` |
| `timestamp_ms` | Frame time, Unix milliseconds |
| `score` | Person-detection confidence, 0–1 |
| `joints` | Always 17 entries, in the order below |
| `joints[i].x`, `.y` | Normalized 0–1 relative to the **upright, unmirrored camera image**, origin top-left |
| `joints[i].c` | Per-joint confidence, 0–1 |

## Rules

- **No person found means no result:** `nil` in Swift, `null` in JSON. Never send an empty `joints` array.
- **Coordinates are in the unmirrored image.** Left and right are anatomical: `left_knee` is the lifter's real left knee. Mirroring the front-camera preview is a display concern and never changes these numbers.
- **Coordinates are relative to the original frame, not the model input.** Any letterboxing or padding added before inference is removed before the result is produced.
- **One person.** If a source sees several people, it returns the most confident one.

## Joint order (COCO)

| Index | Name | Index | Name |
|---|---|---|---|
| 0 | nose | 9 | left_wrist |
| 1 | left_eye | 10 | right_wrist |
| 2 | right_eye | 11 | left_hip |
| 3 | left_ear | 12 | right_hip |
| 4 | right_ear | 13 | left_knee |
| 5 | left_shoulder | 14 | right_knee |
| 6 | right_shoulder | 15 | left_ankle |
| 7 | left_elbow | 16 | right_ankle |
| 8 | right_elbow | | |

## Apple Vision mapping

The `"vision"` source (`PoseCore/VisionPoseMapper.swift`) converts `VNDetectHumanBodyPoseRequest` output to this shape.

| Vision joint | COCO index | Vision joint | COCO index |
|---|---|---|---|
| `.nose` | 0 | `.rightWrist` | 10 |
| `.leftEye` | 1 | `.leftHip` | 11 |
| `.rightEye` | 2 | `.rightHip` | 12 |
| `.leftEar` | 3 | `.leftKnee` | 13 |
| `.rightEar` | 4 | `.rightKnee` | 14 |
| `.leftShoulder` | 5 | `.leftAnkle` | 15 |
| `.rightShoulder` | 6 | `.rightAnkle` | 16 |
| `.leftElbow` | 7 | `.neck` | dropped |
| `.rightElbow` | 8 | `.root` | dropped |
| `.leftWrist` | 9 | | |

- **y is flipped.** Vision's origin is bottom-left, so `y = 1 - vy`. x is unchanged.
- **Missing joints** (not returned by Vision, or returned with confidence 0, which Vision places at its origin) get `x = 0`, `y = 0`, `c = 0`.
- **Out-of-range points** are clamped to 0–1.
- **`score`** is the mean confidence of the 17 mapped joints, with missing joints counted as 0. Below 0.25 means no person, the same threshold as `PoseDecoder.minScore`.
- **Several people:** the highest `score` wins.
- **Orientation and mirroring** follow the same rule as Core ML. Vision gets the same orientation from `ImageOrientation`, so its normalized points are already in the upright, unmirrored frame.

## Producing it on a server

A server running Ultralytics directly doesn't need to reimplement the decoder:

```python
r = model(frame, imgsz=320, verbose=False)[0]
if r.keypoints is None or len(r.boxes) == 0:
    result = None
else:
    i = int(r.boxes.conf.argmax())
    xyn = r.keypoints.xyn[i].tolist()   # 17 × [x, y], already normalized to the original frame
    conf = r.keypoints.conf[i].tolist() # 17 visibilities
    result = {
        "source": "cloud",
        "model": "yolov8n-pose-320",
        "timestamp_ms": ts,
        "score": float(r.boxes.conf[i]),
        "joints": [{"x": x, "y": y, "c": c} for (x, y), c in zip(xyn, conf)],
    }
```

The frame must already be upright and unmirrored before inference, as on the phone. A server running the raw exported model instead should follow the decode steps in [how-it-works.md](how-it-works.md).

## Cloud mode transport (CONN-11)

The output above is unchanged. How frames get to the cloud endpoint and back:

- **Transport:** a WebSocket from the phone to the SteadyForum API at `/pose/stream`. The API forwards each frame to the Hugging Face endpoint over HTTPS (`ml/cloud_endpoint/handler.py`) and relays the result. Hugging Face custom handlers are request/response only, so the WebSocket lives in the API.
- **Frame encoding:** one binary message per frame: an 8-byte big-endian float64 `timestamp_ms`, then a JPEG of about 320 px at about 10 fps. **The phone rotates the frame upright and unmirrored before sending**, so there is no orientation field.
- **Auth:** the phone sends its Neon Auth token (`Authorization: Bearer`, or `?token=` where headers can't be set). The HF token stays on the API server (§14).
- **Batching:** one result per frame on the same socket: `{"type":"pose","timestamp_ms":..,"result":<this contract or null>,"latency_ms":..,"endpoint_ms":..,"dropped":n}`.
- **Timeouts and backpressure:** one frame in flight per connection; a newer frame replaces any waiting one, so late frames are dropped, never queued (`dropped` counts them). While the endpoint scales up from zero the API sends `{"type":"status","status":"warming"}` and forwards at most one frame every 2 s; the phone shows its "reconnecting" state.

Full protocol: the header of `apps/api/src/routes/poseStream.ts`. Deploy and cost: `ml/cloud_endpoint/README.md`.

**Phone side (AI-17):** `apps/mobile/src/pose/cloud.ts` is the client: frame encoding, one frame in flight, a 2 s hold after a warming reply (the relay drops frames sent sooner, unanswered), an 8 s give-up on a frame with no reply, and reconnect with backoff and a fresh token. `cloudFrame.ts` encodes the JPEG inside the frame worklet with VisionCamera's `HybridFrameConverter` and nitro-image, so nothing runs on the JS thread. The conversion already applies the frame's orientation and mirroring (baked into the bitmap on Android, an orientation tag on iOS), so the client never rotates or mirrors again; it always redraws through `resize`, which is what turns the iOS tag into upright pixels. `usePoseOutput({ engine: 'cloud', cloud })` returns the same `PoseDetection`s as the on-device engines, and `usePoseMode(cloudCheck)` probes the relay so mode selection can pick `cloud` or `paused`.
