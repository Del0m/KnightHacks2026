const fs = require('fs');
const os = require('os');
const path = require('path');

const { findModels, MODEL_NAMES } = require('../withPoseModels');

describe('findModels', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pose-models-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists both model names', () => {
    expect(MODEL_NAMES).toEqual(['yolov8n-pose-320', 'yolov8n-pose-256']);
  });

  it('returns absolute paths to both .mlpackage dirs when present', () => {
    for (const name of MODEL_NAMES) {
      fs.mkdirSync(path.join(dir, `${name}.mlpackage`));
    }

    const found = findModels(dir);

    expect(found).toHaveLength(2);
    expect(found[0].endsWith('yolov8n-pose-320.mlpackage')).toBe(true);
    expect(found[1].endsWith('yolov8n-pose-256.mlpackage')).toBe(true);
    for (const p of found) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it('throws with the export instruction when a model is missing', () => {
    fs.mkdirSync(path.join(dir, 'yolov8n-pose-320.mlpackage'));

    expect(() => findModels(dir)).toThrow(/uv run export\.py/);
    expect(() => findModels(dir)).toThrow(/ml\/pose_export/);
    expect(() => findModels(dir)).toThrow(/yolov8n-pose-256\.mlpackage/);
  });
});
