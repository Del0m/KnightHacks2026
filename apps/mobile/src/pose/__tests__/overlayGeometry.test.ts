import { jointToView } from '../overlayGeometry';

const image = { width: 1080, height: 1920 };

const expectNear = (actual: number, expected: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.1);
};

// Same numbers as PoseCore's OverlayGeometryTests.swift.
describe('jointToView contain', () => {
  const view = { width: 390, height: 844 };

  it('maps the centre to the view centre', () => {
    const p = jointToView({ x: 0.5, y: 0.5 }, image, view, false, 'contain');
    expectNear(p.x, 195);
    expectNear(p.y, 422);
  });

  it('letterboxes the top-left corner', () => {
    const p = jointToView({ x: 0, y: 0 }, image, view, false, 'contain');
    expectNear(p.x, 0);
    expectNear(p.y, 75.3);
  });

  it('flips x when mirrored', () => {
    expectNear(jointToView({ x: 0.2, y: 0.5 }, image, view, true, 'contain').x, 312);
    expectNear(jointToView({ x: 0.2, y: 0.5 }, image, view, false, 'contain').x, 78);
  });
});

describe('jointToView cover', () => {
  // scale = max(390/1080, 600/1920) = 0.3611; fitted 390 x 693.3
  const view = { width: 390, height: 600 };

  it('maps the centre to the view centre', () => {
    const p = jointToView({ x: 0.5, y: 0.5 }, image, view, false, 'cover');
    expectNear(p.x, 195);
    expectNear(p.y, 300);
  });

  it('crops the top-left corner above the view', () => {
    const p = jointToView({ x: 0, y: 0 }, image, view, false, 'cover');
    expectNear(p.x, 0);
    expectNear(p.y, -46.7);
  });
});
