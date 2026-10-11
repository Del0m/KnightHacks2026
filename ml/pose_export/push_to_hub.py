"""Publish the pose and form models to the Hugging Face Hub (CONN-10, Architecture §5).

    uv run --group publish push_to_hub.py --dry-run     # build everything into hub_staging/, no upload
    uv run --group publish push_to_hub.py               # build and upload to bubblesmal/steadyforum-models

Also runs as a Databricks job (push_to_hub.job.json) after the form model is retrained (CONN-04).

What gets published:
  pose/yolov8n-pose-{320,256}.mlpackage   Core ML, what the iPhone app runs (same export as export.py)
  pose/yolov8n-pose-320.onnx              ONNX, for the cloud endpoint and other platforms
  form/form_quality_{label,score}.onnx    steadyforum.ml.form_quality@champion from Unity Catalog
  manifest.json                           version + every file's size and md5; the app reads this
  README.md                               model card

A model is only re-exported and re-uploaded when its source changes (pose: weights + export
settings; form: Unity Catalog version), and the manifest version only goes up when something
was uploaded. Core ML exports aren't byte-identical between runs, so without this every run
would make every phone re-download the pose models.

Token: HF_TOKEN (write access to the repo), or on Databricks the secret steadyforum/hf_write_token.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

try:
    HERE = Path(__file__).resolve().parent
except NameError:  # Databricks Python tasks exec the file without __file__; argv[0] is its path
    HERE = Path(sys.argv[0]).resolve().parent
sys.path.insert(0, str(HERE))
from export import ROWS, SIZES, ExportError, check_output  # noqa: E402

DEFAULT_REPO = os.environ.get("STEADYFORUM_HUB_REPO", "bubblesmal/steadyforum-models")
DEFAULT_FORM_MODEL = "models:/steadyforum.ml.form_quality@champion"
POSE_WEIGHTS = "yolov8n-pose.pt"
ONNX_SIZE = 320
POSE_SETTINGS = {"weights": POSE_WEIGHTS, "coreml_sizes": list(SIZES), "coreml_quantize": 16, "nms": False,
                 "onnx_size": ONNX_SIZE, "onnx_opset": 17, "rows": ROWS}

ON_DATABRICKS = "DATABRICKS_RUNTIME_VERSION" in os.environ


# ---- Helpers ----

def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def file_entries(root: Path, rel: Path) -> list[dict]:
    """Every file under root/rel (a file or an .mlpackage folder), with size and md5."""
    target = root / rel
    paths = [target] if target.is_file() else sorted(p for p in target.rglob("*") if p.is_file())
    return [{"path": str(p.relative_to(root)), "size": p.stat().st_size, "md5": md5(p)} for p in paths]


def hf_token() -> str:
    token = os.environ.get("HF_TOKEN")
    if not token and ON_DATABRICKS:
        from databricks.sdk.runtime import dbutils  # available on Databricks compute

        token = dbutils.secrets.get(scope="steadyforum", key="hf_write_token")
    if not token:
        raise SystemExit("No Hugging Face token: set HF_TOKEN (write access) or the steadyforum/hf_write_token secret")
    return token


def remote_manifest(api, repo: str) -> dict | None:
    from huggingface_hub import hf_hub_download

    # Checked explicitly: with force_download a missing repo surfaces as a generic ValueError.
    if not api.repo_exists(repo) or not api.file_exists(repo, "manifest.json"):
        return None
    path = hf_hub_download(repo, "manifest.json", token=api.token, force_download=True)
    return json.loads(Path(path).read_text())


# ---- Pose ----

def pose_source_key(weights: Path) -> str:
    import coremltools
    import ultralytics

    return sha256_text(json.dumps({
        "weights_sha256": hashlib.sha256(weights.read_bytes()).hexdigest(),
        "settings": POSE_SETTINGS,
        "ultralytics": ultralytics.__version__,
        "coremltools": coremltools.__version__,
    }, sort_keys=True))


def verify_coreml(package: Path, imgsz: int) -> None:
    import coremltools as ct

    model = ct.models.MLModel(str(package), skip_model_load=platform.system() != "Darwin")
    inp = model.get_spec().description.input[0]
    size = (inp.type.imageType.width, inp.type.imageType.height)
    if size != (imgsz, imgsz):
        raise ExportError(f"{package.name}: image input is {size}, expected {(imgsz, imgsz)}")
    if platform.system() == "Darwin":  # Core ML can only run on Apple platforms; elsewhere ONNX is the check
        from export import verify

        verify(package, imgsz)


def verify_onnx(path: Path, imgsz: int) -> None:
    import onnxruntime as ort
    from PIL import Image
    from ultralytics.utils import ASSETS

    image = Image.open(ASSETS / "bus.jpg").convert("RGB").resize((imgsz, imgsz))
    x = np.asarray(image, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    check_output(np.asarray(session.run(None, {session.get_inputs()[0].name: x})[0], dtype=np.float32), imgsz)


def build_pose(staging: Path, work: Path) -> tuple[str, dict]:
    from ultralytics import YOLO

    os.chdir(work)  # Ultralytics downloads weights and writes exports into the working directory
    model = YOLO(POSE_WEIGHTS)
    key = pose_source_key(work / POSE_WEIGHTS)
    out = staging / "pose"
    out.mkdir(parents=True, exist_ok=True)
    entries: dict[str, dict] = {}

    for imgsz in SIZES:
        exported = Path(model.export(format="coreml", imgsz=imgsz, quantize=16, nms=False))
        target = out / f"yolov8n-pose-{imgsz}.mlpackage"
        shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(exported), target)
        verify_coreml(target, imgsz)
        entries[f"pose-{imgsz}-coreml"] = {"format": "coreml", "imgsz": imgsz, "path": str(target.relative_to(staging))}
        print(f"pose: exported and verified {target.name}")

    exported = Path(model.export(format="onnx", imgsz=ONNX_SIZE, opset=17, nms=False))
    target = out / f"yolov8n-pose-{ONNX_SIZE}.onnx"
    shutil.move(str(exported), target)
    verify_onnx(target, ONNX_SIZE)
    entries[f"pose-{ONNX_SIZE}-onnx"] = {"format": "onnx", "imgsz": ONNX_SIZE, "path": str(target.relative_to(staging))}
    print(f"pose: exported and verified {target.name}")

    for entry in entries.values():
        entry.update(output=f"[1, {ROWS}, N] raw YOLOv8 pose candidates; see docs/pose/how-it-works.md")
    return key, entries


# ---- Form ----

def patch_skl2onnx() -> None:
    # skl2onnx 1.20 writes the Python bool False into the integer attribute
    # nodes_missing_value_tracks_true for HistGradientBoosting leaves, which onnx rejects
    # ("Expected an int, got a boolean"). Coerce it to int.
    import skl2onnx.common.tree_ensemble as te

    if getattr(te.add_node, "_steadyforum_patched", False):
        return
    original = te.add_node

    def add_node(*args, **kwargs):
        if "nodes_missing_value_tracks_true" in kwargs:
            kwargs["nodes_missing_value_tracks_true"] = int(kwargs["nodes_missing_value_tracks_true"])
        return original(*args, **kwargs)

    add_node._steadyforum_patched = True
    te.add_node = add_node


def form_source(model_uri: str) -> tuple[str, dict]:
    """Resolve the alias to a concrete version; that version is the source key."""
    from mlflow.tracking import MlflowClient

    name, _, alias = model_uri.removeprefix("models:/").partition("@")
    client = MlflowClient()
    version = client.get_model_version_by_alias(name, alias) if alias else None
    if version is None:
        raise SystemExit(f"{model_uri}: expected models:/<name>@<alias>")
    metrics = client.get_run(version.run_id).data.metrics
    meta = {"uc_model": name, "uc_alias": alias, "uc_version": str(version.version), "run_id": version.run_id,
            "metrics": {k: round(v, 4) for k, v in metrics.items() if k.startswith(("label_", "quality_", "test_"))}}
    return sha256_text(f"{name}:{version.version}:{version.run_id}"), meta


def build_form(staging: Path, model_uri: str, meta: dict) -> dict:
    import mlflow
    import pandas as pd
    from skl2onnx import to_onnx
    from skl2onnx.common.data_types import FloatTensorType, StringTensorType

    patch_skl2onnx()
    wrapper = mlflow.pyfunc.load_model(f"models:/{meta['uc_model']}/{meta['uc_version']}").unwrap_python_model()
    if not hasattr(getattr(wrapper, "classifier", None), "named_steps"):
        # Versions trained before the one-hot change use categorical splits, which skl2onnx can't export.
        raise SystemExit(
            f"{meta['uc_model']} v{meta['uc_version']} (@{meta['uc_alias']}) predates the one-hot pipeline and "
            "can't be exported to ONNX. Re-run databricks/notebooks/form_model.py, then point the "
            f"'{meta['uc_alias']}' alias at the new version (Catalog > model > version > Set alias)."
        )
    features: list[str] = list(wrapper.features)
    numeric = [f for f in features if f != "exercise_id"]
    inputs = [("exercise_id", StringTensorType([None, 1]))] + [(f, FloatTensorType([None, 1])) for f in numeric]

    # Check sample: every trained exercise plus an unseen one, with some missing values.
    encoder = wrapper.classifier.named_steps["encode"].named_transformers_["exercise"]
    exercises = list(encoder.categories_[0]) + ["not_a_real_exercise"]
    rng = np.random.default_rng(0)
    sample = pd.DataFrame({"exercise_id": rng.choice(exercises, 200)})
    for f in numeric:
        sample[f] = rng.normal(80, 40, 200)
        sample.loc[sample.index[::9], f] = np.nan
    feed = {"exercise_id": sample[["exercise_id"]].to_numpy().astype(object),
            **{f: sample[[f]].to_numpy().astype(np.float32) for f in numeric}}

    import onnxruntime as ort

    out = staging / "form"
    out.mkdir(parents=True, exist_ok=True)
    entries = {}
    for kind, pipeline in (("label", wrapper.classifier), ("score", wrapper.regressor)):
        options = {id(pipeline.named_steps["model"]): {"zipmap": False}} if kind == "label" else None
        onx = to_onnx(pipeline, initial_types=inputs, target_opset=17, options=options)
        path = out / f"form_quality_{kind}.onnx"
        path.write_bytes(onx.SerializeToString())

        got = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]).run(None, feed)[0].ravel()
        expected = pipeline.predict(sample[features])
        if kind == "label":
            agreement = float((got == expected).mean())
            if agreement < 0.99:
                raise ExportError(f"{path.name}: ONNX labels agree with scikit-learn on only {agreement:.1%}")
            check = f"label agreement {agreement:.1%}"
        else:
            diff = float(np.abs(got.astype(np.float64) - expected).max())
            if diff > 1e-3:
                raise ExportError(f"{path.name}: ONNX scores differ from scikit-learn by up to {diff:.2e}")
            check = f"max score diff {diff:.1e}"
        entries[f"form-quality-{kind}-onnx"] = {
            "format": "onnx", "path": str(path.relative_to(staging)), "inputs": features,
            "output": "label (string)" if kind == "label" else "quality before clipping to 0-1",
            **{k: meta[k] for k in ("uc_model", "uc_version")},
        }
        print(f"form: exported and verified {path.name} ({check})")
    return entries


# ---- Card ----

def model_card(repo: str, manifest: dict) -> str:
    models = manifest["models"]
    form = next((m for k, m in models.items() if k.startswith("form-")), None)
    form_meta = manifest.get("form", {})
    rows = "\n".join(
        f"| `{name}` | {m['format']} | `{m['path']}` | {sum(f['size'] for f in m['files']) / 1e6:.1f} MB |"
        for name, m in sorted(models.items())
    )
    metrics = ", ".join(f"{k} {v}" for k, v in sorted(form_meta.get("metrics", {}).items())) or "n/a"
    return f"""---
