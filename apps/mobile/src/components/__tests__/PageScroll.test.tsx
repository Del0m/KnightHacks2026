/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React, { useContext } from 'react';
import { Text } from 'react-native';
import { SliderScrollBoundary } from '../SliderScrollBoundary';
import { AppPage } from '../AppPage';
import { PageScroll } from '../PageScroll';
const { act, create } = require('react-test-renderer');
const mockScrollTo = jest.fn();
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const React = require('react');
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(native), ScrollView: { value: React.forwardRef(function MockScrollView(props: object, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return React.createElement('PageScrollHost', props);
  }), configurable: true } });
});
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let scrollPage: ((delta: number) => void) | null;
function Probe() { const value = useContext(PageScroll); React.useEffect(() => { scrollPage = value; }, [value]); return null; }
test('embedded model drags scroll from the current offset and clamp at page boundaries', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<AppPage><Probe /></AppPage>); });
  const props = screen.root.findByType('PageScrollHost').props;
  act(() => {
    props.onContentSizeChange(400, 1000);
    props.onLayout({ nativeEvent: { layout: { height: 400 } } });
    props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
    scrollPage?.(40);
  });
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 140, animated: false });
  act(() => scrollPage?.(900));
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 600, animated: false });
  act(() => scrollPage?.(-900));
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
  act(() => screen.unmount());
});

test('holding sliders locks page scrolling until all touches release, cancel, or unmount', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<AppPage><SliderScrollBoundary><Text>Slider</Text></SliderScrollBoundary></AppPage>); });
  const control = () => screen.root.findByProps({ testID: 'slider-scroll-boundary' });
  const enabled = () => screen.root.findByType('PageScrollHost').props.scrollEnabled;
  expect(enabled()).toBe(true);
  act(() => control().props.onTouchStart()); expect(enabled()).toBe(false);
  act(() => control().props.onTouchEnd({ nativeEvent: { touches: [{}] } })); expect(enabled()).toBe(false);
  act(() => control().props.onTouchEnd({ nativeEvent: { touches: [] } })); expect(enabled()).toBe(true);
  act(() => control().props.onTouchStart());
  act(() => control().props.onTouchCancel()); expect(enabled()).toBe(true);
  act(() => control().props.onTouchStart());
  act(() => screen.root.findByType('PageScrollHost').props.onTouchEnd({ nativeEvent: { touches: [] } })); expect(enabled()).toBe(true);
  act(() => control().props.onTouchStart());
  act(() => screen.update(<AppPage><Probe /></AppPage>)); expect(enabled()).toBe(true);
  act(() => screen.unmount());
});
