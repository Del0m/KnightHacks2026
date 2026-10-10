import { BONES, JOINT_NAMES, isPoseResult } from '../types';

const contractExample = {
  source: 'coreml',
  model: 'yolov8n-pose-256',
  timestamp_ms: 1739000000000,
  score: 0.91,
  joints: Array.from({ length: 17 }, () => ({ x: 0.52, y: 0.18, c: 0.97 })),
};

describe('JOINT_NAMES', () => {
  it('lists the 17 COCO joints in contract order', () => {
    expect(JOINT_NAMES.length).toBe(17);
    expect(JOINT_NAMES[9]).toBe('left_wrist');
    expect(JOINT_NAMES[16]).toBe('right_ankle');
  });
});

describe('BONES', () => {
  it('has 16 pairs of valid joint indices', () => {
    expect(BONES.length).toBe(16);
    for (const [a, b] of BONES) {
      for (const i of [a, b]) {
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('isPoseResult', () => {
  it('accepts the contract example', () => {
    expect(isPoseResult(contractExample)).toBe(true);
  });

  it('rejects empty joints', () => {
    expect(isPoseResult({ ...contractExample, joints: [] })).toBe(false);
  });

  it('rejects 16 joints', () => {
    expect(isPoseResult({ ...contractExample, joints: contractExample.joints.slice(0, 16) })).toBe(false);
  });

  it('rejects null', () => {
    expect(isPoseResult(null)).toBe(false);
  });

  it('accepts every pose source', () => {
    for (const source of ['coreml', 'vision', 'cloud']) {
      expect(isPoseResult({ ...contractExample, source })).toBe(true);
    }
  });

  it('rejects an unknown source', () => {
    expect(isPoseResult({ ...contractExample, source: 'mlkit' })).toBe(false);
  });
});
