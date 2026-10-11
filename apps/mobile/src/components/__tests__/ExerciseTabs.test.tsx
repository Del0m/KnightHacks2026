/* eslint-disable @typescript-eslint/no-require-imports -- Native interaction test. */
import React from 'react';
import { Dimensions, PanResponder, StyleSheet } from 'react-native';
import { ExerciseTabs } from '../ExerciseTabs';
import { PageScrollLock } from '../PageScroll';
const { act, create } = require('react-test-renderer');
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../GlassSurface', () => ({ GlassSurface: 'Glass' }));
jest.mock('../PolishedPressable', () => ({ PolishedPressable: 'Button' }));
jest.mock('../SwipeTabs', () => ({ TabSwipeBoundary: (props: { children: React.ReactNode }) => props.children }));
test('grabbing the selector captures vertical gestures and holds its lock until release', () => {
  const lock = jest.fn(), onChange = jest.fn(), responders = jest.spyOn(PanResponder, 'create');
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<PageScrollLock.Provider value={lock}><ExerciseTabs value="workout" onChange={onChange} /></PageScrollLock.Provider>); });
  act(() => screen.root.findByProps({ accessibilityRole: 'tablist' }).props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  const responder = responders.mock.calls.at(-1)![0];
  expect(responder.onStartShouldSetPanResponderCapture?.({} as never, {} as never)).toBe(true);
  const gesture = { x0: (Dimensions.get('window').width - 320) / 2 + 260, moveX: 0, dx: 0, dy: 0, numberActiveTouches: 1 };
  act(() => responder.onPanResponderGrant?.({} as never, gesture as never));
  expect(lock).toHaveBeenLastCalledWith(expect.any(String), true);
  expect(responder.onPanResponderTerminationRequest?.({} as never, gesture as never)).toBe(false);
  act(() => responder.onPanResponderRelease?.({} as never, gesture as never));
  expect(lock).toHaveBeenLastCalledWith(expect.any(String), false);
  expect(onChange).toHaveBeenCalledWith('practice');
  act(() => responder.onPanResponderGrant?.({} as never, gesture as never));
  act(() => responder.onPanResponderTerminate?.({} as never, gesture as never));
  expect(lock).toHaveBeenLastCalledWith(expect.any(String), false);
  act(() => screen.unmount()); responders.mockRestore();
});
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

test('the visible tint changes during a drag before committing the section', () => {
  const onChange = jest.fn(), responders = jest.spyOn(PanResponder, 'create');
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<ExerciseTabs value="workout" onChange={onChange} />); });
  act(() => screen.root.findByProps({ accessibilityRole: 'tablist' }).props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  const tint = () => {
    const color = StyleSheet.flatten(screen.root.findAllByProps({ testID: 'exercise-selector-tint' })[0].props.style).backgroundColor;
    return typeof color === 'string' ? color : color.__getValue();
  };
  const blue = tint(), responder = responders.mock.calls.at(-1)![0];
  act(() => responder.onPanResponderGrant?.({} as never, {} as never));
  act(() => responder.onPanResponderMove?.({} as never, { dx: 60, moveX: (Dimensions.get('window').width - 320) / 2 + 160 } as never));
  const middle = tint();
  act(() => responder.onPanResponderMove?.({} as never, { dx: 138, moveX: (Dimensions.get('window').width - 320) / 2 + 238 } as never));
  expect(middle).not.toBe(blue);
  expect(tint()).not.toBe(middle);
  expect(onChange).not.toHaveBeenCalled();
  act(() => screen.unmount()); responders.mockRestore();
});
