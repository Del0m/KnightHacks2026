"""CONN-12 publisher: honours STEADYFORUM_DATASET_REPO from apps/api/.env, and refuses to publish a
selection with non-synthetic sessions.

    uv run --with pytest --with pyarrow --with requests --with huggingface_hub pytest ml/space
"""
import importlib.util
import os
import sys
import types
from pathlib import Path

import pyarrow as pa
import pytest

HERE = Path(__file__).resolve().parent


def load(monkeypatch, tmp_path, env_text):
    (tmp_path / "apps" / "api").mkdir(parents=True)
    (tmp_path / "apps" / "api" / ".env").write_text(env_text)
    spec = importlib.util.spec_from_file_location("publish_dataset", HERE / "publish_dataset.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "OUT", tmp_path / "out")
    monkeypatch.delenv("STEADYFORUM_DATASET_REPO", raising=False)
    return module


def rows(devices):
    window = [[0.0] * 34] * 32
    return pa.table({
        "rep_id": [f"r{i}" for i in range(len(devices))],
        "lifter_id": [f"lifter-{i}" for i in range(len(devices))],
        "session_date": ["2026-10-10"] * len(devices),
        "exercise_id": ["squat"] * len(devices),
        "experience_level": ["beginner"] * len(devices),
        "frame_count": [32] * len(devices),
        "window": [window] * len(devices),
        "flags": [[]] * len(devices),
        "label": ["clean"] * len(devices),
        "device": devices,
    })


def test_pushes_to_the_repo_set_in_dot_env(monkeypatch, tmp_path):
    module = load(monkeypatch, tmp_path, "STEADYFORUM_DATASET_REPO=review-owner/custom-dataset\nHF_WRITE_TOKEN=hf_test\n")
    monkeypatch.setattr(module, "query_arrow", lambda sql: rows(["synthetic"]) if "DISTINCT" in sql else rows(["synthetic"]).drop(["device"]))
    calls = []

    class FakeApi:
        def __init__(self, token):
            pass

        def create_repo(self, repo, **_):
            calls.append(("create", repo))

        def upload_folder(self, repo_id, **_):
            calls.append(("folder", repo_id))

        def upload_file(self, repo_id, **_):
            calls.append(("file", repo_id))

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(HfApi=FakeApi))
    monkeypatch.setattr(sys, "argv", ["publish_dataset.py"])
    module.main()
    assert calls == [("create", "review-owner/custom-dataset"), ("folder", "review-owner/custom-dataset"),
                     ("file", "review-owner/custom-dataset")]
    os.environ.pop("STEADYFORUM_DATASET_REPO", None)
    os.environ.pop("HF_WRITE_TOKEN", None)


def test_refuses_a_selection_with_real_sessions(monkeypatch, tmp_path):
    module = load(monkeypatch, tmp_path, "")
    monkeypatch.setattr(module, "query_arrow", lambda sql: rows(["synthetic", "iPhone 15"]))
    monkeypatch.setattr(sys, "argv", ["publish_dataset.py", "--dry-run"])
    with pytest.raises(SystemExit, match="non-synthetic"):
        module.main()
    assert not (tmp_path / "out").exists()


def test_query_selects_only_synthetic_sessions():
    source = (HERE / "publish_dataset.py").read_text()
    assert "WHERE f.device = '{SYNTHETIC_DEVICE}'" in source
    assert 'SYNTHETIC_DEVICE = "synthetic"' in source
