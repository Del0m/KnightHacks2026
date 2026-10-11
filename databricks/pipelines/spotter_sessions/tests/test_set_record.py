import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FIXTURES = ROOT / "specs/set-record/fixtures/valid"


def test_phone_payloads_survive_bronze_and_silver(tmp_path, run_pipeline):
    template = json.loads((FIXTURES / "ExportMeta/minimal.json").read_text())
    expected = {}
    for path in sorted((FIXTURES / "SetRecord").glob("*.json")):
        if path.stem == "minimal":
            continue
        record = json.loads(path.read_text())
        session_id = path.stem
        set_index = 3
        meta_set = {key: record[key] for key in (
            "exercise_id", "weight_kg", "end_reason", "partial_reps", "reps")}
        meta_set.update(set_index=set_index, medal=None, frame_count=len(record["frames"]))
        joints = {"session_id": session_id, "set_index": set_index,
                  "exercise_id": record["exercise_id"], "fps": record["fps"], "frames": record["frames"]}
        joints_path = tmp_path / "joints/2026-10-10" / f"{session_id}.ndjson.gz"
        joints_path.parent.mkdir(parents=True, exist_ok=True)
        joints_path.write_bytes(gzip.compress((json.dumps(joints) + "\n").encode()))
        meta = dict(template, session_id=session_id, joints_path=str(joints_path), sets=[meta_set])
        meta_path = tmp_path / "meta/2026-10-10" / f"{session_id}.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta))
        expected[session_id] = (meta_set, joints)

    assert expected
    tables = run_pipeline(tmp_path)
    metadata_rows = tables["bronze_sessions"].collect()
    assert len(metadata_rows) == len(expected)
    for row in metadata_rows:
        assert row.sets[0].asDict(recursive=True) == expected[row.session_id][0]
    joint_rows = tables["bronze_set_joints"].collect()
    assert len(joint_rows) == len(expected)
    for row in joint_rows:
        actual = row.asDict(recursive=True)
        wanted = expected[row.session_id][1]
        assert {key: actual[key] for key in wanted} == wanted
    silver = tables["silver_reps"].collect()
    assert len(silver) == sum(len(meta["reps"]) for meta, _joints in expected.values())
    for row in silver:
        assert row.set_index == 3
        rep = expected[row.session_id][0]["reps"][row.rep_index]
        assert row.quality is None
        assert row.is_clean == (len(rep["flags"]) == 0)
