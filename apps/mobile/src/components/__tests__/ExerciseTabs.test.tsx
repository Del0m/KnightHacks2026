/* eslint-disable @typescript-eslint/no-require-imports -- Native interaction test. */
import React from 'react';
import { Dimensions, PanResponder } from 'react-native';
import { ExerciseTabs } from '../ExerciseTabs';
const { act, create } = require('react-test-renderer');
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../GlassSurface', () => ({ GlassSurface: 'Glass' }));
jest.mock('../PolishedPressable', () => ({ PolishedPressable: 'Button' }));
jest.mock('../SwipeTabs', () => ({ TabSwipeBoundary: (props: { children: React.ReactNode }) => props.children }));
test('dragging the selector chooses the nearest section; canceled drags retain the selection', () => {
  const onChange = jest.fn(), responders = jest.spyOn(PanResponder, 'create');
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<ExerciseTabs value="workout" onChange={onChange} />); });
  act(() => screen.root.findByProps({ accessibilityRole: 'tablist' }).props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  const responder = responders.mock.calls.at(-1)![0];
  const gesture = { moveX: (Dimensions.get('window').width - 320) / 2 + 260, dx: 120, dy: 1, numberActiveTouches: 1 };
  expect(responder.onMoveShouldSetPanResponder?.({} as never, gesture as never)).toBe(true);
  act(() => {
    responder.onPanResponderGrant?.({} as never, gesture as never);
    responder.onPanResponderMove?.({} as never, gesture as never);
    responder.onPanResponderTerminate?.({} as never, gesture as never);
  });
  expect(onChange).not.toHaveBeenCalled();
  act(() => responder.onPanResponderRelease?.({} as never, gesture as never));
  expect(onChange).toHaveBeenCalledWith('practice');
  act(() => screen.unmount()); responders.mockRestore();
});
