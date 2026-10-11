import { assessFraming, updateStability, FRAME_STALE_MS } from '../framing';
import type { PoseResult } from '@/pose/types';

const now = 10000;
const imageSize = { width: 1080, height: 1920 }, viewSize = { width: 360, height: 640 };
const result = (): PoseResult => ({ source: 'coreml', model: 'test', timestamp_ms: now, score: 0.9,
  joints: Array.from({ length: 17 }, (_, i) => ({ x: i % 2 ? 0.4 : 0.6, y: 0.2 + i / 30, c: 0.9 })) });
const check = (pose: PoseResult | undefined, size = viewSize, time = now) => assessFraming(pose, imageSize, size, true, time);

test('readiness requires all 17 confident joints and a fresh result', () => {
  expect(check(result()).kind).toBe('ready');
  const missing = result(); missing.joints[16].c = 0;
  expect(check(missing).kind).toBe('tracking');
  expect(check(undefined).kind).toBe('tracking');
  expect(check(result(), viewSize, now + FRAME_STALE_MS + 1).kind).toBe('tracking');
  const malformed = result(); malformed.joints[0].x = NaN;
  expect(check(malformed).kind).toBe('tracking');
});

test('joints in the source frame but outside the cropped preview are not ready', () => {
  const pose = result(); pose.joints[16].y = 0.95;
  expect(check(pose, { width: 360, height: 360 }).kind).toBe('distance');
});

test('off-center bodies get a centering hint without moving the chosen exercise spot', () => {
  const pose = result(); pose.joints.forEach(j => { j.x = 0.17; });
  expect(check(pose).kind).toBe('center');
});

test('a body too small in the preview gets a closer-phone hint', () => {
  const pose = result(); pose.joints.forEach((j, i) => { j.y = 0.45 + i / 200; });
  expect(check(pose).kind).toBe('closer');
});

test('readiness stabilizes over time and drops immediately on lost tracking', () => {
  const start = updateStability(null, true, now);
  expect(start.ready).toBe(false);
  expect(updateStability(start.since, true, now + 999).ready).toBe(false);
  expect(updateStability(start.since, true, now + 1000).ready).toBe(true);
  expect(updateStability(start.since, false, now + 900)).toEqual({ since: null, ready: false });
});
