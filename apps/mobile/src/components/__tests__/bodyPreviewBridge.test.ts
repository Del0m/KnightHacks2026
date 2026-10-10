import { modelCommand, modelEvent, modelNavigationAllowed, modelScroll } from '../bodyPreviewBridge';

test('rejects malformed renderer messages and only accepts ready/error events', () => {
  expect(modelEvent('{')).toBe(null);
  expect(modelEvent('null')).toBe(null);
  expect(modelEvent('{"type":"spotter:select","id":"curl"}')).toBe(null);
  expect(modelEvent('{"type":"spotter:model-ready"}')).toBe('ready');
  expect(modelEvent('{"type":"spotter:model-error"}')).toBe('error');
});
test('native commands execute as data and refuse unsupported selections', () => {
  const receive = jest.fn();
  const script = modelCommand({ type: 'spotter:select', id: 'curl' });
  new Function('window', script)({ spotterNativeReceive: receive });
  expect(receive).toHaveBeenCalledWith({ type: 'spotter:select', id: 'curl' });
  expect(() => modelCommand({ type: 'spotter:select', id: '</script>' } as never)).toThrow();
});
test('the offline renderer cannot navigate to network pages or another local file', () => {
  expect(modelNavigationAllowed('about:blank')).toBe(true);
  expect(modelNavigationAllowed('https://example.com')).toBe(false);
  expect(modelNavigationAllowed('file:///private/data')).toBe(false);
  expect(modelNavigationAllowed('javascript:alert(1)')).toBe(false);
});
test('scroll messages must contain a bounded numeric delta', () => {
  expect(modelScroll('{"type":"spotter:model-scroll","delta":-40}')).toBe(-40);
  for (const message of ['null', '{', '{"type":"spotter:model-scroll","delta":"40"}', '{"type":"spotter:model-scroll","delta":9000}', '{"type":"spotter:model-ready","delta":40}']) expect(modelScroll(message)).toBe(null);
});

test('all five previews and bounded slider rotations use the native bridge', () => {
  for (const id of ['curl', 'squat', 'press', 'push_up', 'lunge'] as const) expect(modelCommand({ type: 'spotter:select', id })).toContain(id);
  expect(modelCommand({ type: 'spotter:rotate', degrees: -180 })).toContain('-180');
  for (const degrees of [NaN, Infinity, 181, -181]) expect(() => modelCommand({ type: 'spotter:rotate', degrees })).toThrow();
});
