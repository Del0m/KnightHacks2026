"""Export YOLOv8n-pose to Core ML at 320 and 256 px for the PoseBench app.

Run from anywhere:  uv run export.py
Writes PoseBench/PoseBench/Models/yolov8n-pose-{320,256}.mlpackage.
See docs/pose/how-it-works.md for the output layout this script verifies.
"""

import os
import shutil
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "PoseBench" / "PoseBench" / "Models"
SIZES = (320, 256)
ROWS = 56  # 4 box + 1 person confidence + 17 joints x (x, y, visibility)


class ExportError(Exception):
    pass


def expected_candidates(imgsz: int) -> int:
    """One candidate per grid cell across YOLO's three strides (8, 16, 32)."""
    return sum((imgsz // stride) ** 2 for stride in (8, 16, 32))


def check_output(arr: np.ndarray, imgsz: int) -> None:
    """Fail loudly if the raw output isn't the [1, 56, N] layout the app decodes."""
    shape = (1, ROWS, expected_candidates(imgsz))
    if arr.shape != shape:
        raise ExportError(f"output shape {arr.shape}, expected {shape}")
    for name, rows in (("person confidence", [4]), ("joint visibility", list(range(7, ROWS, 3)))):
        values = arr[0, rows, :]
        if values.min() < 0 or values.max() > 1:
            raise ExportError(
                f"{name} outside [0, 1] (min {values.min():.3f}, max {values.max():.3f}); "
                "the export no longer applies sigmoid, so PoseDecoder would misread it"
            )


def export_size(imgsz: int) -> Path:
    from ultralytics import YOLO

    exported = Path(YOLO("yolov8n-pose.pt").export(format="coreml", imgsz=imgsz, quantize=16, nms=False))
    target = HERE / f"yolov8n-pose-{imgsz}.mlpackage"
    if target.exists():
        shutil.rmtree(target)
    exported.rename(target)
    return target


def verify(package: Path, imgsz: int) -> None:
    import coremltools as ct
    from PIL import Image
    from ultralytics.utils import ASSETS

    model = ct.models.MLModel(str(package))
    inp = model.get_spec().description.input[0]
    size = (inp.type.imageType.width, inp.type.imageType.height)
    if size != (imgsz, imgsz):
        raise ExportError(f"{package.name}: image input is {size}, expected {(imgsz, imgsz)}")
    image = Image.open(ASSETS / "bus.jpg").convert("RGB").resize((imgsz, imgsz))
    outputs = model.predict({inp.name: image})
    if len(outputs) != 1:
        raise ExportError(f"{package.name}: expected one output, got {list(outputs)}")
    check_output(np.asarray(next(iter(outputs.values())), dtype=np.float32), imgsz)


def main() -> None:
    os.chdir(HERE)  # Ultralytics downloads weights and writes exports next to this script
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for imgsz in SIZES:
        package = export_size(imgsz)
        verify(package, imgsz)
        dest = MODELS_DIR / package.name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(package), dest)
        print(f"wrote {dest.relative_to(HERE)}")


if __name__ == "__main__":
    main()
