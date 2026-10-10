# Pose result contract

This is the one shape for "the joints of one person in one frame". Every pose source produces it: the on-device Core ML path (issue #41, `PoseCore/PoseResult.swift`) today, and the cloud endpoint for non-iPhone users (CONN-11) later. The rep counter and form rules (AI-06, AI-07) consume only this, so they can't tell which source the joints came from.

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
| `source` | `"coreml"` (on-device) or `"cloud"` (CONN-11) |
| `model` | Which model produced it, e.g. `yolov8n-pose-256` |
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

## Open for CONN-11

The output above is fixed. These are not decided yet:

- **Transport:** WebSocket, per Architecture §4.1.
- **Frame encoding:** JPEG at about 320 px and about 10 fps, per §4.1, plus how orientation is conveyed (rotate on the phone before sending, or send an orientation field).
- **Auth:** how the phone authenticates to the endpoint, which per §14 goes through the Spotter API rather than holding an HF token.
- **Batching:** one result per frame, or a per-frame stream on one socket.
- **Timeouts and backpressure:** what the phone does when a result is late (drop frames, not queue them, matching on-device behavior).
