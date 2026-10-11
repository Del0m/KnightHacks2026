/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React, { useLayoutEffect } from 'react';
import { useTorchPulse } from '../useTorchPulse';
const { act, create } = require('react-test-renderer');
let pulse: ReturnType<typeof useTorchPulse>;
function Probe({ enabled }: { enabled: boolean }) {
  const value = useTorchPulse(enabled);
  useLayoutEffect(() => { pulse = value; }, [value]);
  return null;
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('a pulse turns off before completing and ignores repeated signals', () => {
  let screen: ReturnType<typeof create>; const done = jest.fn();
  act(() => { screen = create(<Probe enabled />); });
  act(() => { pulse.signal(done); pulse.signal(done); });
  expect(pulse.torchMode).toBe('on'); expect(done).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(200));
  expect(pulse.torchMode).toBe('off'); expect(done).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
test('front/no-torch cameras complete immediately and unmount cancels a pending pulse', () => {
  let screen: ReturnType<typeof create>; const done = jest.fn();
  act(() => { screen = create(<Probe enabled={false} />); });
  act(() => pulse.signal(done));
  expect(pulse.torchMode).toBe('off'); expect(done).toHaveBeenCalledTimes(1);
  act(() => screen.update(<Probe enabled />));
  act(() => pulse.signal(done)); act(() => screen.unmount());
  act(() => jest.runOnlyPendingTimers()); expect(done).toHaveBeenCalledTimes(1);
});
test('losing camera activity extinguishes a pulse and finishes its pending handoff', () => {
  let screen: ReturnType<typeof create>; const done = jest.fn();
  act(() => { screen = create(<Probe enabled />); });
  act(() => pulse.signal(done));
  act(() => screen.update(<Probe enabled={false} />));
  expect(pulse.torchMode).toBe('off');
  act(() => jest.runOnlyPendingTimers()); expect(done).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
