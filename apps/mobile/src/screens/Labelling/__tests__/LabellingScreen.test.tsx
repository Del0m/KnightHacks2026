import React from 'react';
import { AppState, Platform } from 'react-native';
import { LabellingScreen } from '../LabellingScreen';
import { usePoseOutput } from '../../../pose/usePoseOutput';
import { saveConsent, readConsents, drafts } from '../storage';
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('../storage', () => ({ newId: (prefix: string) => `${prefix}_test`, drafts: { list: jest.fn(), save: jest.fn(), deleteParticipant: jest.fn() }, readConsents: jest.fn(), saveConsent: jest.fn(), withdrawParticipant: jest.fn(), exportAndShare: jest.fn(), shareConsentEvidence: jest.fn() }));
jest.mock('../../../pose/usePoseOutput', () => ({ usePoseOutput: jest.fn() }));
jest.mock('../../../pose/PoseSkeleton', () => ({ PoseSkeleton: (p: unknown) => jest.requireActual('react').createElement('PoseSkeleton', p) }));
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => unknown) => jest.requireActual('react').useEffect(cb, []), router: { back: jest.fn() } }));
jest.mock('react-native-vision-camera', () => ({ Camera: (p: unknown) => jest.requireActual('react').createElement('Camera', p), useCameraDevice: () => ({ position: 'back' }), useCameraPermission: () => ({ hasPermission: true }) }));
let renderer: ReturnType<typeof create>;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest.mocked(drafts.list).mockResolvedValue([]);
  jest.mocked(readConsents).mockResolvedValue([]);
  jest.mocked(saveConsent).mockResolvedValue(undefined);
  jest.mocked(usePoseOutput).mockReturnValue({ frameOutput: { currentResolution: { width: 1920, height: 1080 } }, fps: 15, error: null, model: 'yolov8n-pose-320', dropped: 0 } as never);
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
async function mount() { await act(async () => { renderer = create(<LabellingScreen />); }); }
test('Start remains blocked until consent is durably saved and actual image dimensions are known', async () => {
  await mount();
  expect(renderer.root.findByProps({ testID: 'labelling-start' }).props.disabled).toBe(true);
  await act(async () => { await renderer.root.findByProps({ testID: 'labelling-consent' }).props.onPress(); });
  expect(saveConsent).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'private_model_development', publication_allowed: false }));
  expect(renderer.root.findByProps({ testID: 'labelling-start' }).props.disabled).toBe(true);
  await act(async () => { renderer.root.findByType('Camera').props.onConfigured(); });
  expect(renderer.root.findByProps({ testID: 'labelling-start' }).props.disabled).toBe(false);
});
test('failed consent persistence never enables capture', async () => {
  jest.mocked(saveConsent).mockRejectedValue(new Error('disk full'));
  await mount();
  await act(async () => { renderer.root.findByType('Camera').props.onConfigured(); await renderer.root.findByProps({ testID: 'labelling-consent' }).props.onPress(); });
  expect(renderer.root.findByProps({ testID: 'labelling-start' }).props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('disk full');
});

test('countdown starts capture after the durable header and Stop retains detections for review', async () => {
  jest.useFakeTimers();
  jest.mocked(drafts.save).mockResolvedValue(undefined);
  await mount();
  await act(async () => { renderer.root.findByType('Camera').props.onConfigured(); await renderer.root.findByProps({ testID: 'labelling-consent' }).props.onPress(); });
  act(() => renderer.root.findByProps({ testID: 'labelling-start' }).props.onPress());
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(drafts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'recording', frames: [] }));
  expect(JSON.stringify(renderer.toJSON())).toContain('Stop and review');
  const onPose = jest.mocked(usePoseOutput).mock.calls.at(-1)![0].onPose;
  act(() => onPose({ latencyMs: 8, result: { timestamp_ms: 1000, source: 'coreml', model: 'yolov8n-pose-320', score: .9, joints: Array.from({ length: 17 }, () => ({ x: .5, y: .5, c: .9 })) } }));
  const stop = renderer.root.findAll((node: any) => node.props.label === 'Stop and review')[0];
  await act(async () => { stop.props.onPress(); });
  expect(drafts.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'complete', frames: [expect.objectContaining({ timestamp_ms: 0 })] }));
  expect(JSON.stringify(renderer.toJSON())).toContain('Save human review');
  jest.useRealTimers();
});

test('backgrounding stops capture as incomplete and delayed camera callbacks cannot append', async () => {
  jest.useFakeTimers();
  jest.mocked(drafts.save).mockResolvedValue(undefined);
  let change: ((state: string) => void) | undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { change = listener as never; return { remove: jest.fn() }; });
  await mount();
  await act(async () => { renderer.root.findByType('Camera').props.onConfigured(); await renderer.root.findByProps({ testID: 'labelling-consent' }).props.onPress(); });
  act(() => renderer.root.findByProps({ testID: 'labelling-start' }).props.onPress());
  await act(async () => { jest.advanceTimersByTime(3000); });
  const late = jest.mocked(usePoseOutput).mock.calls.at(-1)![0].onPose;
  act(() => late({ latencyMs: 0 }));
  await act(async () => { Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true }); change!('background'); });
  const stopped = jest.mocked(drafts.save).mock.calls.at(-1)![0];
  expect(stopped.status).toBe('incomplete');
  expect(stopped.stop_reason).toBe('background');
  expect(stopped.frames).toHaveLength(1);
  act(() => late({ latencyMs: 0 }));
  expect(jest.mocked(drafts.save).mock.calls.at(-1)![0].frames).toHaveLength(1);
  subscription.mockRestore();
  jest.useRealTimers();
});
