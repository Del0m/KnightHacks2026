/* eslint-disable @typescript-eslint/no-require-imports -- Matches existing renderer tests. */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassSurface } from '../GlassSurface';
const { act, create } = require('react-test-renderer');
jest.mock('expo-glass-effect', () => ({
  GlassView: (props: object) => require('react').createElement('GlassView', props),
  isGlassEffectAPIAvailable: jest.fn(() => true), isLiquidGlassAvailable: jest.fn(() => true),
}));
it('uses native glass when available and switches to an opaque surface for Reduce Transparency', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  let changed!: (value: boolean) => void;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, listener: (value: boolean) => void) => {
    if (event === 'reduceTransparencyChanged') changed = listener;
    return { remove };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  let screen: ReturnType<typeof create>;
  await act(async () => { screen = create(<GlassSurface tint="#087DBA" colored />); });
  expect(screen.root.findByType(GlassView).props.tintColor).toBe('#087DBA');
  act(() => changed(true));
  expect(screen.root.findAllByType(GlassView)).toHaveLength(0);
  expect(screen.root.findAllByType(LinearGradient)).toHaveLength(0);
  act(() => screen.unmount()); expect(remove).toHaveBeenCalled();
  jest.restoreAllMocks();
});
it('uses the colored gradient on an unsupported native build', async () => {
  jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(false);
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  let screen: ReturnType<typeof create>;
  await act(async () => { screen = create(<GlassSurface tint="#087DBA" colored />); });
  expect(screen.root.findAllByType(GlassView)).toHaveLength(0);
  expect(screen.root.findByType(LinearGradient).props.colors).toEqual(['#087DBAEE', '#087DBABA', '#087DBAE6']);
  act(() => screen.unmount()); jest.restoreAllMocks();
});
