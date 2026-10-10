"""Pure Python contract checks; no Databricks or Spark required."""
import hashlib
import hmac
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ns = {"__name__": "synthetic_contract"}
source = (ROOT / "databricks/notebooks/generate_synthetic_sessions.py").read_text()
exec(compile(source.split('dbutils.widgets.text(')[0], str(ROOT / 'databricks/notebooks/generate_synthetic_sessions.py'), 'exec'), ns)


class SyntheticContract(unittest.TestCase):
    def test_shared_manifest_and_presenter(self):
        path = str(ROOT / "data/demo-user-ids.json")
        ids = ns["load_seed_user_ids"](path, 30)
        self.assertEqual(ids, json.loads(Path(path).read_text()))
        self.assertEqual(ns["load_seed_user_ids"](path, 2, "presenter"), ["presenter", ids[1]])
        with self.assertRaises(ValueError):
            ns["load_seed_user_ids"](path, 31)

    def test_six_weeks_use_hmac_ids_and_valid_payloads(self):
        ids = ns["load_seed_user_ids"](str(ROOT / "data/demo-user-ids.json"), 2, "presenter")
        now = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
        rows = list(ns["generate"](ids, 6, "test-secret", {}, now))
        expected = {hmac.new(b"test-secret", u.encode(), hashlib.sha256).hexdigest()[:32] for u in ids}
        self.assertEqual({row[2]["user_id"] for row in rows}, expected)
        self.assertGreater((max(datetime.fromisoformat(r[0]) for r in rows) - min(datetime.fromisoformat(r[0]) for r in rows)).days, 35)
        self.assertEqual(len({r[1] for r in rows}), len(rows))
        self.assertTrue(all(r[2]["inference_mode"] == "coreml" for r in rows))
        self.assertTrue(all(len(f["kp"]) == 51 for r in rows for line in r[3] for f in json.loads(line)["frames"]))
        with tempfile.TemporaryDirectory() as volume:
            self.assertEqual(ns["write_sessions"](rows, volume), len(rows))
            self.assertEqual(len(list(Path(volume).glob("meta/*/*.json"))), len(rows))

    def test_exports_match_the_shared_schema(self):
        rows = list(ns["generate"](["demo-user-01"], 1, "test-secret",
                                  {"demo-user-01": ("knee", "left")},
                                  datetime(2026, 10, 10, 12, tzinfo=timezone.utc)))
        payloads = [{"def": "ExportMeta", "value": row[2]} for row in rows]
        payloads += [{"def": "ExportJointsLine", "value": json.loads(line)}
                     for row in rows for line in row[3]]
        script = '''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSchema } from './specs/validate.mjs';
const schema = JSON.parse(readFileSync('specs/set-record/schema.json', 'utf8'));
for (const payload of JSON.parse(readFileSync(0, 'utf8'))) {
  assert.deepEqual(validateSchema(payload.value, schema.$defs[payload.def], schema), []);
}
'''
        result = subprocess.run(["node", "--input-type=module", "-e", script],
                                input=json.dumps(payloads), text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
