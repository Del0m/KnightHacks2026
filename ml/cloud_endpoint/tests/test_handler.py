"""Runs the real handler (YOLOv8n-pose on CPU) against Ultralytics' sample image."""

import base64
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from handler import EndpointHandler, decode_frame  # noqa: E402


@pytest.fixture(scope="module")
def handler(tmp_path_factory):
    import os

    os.chdir(tmp_path_factory.mktemp("weights"))  # Ultralytics downloads weights into the cwd
    return EndpointHandler(path="")


@pytest.fixture(scope="module")
def frame_jpeg() -> bytes:
    from ultralytics.utils import ASSETS

    image = Image.open(ASSETS / "bus.jpg").convert("RGB")
    image.thumbnail((320, 320))  # what the phone sends: ~320 px JPEG
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def test_returns_the_pose_result_contract(handler, frame_jpeg):
    out = handler({"inputs": base64.b64encode(frame_jpeg).decode(), "parameters": {"timestamp_ms": 1739000000000}})
    r = out["result"]
    assert r["source"] == "cloud"
    assert r["model"] == "yolov8n-pose-320"
    assert r["timestamp_ms"] == 1739000000000
    assert 0 < r["score"] <= 1
    assert len(r["joints"]) == 17
    for j in r["joints"]:
        assert set(j) == {"x", "y", "c"}
        assert 0 <= j["c"] <= 1
        assert -0.05 <= j["x"] <= 1.05 and -0.05 <= j["y"] <= 1.05  # normalized to the frame
    assert out["latency_ms"] > 0


def test_no_person_means_null_not_empty_joints(handler):
    buf = io.BytesIO()
    Image.new("RGB", (320, 240), (40, 40, 40)).save(buf, format="JPEG")
    assert handler({"inputs": base64.b64encode(buf.getvalue()).decode()})["result"] is None


def test_accepts_bytes_and_pil_like_the_toolkit_sends(handler, frame_jpeg):
    from_bytes = handler({"inputs": frame_jpeg, "parameters": {"timestamp_ms": 1}})["result"]
    from_pil = handler({"inputs": Image.open(io.BytesIO(frame_jpeg)), "parameters": {"timestamp_ms": 1}})["result"]
    assert from_bytes["joints"] == from_pil["joints"]


@pytest.mark.parametrize(
    "inputs, message",
    [
        ("not base64!!", "base64"),
        (b"definitely not a jpeg", "readable image"),
        (12345, "base64 string, bytes or an image"),
        (b"x" * 2_000_001, "downscaled JPEG"),
    ],
)
def test_rejects_bad_frames(inputs, message):
    with pytest.raises(ValueError, match=message):
        decode_frame(inputs)


def test_rejects_full_resolution_frames():
    with pytest.raises(ValueError, match="downscaled frame"):
        decode_frame(Image.new("RGB", (3024, 4032)))
