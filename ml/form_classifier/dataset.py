"""Load and validate an AI-09 labelling export bundle for AI-10.

The bundle is the JSON file the labelling tool exports (`labelling-export-all-bundle_*.json`):
`training_jsonl`, `clips_jsonl` and `manifest`. Each rep is joint-only: 32 frames x 17 joints x 2,
already normalised by `aspect-time-linear-v1` (ml/labelling/src/preprocess.ts).

The loader refuses anything it cannot check: checksum mismatches, unknown or inactive consent,
non-finite coordinates, wrong shapes or duplicate reps. Nothing is read from or written to the repo.
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np

FRAMES = 32
JOINTS = 17
PREPROCESSING_VERSION = "aspect-time-linear-v1"
EXERCISES = ("squat", "push_up", "bicep_curl", "shoulder_press", "lunge")


class BundleError(ValueError):
    """Raised when a bundle fails a check. The message names the check."""


@dataclass
class Rep:
    rep_id: str
    exercise_id: str
    label: str
    joints: np.ndarray  # (FRAMES, JOINTS, 2), float64
    validity: np.ndarray  # (FRAMES, JOINTS), bool
    duration_ms: float
    clip_id: str


@dataclass
class Bundle:
    reps: List[Rep]
    manifest: dict
    counts_by_exercise: Dict[str, int] = field(default_factory=dict)
    counts_by_label: Dict[str, int] = field(default_factory=dict)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _parse_lines(text: str, name: str) -> List[dict]:
    rows = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise BundleError(f"{name} line {number} is not valid JSON: {error}") from error
    return rows


def _check_consent(rep: dict, consents: Dict[str, dict]) -> None:
    consent = consents.get(rep.get("consent_reference"))
    if consent is None:
        raise BundleError(f"rep {rep.get('rep_id')} has no consent record in the manifest")
    if consent.get("status") != "active" or consent.get("allowed_use") is not True:
        raise BundleError(f"rep {rep.get('rep_id')} uses consent that is not active for training")
    if consent.get("participant_id") != rep.get("participant_id"):
        raise BundleError(f"rep {rep.get('rep_id')} consent belongs to another participant")


def _parse_rep(row: dict, clip_ids: set) -> Rep:
    rep_id = row.get("rep_id", "<missing>")
    if row.get("schema_version") != 1:
        raise BundleError(f"rep {rep_id} has an unsupported schema_version")
    if row.get("clip_id") not in clip_ids:
        raise BundleError(f"rep {rep_id} refers to a clip that is not in the bundle")
    if row.get("normalization", {}).get("preprocessing_version") != PREPROCESSING_VERSION:
        raise BundleError(f"rep {rep_id} was preprocessed with a different version")

    joints = np.asarray(row.get("joints"), dtype=np.float64)
    if joints.shape != (FRAMES, JOINTS, 2):
        raise BundleError(f"rep {rep_id} joints have shape {joints.shape}, expected {(FRAMES, JOINTS, 2)}")
    if not np.all(np.isfinite(joints)):
        raise BundleError(f"rep {rep_id} has non-finite joint coordinates")

    validity = np.asarray(row.get("validity"), dtype=bool)
    if validity.shape != (FRAMES, JOINTS):
        raise BundleError(f"rep {rep_id} validity has shape {validity.shape}, expected {(FRAMES, JOINTS)}")

    label = row.get("primary_label")
    if not label or not row.get("human_labels"):
        raise BundleError(f"rep {rep_id} has no human label")
    if row.get("exercise_id") not in EXERCISES:
        raise BundleError(f"rep {rep_id} has unknown exercise_id {row.get('exercise_id')!r}")

    return Rep(
        rep_id=rep_id,
        exercise_id=row["exercise_id"],
        label=label,
        joints=joints,
        validity=validity,
        duration_ms=float(row.get("duration_ms", 0.0)),
        clip_id=row["clip_id"],
    )


def load_bundle(path: str) -> Bundle:
    """Read one export bundle and return its validated reps.

    Pass the bundle path from outside the repo. Raises BundleError on the first failed check.
    """
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)

    manifest = raw.get("manifest") or {}
    checksums = manifest.get("checksums") or {}
    if raw.get("training_jsonl") is None or raw.get("clips_jsonl") is None:
        raise BundleError("bundle is missing training_jsonl or clips_jsonl")
    if _sha256(raw["training_jsonl"]) != checksums.get("training_jsonl"):
        raise BundleError("training_jsonl does not match the manifest checksum")
    if _sha256(raw["clips_jsonl"]) != checksums.get("clips_jsonl"):
        raise BundleError("clips_jsonl does not match the manifest checksum")

    consents = {c["reference"]: c for c in manifest.get("consents", [])}
    clip_ids = {clip["clip_id"] for clip in _parse_lines(raw["clips_jsonl"], "clips_jsonl")}

    reps: List[Rep] = []
    seen = set()
    for row in _parse_lines(raw["training_jsonl"], "training_jsonl"):
        _check_consent(row, consents)
        rep = _parse_rep(row, clip_ids)
        if rep.rep_id in seen:
            raise BundleError(f"duplicate rep_id {rep.rep_id}")
        seen.add(rep.rep_id)
        reps.append(rep)

    if not reps:
        raise BundleError("bundle contains no reps")

    by_exercise: Dict[str, int] = {}
    by_label: Dict[str, int] = {}
    for rep in reps:
        by_exercise[rep.exercise_id] = by_exercise.get(rep.exercise_id, 0) + 1
        by_label[rep.label] = by_label.get(rep.label, 0) + 1

    return Bundle(reps=reps, manifest=manifest, counts_by_exercise=by_exercise, counts_by_label=by_label)


def features(rep: Rep) -> np.ndarray:
    """Summary features for one rep: exercise one-hot, duration, and per-coordinate min, max, std.

    Invalid joints are excluded from the statistics. A joint with no valid frames contributes zeros.
    """
    one_hot = [1.0 if rep.exercise_id == name else 0.0 for name in EXERCISES]
    stats = []
    for joint in range(JOINTS):
        valid = rep.validity[:, joint]
        points = rep.joints[valid, joint, :] if valid.any() else np.zeros((1, 2))
        stats.extend(points.min(axis=0))
        stats.extend(points.max(axis=0))
        stats.extend(points.std(axis=0))
    return np.concatenate([np.array(one_hot), np.array([rep.duration_ms / 1000.0]), np.array(stats)])
