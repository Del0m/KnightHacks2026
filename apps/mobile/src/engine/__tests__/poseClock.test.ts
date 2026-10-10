import { createPoseClock } from '../poseClock';

describe('createPoseClock', () => {
  it('falls back to wall time before any pose', () => {
    expect(createPoseClock(() => 5000).now()).toBe(5000);
  });

  it('advances from the last pose timestamp by the wall time since it arrived', () => {
    let wall = 10_000;
    const clock = createPoseClock(() => wall);
    clock.observe(9_700); // arrived 300 ms after capture
    wall += 250;
    expect(clock.now()).toBe(9_950);
  });
});
