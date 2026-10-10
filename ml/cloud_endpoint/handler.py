"""CONN-11: Hugging Face Inference Endpoint custom handler for cloud pose mode (Architecture §4.1).

Phones that can't run YOLOv8n-pose on-device stream frames to the Spotter API over a WebSocket;
the API forwards each frame here and relays the joints back. This handler returns exactly the
pose result contract (docs/pose/pose-result-contract.md), so the phone's rep counter and form
rules can't tell cloud results from on-device ones.

Request (JSON, one frame):
    {"inputs": "<base64 JPEG>", "parameters": {"timestamp_ms": 1739000000000}}
  `inputs` may also arrive as raw bytes or a PIL image (the toolkit decodes image/* bodies).
  Frames must already be upright and unmirrored; the phone rotates before sending.

Response:
    {"result": {source, model, timestamp_ms, score, joints[17]} | null, "latency_ms": 12.3}
  `result` is null when no person is found, never an empty joints array.

Privacy: frames are decoded in memory and dropped after inference. Nothing is written to disk
and nothing about the image is logged.
"""

from __future__ import annotations

import base64
import binascii
import io
import os
import time
from pathlib import Path
from typing import Any

from PIL import Image

MAX_BYTES = 2_000_000  # a 320 px JPEG is ~20-40 KB; anything this big isn't a phone frame
MAX_SIDE = 1920
JOINTS = 17


def decode_frame(inputs: Any) -> Image.Image:
    """Base64 string, raw bytes or a PIL image -> RGB PIL image, entirely in memory."""
    if isinstance(inputs, Image.Image):
        image = inputs
    else:
        if isinstance(inputs, str):
            try:
                inputs = base64.b64decode(inputs, validate=True)
            except (binascii.Error, ValueError) as err:
                raise ValueError("inputs must be a base64-encoded JPEG") from err
        if not isinstance(inputs, (bytes, bytearray)):
            raise ValueError("inputs must be a base64 string, bytes or an image")
        if len(inputs) > MAX_BYTES:
            raise ValueError(f"frame is {len(inputs)} bytes; send a downscaled JPEG (~320 px)")
        try:
            image = Image.open(io.BytesIO(inputs))
            image.load()
        except Exception as err:  # PIL raises several types for bad data
            raise ValueError("inputs is not a readable image") from err
    if max(image.size) > MAX_SIDE:
        raise ValueError(f"frame is {image.size[0]}x{image.size[1]}; send a downscaled frame (~320 px)")
    return image.convert("RGB")


def to_pose_result(r: Any, model_name: str, timestamp_ms: int) -> dict | None:
    """Ultralytics result -> pose result contract (most confident person), or None."""
    if r.keypoints is None or r.boxes is None or len(r.boxes) == 0:
        return None
    i = int(r.boxes.conf.argmax())
    xyn = r.keypoints.xyn[i].tolist()  # 17 x [x, y], normalized to the original frame
    conf = r.keypoints.conf[i].tolist() if r.keypoints.conf is not None else [1.0] * JOINTS
    if len(xyn) != JOINTS:
        return None
    return {
        "source": "cloud",
        "model": model_name,
        "timestamp_ms": timestamp_ms,
        "score": round(float(r.boxes.conf[i]), 4),
        "joints": [{"x": round(x, 5), "y": round(y, 5), "c": round(c, 4)} for (x, y), c in zip(xyn, conf)],
    }


class EndpointHandler:
    def __init__(self, path: str = ""):
        import torch
        from ultralytics import YOLO

        # Weights shipped in the endpoint's repo if present, otherwise Ultralytics downloads them.
        bundled = Path(path) / "yolov8n-pose.pt"
        self.imgsz = int(os.environ.get("POSE_IMGSZ", "320"))
        self.device = 0 if torch.cuda.is_available() else "cpu"
        self.model = YOLO(str(bundled) if bundled.exists() else "yolov8n-pose.pt")
        self.model_name = f"yolov8n-pose-{self.imgsz}"
        # Warm-up, so the first real frame isn't slow.
        self.model(Image.new("RGB", (self.imgsz, self.imgsz)), imgsz=self.imgsz, device=self.device, verbose=False)

    def __call__(self, data: dict[str, Any]) -> dict[str, Any]:
        started = time.perf_counter()
        params = data.get("parameters") or {}
        timestamp_ms = int(params.get("timestamp_ms") or time.time() * 1000)
        image = decode_frame(data.get("inputs", data))
        r = self.model(image, imgsz=self.imgsz, device=self.device, verbose=False)[0]
        return {
            "result": to_pose_result(r, self.model_name, timestamp_ms),
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }
