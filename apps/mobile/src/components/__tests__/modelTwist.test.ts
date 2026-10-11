import { gestureKind, twistDelta } from '../../../public/model/twist';

const pair = (angle: number) => [{ x: 0, y: 0 }, { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) }];
test('opposing finger motion rotates in both directions', () => {
  expect(twistDelta(pair(0), pair(Math.PI / 4))).toBeCloseTo(Math.PI / 4);
  expect(twistDelta(pair(0), pair(-Math.PI / 4))).toBeCloseTo(-Math.PI / 4);
});
test('pan and pinch without twist do not rotate', () => {
  expect(twistDelta(pair(0), [{ x: 40, y: 20 }, { x: 240, y: 20 }])).toBe(0);
});
test('crossing the angle seam follows the short arc', () => {
  expect(twistDelta(pair(Math.PI - .1), pair(-Math.PI + .1))).toBeCloseTo(.2);
});
test('starting and overlapping touches do not jump the camera', () => {
  expect(twistDelta(null, pair(0))).toBe(0);
  expect(twistDelta(pair(0), [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
});
test('twisting chooses rotation despite small centroid drift', () => {
  expect(gestureKind(pair(0), pair(.3).map(point => ({ x: point.x + 2, y: point.y + 2 })))).toBe('rotate');
});
test('pan, pinch and initial touch noise are distinct', () => {
  expect(gestureKind(pair(0), [{ x: 25, y: 30 }, { x: 125, y: 30 }])).toBe('pan');
  expect(gestureKind(pair(0), [{ x: -20, y: 0 }, { x: 120, y: 0 }])).toBe('zoom');
  expect(gestureKind(pair(0), pair(.01))).toBe(null);
  expect(gestureKind(null, pair(.5))).toBe(null);
});
