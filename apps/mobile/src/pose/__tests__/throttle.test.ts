import { shouldProcess } from '../throttle';

describe('shouldProcess', () => {
  it('processes the first frame', () => {
    expect(shouldProcess(0, null, 15)).toBe(true);
  });

  it('drops a frame that arrives before the 1000/15 ms interval', () => {
    expect(shouldProcess(60, 0, 15)).toBe(false);
  });

  it('processes a frame once the interval (about 66.7 ms) has passed', () => {
    expect(shouldProcess(67, 0, 15)).toBe(true);
  });

  it('treats maxFps 0 as unlimited', () => {
    expect(shouldProcess(1000, 0, 0)).toBe(true);
  });
});
