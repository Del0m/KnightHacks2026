/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { SetupPage } from '../SetupPage';
const { act, create } = require('react-test-renderer');
jest.mock('../GlassChoice', () => ({ GlassChoice: (props: unknown) => require('react').createElement('Choice', props) }));
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-router/head', () => ({ __esModule: true, default: () => { throw new Error('Native page titles must not request Apple Handoff'); } }));

test('step changes announce the new prompt for VoiceOver', () => {
  const announcement = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const props = { total: 4, eyebrow: 'Setup', intro: 'Choose a level.', action: 'Continue', onAction: jest.fn(), onBack: jest.fn(), children: null };
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(<SetupPage {...props} step={0} title="Your goals" />); });
  announcement.mockClear();
  act(() => renderer.update(<SetupPage {...props} step={1} title="Your experience" />));
  expect(announcement).toHaveBeenCalledWith('Step 2 of 4. Your experience. Choose a level.');
  act(() => renderer.unmount()); announcement.mockRestore();
});
