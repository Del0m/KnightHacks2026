import { MIN_ON_DEVICE_FPS, selectPoseMode, type ModeInputs } from '../mode';

const fastIphone: ModeInputs = {
  platform: 'ios',
  coremlFps: 60,
  preference: 'auto',
  cloudConsent: false,
  cloudReachable: true,
};
const slowIphone: ModeInputs = { ...fastIphone, coremlFps: 8 };
const android: ModeInputs = { ...fastIphone, platform: 'android', coremlFps: null };

describe('selectPoseMode: automatic', () => {
  it('uses YOLOv8 on an iPhone that holds 12 fps', () => {
    expect(selectPoseMode(fastIphone)).toBe('coreml');
  });

  it('treats exactly 12 fps as fast enough', () => {
    expect(MIN_ON_DEVICE_FPS).toBe(12);
    expect(selectPoseMode({ ...fastIphone, coremlFps: 12 })).toBe('coreml');
  });

  it('sends a slow iPhone to cloud once the user consents', () => {
    expect(selectPoseMode({ ...slowIphone, cloudConsent: true })).toBe('cloud');
  });

  it('sends an iPhone whose model failed to load (no fps) to cloud', () => {
    expect(selectPoseMode({ ...fastIphone, coremlFps: null, cloudConsent: true })).toBe('cloud');
  });

  it('never picks Apple Vision on its own', () => {
    for (const coremlFps of [null, 0, 8, 11.9]) {
      expect(selectPoseMode({ ...fastIphone, coremlFps, cloudConsent: true })).toBe('cloud');
      expect(selectPoseMode({ ...fastIphone, coremlFps })).toBe('unavailable');
    }
  });

  it('gates Live Set on a slow iPhone without consent', () => {
    expect(selectPoseMode(slowIphone)).toBe('unavailable');
  });

  it('pauses on a slow iPhone when cloud is unreachable', () => {
    expect(selectPoseMode({ ...slowIphone, cloudConsent: true, cloudReachable: false })).toBe('paused');
  });
});

describe('selectPoseMode: Android is cloud-only', () => {
  it('uses cloud with consent', () => {
    expect(selectPoseMode({ ...android, cloudConsent: true })).toBe('cloud');
  });

  it('ignores an on-device fps on Android', () => {
    expect(selectPoseMode({ ...android, coremlFps: 60, cloudConsent: true })).toBe('cloud');
  });

  it('is unavailable without consent', () => {
    expect(selectPoseMode(android)).toBe('unavailable');
  });

  it('pauses when cloud is unreachable', () => {
    expect(selectPoseMode({ ...android, cloudConsent: true, cloudReachable: false })).toBe('paused');
  });

  it('ignores a Vision preference, since Vision is iPhone-only', () => {
    expect(selectPoseMode({ ...android, preference: 'vision', cloudConsent: true })).toBe('cloud');
    expect(selectPoseMode({ ...android, preference: 'vision' })).toBe('unavailable');
  });
});

describe('selectPoseMode: the user switches on-device to cloud', () => {
  const wantsCloud: ModeInputs = { ...fastIphone, preference: 'cloud', cloudConsent: true };

  it('switches a fast iPhone from YOLOv8 to cloud', () => {
    expect(selectPoseMode({ ...wantsCloud, preference: 'auto' })).toBe('coreml');
    expect(selectPoseMode(wantsCloud)).toBe('cloud');
  });

  it('stays on-device until the user consents', () => {
    expect(selectPoseMode({ ...wantsCloud, cloudConsent: false })).toBe('coreml');
  });

  it('pauses instead of falling back to on-device when cloud drops (Core ML takes a tap)', () => {
    expect(selectPoseMode({ ...wantsCloud, cloudReachable: false })).toBe('paused');
  });

  it('never picks Core ML on its own for a consented, cloud-preferring phone', () => {
    for (const coremlFps of [12, 30, 60, 120]) {
      expect(selectPoseMode({ ...wantsCloud, coremlFps, cloudReachable: false })).toBe('paused');
      expect(selectPoseMode({ ...wantsCloud, coremlFps, cloudReachable: true })).toBe('cloud');
    }
  });

  it('switches back to YOLOv8 when the user returns to automatic', () => {
    expect(selectPoseMode({ ...wantsCloud, preference: 'auto' })).toBe('coreml');
  });
});

describe('selectPoseMode: the user picks Apple Vision on iPhone', () => {
  it('uses Vision on a fast iPhone', () => {
    expect(selectPoseMode({ ...fastIphone, preference: 'vision' })).toBe('vision');
  });

  it('uses Vision on a slow iPhone without cloud consent or signal', () => {
    expect(selectPoseMode({ ...slowIphone, preference: 'vision', cloudReachable: false })).toBe('vision');
  });

  it('uses Vision even when the user has consented to cloud', () => {
    expect(selectPoseMode({ ...slowIphone, preference: 'vision', cloudConsent: true })).toBe('vision');
  });
});
