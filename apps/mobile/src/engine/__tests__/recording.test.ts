import { compactPose, createClipRecorder, isAbsentFrame } from '../recording';
import { isPoseResult, JOINT_NAMES, type PoseResult } from '../../pose/types';

const pose: PoseResult = {
  source: 'coreml',
  model: 'yolov8n-pose-320',
  timestamp_ms: 1000,
  score: 0.912345,
  joints: JOINT_NAMES.map((_, i) => ({ x: 0.123456789 + i / 100, y: 0.5, c: 0.876 })),
};

describe('clip recorder', () => {
  it('rounds coordinates and keeps the pose valid', () => {
    const c = compactPose(pose);
    expect(isPoseResult(c)).toBe(true);
    expect(c.joints[0]).toEqual({ x: 0.1235, y: 0.5, c: 0.88 });
    expect(c.score).toBe(0.91);
  });

  it('records poses and no-person frames as a clip', () => {
    const rec = createClipRecorder({ exercise: 'squat', image: { width: 1080, height: 1920 } });
    rec.add({ result: pose, latencyMs: 8 }, 1001);
    rec.add({ latencyMs: 8 }, 1070);
    expect(rec.length).toBe(2);
    const clip = rec.toClip('squat_recorded_1');
    expect(clip).toMatchObject({ name: 'squat_recorded_1', exercise: 'squat', source: 'recorded' });
    expect(clip.expected).toBeUndefined();
    expect(isAbsentFrame(clip.frames[0])).toBe(false);
    expect(clip.frames[1]).toEqual({ absent: true, timestamp_ms: 1070 });
    // A recorded clip round-trips through JSON unchanged.
    expect(JSON.parse(JSON.stringify(clip))).toEqual(clip);
  });
});