license: agpl-3.0
library_name: coreml
tags:
  - pose-estimation
  - keypoint-detection
  - fitness
  - coreml
  - onnx
base_model: Ultralytics/YOLOv8
---

# SteadyForum models

Models for **SteadyForum**, a quiet AI coach for new gym-goers and people returning from injury
(Knight Hacks IX). The iPhone app runs the pose model on-device; the form model scores reps.
The app reads `manifest.json` on launch and downloads any model that changed.

Manifest version **{manifest['version']}**, published {manifest['published_at']}.

| Model | Format | Path | Size |
|---|---|---|---|
{rows}

## Pose: YOLOv8n-pose

- Ultralytics YOLOv8n-pose (COCO keypoints), exported at 320 and 256 px to Core ML (FP16, no NMS)
  and at 320 px to ONNX.
- Output: one tensor `[1, {ROWS}, N]` of raw candidates: 4 box values, person confidence, then
  17 joints x (x, y, visibility), with sigmoid already applied. Decoding and orientation rules:
  `docs/pose/how-it-works.md` and `docs/pose/pose-result-contract.md` in the SteadyForum repo.
- Video never leaves the phone; only joint positions are sent to the cloud.

## Form quality

- `{form_meta.get('uc_model', 'steadyforum.ml.form_quality')}` version {form_meta.get('uc_version', '?')}
  from Databricks Unity Catalog, as two ONNX graphs: `label` (clean, partial_range, knees_in,
  forward_lean, fast_lowering, other) and `score` (quality, clip to 0-1).
