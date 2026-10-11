/* eslint-disable @typescript-eslint/no-require-imports -- Native renderer test. */
import React from 'react';
import { AppState, PanResponder, type AppStateStatus } from 'react-native';
import { BodyPreview } from '../BodyPreview';
import { PageScroll } from '../PageScroll';
const { act, create } = require('react-test-renderer');
const commands: object[] = [];
let appStateListener: (state: AppStateStatus) => void;
jest.mock('../bodyModel.generated.json', () => ({ html: '<html></html>' }));
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Retry' }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('react-native-webview', () => ({ WebView: require('react').forwardRef((props: object, ref: unknown) => {
  require('react').useImperativeHandle(ref, () => ({ injectJavaScript: (script: string) => new Function('window', script)({ steadyforumNativeReceive: (data: object) => commands.push(data) }) }));
  return require('react').createElement('NativePreview', props);
}) }));
let screen: ReturnType<typeof create>;
beforeEach(() => {
  commands.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { appStateListener = listener; return { remove: jest.fn() }; });
});
afterEach(() => { act(() => screen.unmount()); jest.restoreAllMocks(); });
test('ready synchronizes the exercise and playback; backgrounding pauses and resume restores playback', () => {
  act(() => { screen = create(<BodyPreview selected="curl" playing />); });
  act(() => screen.root.findByType('NativePreview').props.onMessage({ nativeEvent: { data: '{"type":"steadyforum:model-ready"}' } }));
  expect(commands).toContainEqual({ type: 'steadyforum:select', id: 'curl' });
  act(() => appStateListener('active'));
  expect(commands.at(-1)).toEqual({ type: 'steadyforum:pause', playing: true });
  act(() => appStateListener('background'));
  expect(commands.slice(-2)).toEqual([{ type: 'steadyforum:active', active: false }, { type: 'steadyforum:pause', playing: false }]);
  act(() => appStateListener('active'));
  expect(commands.at(-1)).toEqual({ type: 'steadyforum:pause', playing: true });
  commands.length = 0;
  act(() => screen.update(<BodyPreview selected="curl" playing={false} />));
  expect(commands).not.toContainEqual({ type: 'steadyforum:select', id: 'curl' });
  expect(commands.at(-1)).toEqual({ type: 'steadyforum:pause', playing: false });
});
test('renderer failure exposes retry and retry remounts the bundled offline preview', () => {
  act(() => { screen = create(<BodyPreview selected="squat" playing={false} />); });
  const original = screen.root.findByType('NativePreview');
  act(() => original.props.onError());
  expect(screen.root.findByType('Retry')).toBeTruthy();
  act(() => screen.root.findByType('Retry').props.onPress());
  expect(screen.root.findByType('NativePreview')).not.toBe(original);
  expect(screen.root.findAllByType('Retry')).toHaveLength(0);
});
test('single-finger drag messages scroll the parent page without changing the model', () => {
  const scroll = jest.fn();
  act(() => { screen = create(<PageScroll.Provider value={scroll}><BodyPreview selected="curl" playing /></PageScroll.Provider>); });
  commands.length = 0;
  act(() => screen.root.findByType('NativePreview').props.onMessage({ nativeEvent: { data: '{"type":"steadyforum:model-scroll","delta":40}' } }));
  expect(scroll).toHaveBeenCalledWith(40);
  expect(commands).toEqual([]);
});

test('rotation changes turn the figure without restarting its animation', () => {
  act(() => { screen = create(<BodyPreview selected="lunge" playing rotation={0} />); });
  act(() => screen.root.findByType('NativePreview').props.onMessage({ nativeEvent: { data: '{"type":"steadyforum:model-ready"}' } }));
  expect(commands).not.toContainEqual({ type: 'steadyforum:rotate', degrees: 0 });
  commands.length = 0;
  act(() => screen.update(<BodyPreview selected="lunge" playing rotation={45} />));
  expect(commands).toContainEqual({ type: 'steadyforum:rotate', degrees: 45 });
  expect(commands).not.toContainEqual({ type: 'steadyforum:select', id: 'lunge' });
  act(() => screen.update(<BodyPreview selected="lunge" playing rotation={0} />));
  expect(commands).toContainEqual({ type: 'steadyforum:rotate', degrees: 0 });
});

test('native scrolling owns one finger while two fingers zoom the model', () => {
  const createResponder = jest.spyOn(PanResponder, 'create');
  act(() => { screen = create(<BodyPreview selected="curl" playing />); });
  const pinch = createResponder.mock.calls[0][0];
  const touches = (distance: number) => ({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: distance, pageY: 0 }] } });
  expect(pinch.onStartShouldSetPanResponderCapture?.({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }] } } as never, {} as never)).toBe(false);
  expect(pinch.onStartShouldSetPanResponderCapture?.(touches(100) as never, {} as never)).toBe(true);
  act(() => {
    pinch.onPanResponderGrant?.(touches(100) as never, {} as never);
    pinch.onPanResponderMove?.(touches(200) as never, {} as never);
  });
  expect(commands).toContainEqual({ type: 'steadyforum:zoom', factor: .5 });
});