- Inputs, one row per rep: {', '.join(f'`{f}`' for f in (form or {}).get('inputs', [])) or 'see manifest'}.
  `exercise_id` is a string; unseen exercises are ignored. Numeric inputs may be missing (NaN).
- Held-out metrics: {metrics}.
- **Limitations:** a baseline gradient-boosted model trained on labels derived from the phone's
  rule flags and synthetic sessions, not hand-labelled clips. Expect it to be replaced.

## Intended use

Real-time rep counting and form feedback for recreational lifting. **Not a medical device** and
not for diagnosing injuries.

## License

The pose model is derived from Ultralytics YOLOv8 and is released under **AGPL-3.0**, the license
of the original weights.
"""


# ---- Main ----

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--form-model", default=DEFAULT_FORM_MODEL)
    parser.add_argument("--staging", type=Path, default=HERE / "hub_staging")
    parser.add_argument("--dry-run", action="store_true", help="build and verify, don't upload")
    parser.add_argument("--skip-pose", action="store_true")
    parser.add_argument("--skip-form", action="store_true")
    parser.add_argument("--force", action="store_true", help="re-export and upload even if sources are unchanged")
    args = parser.parse_args()

    from huggingface_hub import HfApi

    api = HfApi(token=None if args.dry_run and not os.environ.get("HF_TOKEN") else hf_token())
    previous = (remote_manifest(api, args.repo) if api.token else None) or {"version": 0, "models": {}, "sources": {}}
    sources = dict(previous.get("sources", {}))
    models = dict(previous.get("models", {}))
    changed: list[str] = []

    shutil.rmtree(args.staging, ignore_errors=True)
    args.staging.mkdir(parents=True)

    if not args.skip_pose:
        with tempfile.TemporaryDirectory() as work:
            os.chdir(work)
            from ultralytics import YOLO

            YOLO(POSE_WEIGHTS)  # downloads the weights so the source key can be computed
            key = pose_source_key(Path(work) / POSE_WEIGHTS)
            if key != sources.get("pose") or args.force:
                _, entries = build_pose(args.staging, Path(work))
                models = {k: v for k, v in models.items() if not k.startswith("pose-")} | entries
                sources["pose"] = key
                changed.append("pose")
            else:
                print("pose: unchanged since the last publish, skipping")
            os.chdir(HERE)

    form_meta = previous.get("form", {})
    if not args.skip_form:
        import mlflow

        if ON_DATABRICKS:
            mlflow.set_registry_uri("databricks-uc")
        key, meta = form_source(args.form_model)
        if key != sources.get("form") or args.force:
            entries = build_form(args.staging, args.form_model, meta)
            models = {k: v for k, v in models.items() if not k.startswith("form-")} | entries
            sources["form"] = key
            form_meta = meta
            changed.append("form")
        else:
            print(f"form: {meta['uc_model']} v{meta['uc_version']} already published, skipping")

    if not changed:
        print("Nothing changed; the Hub is up to date.")
        return

    for name in changed:
        for model_name, entry in models.items():
            if model_name.startswith(f"{name}-"):
                entry["files"] = file_entries(args.staging, Path(entry["path"]))

    manifest = {
        "schema": 1,
        "version": int(previous.get("version", 0)) + 1,
        "published_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "repo": args.repo,
        "models": models,
        "sources": sources,
        "form": form_meta,
    }
    (args.staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.staging / "README.md").write_text(model_card(args.repo, manifest))
    print(f"manifest v{manifest['version']}: {', '.join(changed)} changed; staged in {args.staging}")

    if args.dry_run:
        print("Dry run: nothing uploaded.")
        return

    api.create_repo(args.repo, repo_type="model", exist_ok=True)
    api.upload_folder(
        repo_id=args.repo,
        folder_path=args.staging,
        commit_message=f"Publish models v{manifest['version']} ({', '.join(changed)})",
        delete_patterns=[f"{name}/**" for name in changed],  # drop old files of re-exported models
    )
    print(f"Uploaded to https://huggingface.co/{args.repo} (manifest v{manifest['version']})")


if __name__ == "__main__":
    main()
