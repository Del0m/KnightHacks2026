/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer workflow. */
import React from 'react';
import { useWeeklyPlan } from '../useWeeklyPlan';
import { readPlan, savePlan, parsePlan, weekStart } from '../plan';
import { calendarDay } from '@/data/workout';
const { act, create } = require('react-test-renderer');
const mockData = new Map<string, string>();
const mockRequest = jest.fn();
let mockAccount: string | null = 'a';
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => ({ user: mockAccount ? { id: mockAccount } : null, apiFetch: mockRequest }) }));
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: (k: string) => mockData.get(k), set: (k: string, v: string) => mockData.set(k, v), remove: (k: string) => mockData.delete(k) }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
const response = (id: string) => ({ ok: true, status: 200, json: async () => ({ id, week_of: weekStart(calendarDay()), notes: [], days: [] }) });
let value: ReturnType<typeof useWeeklyPlan>;
function Harness() { const current = useWeeklyPlan(); React.useLayoutEffect(() => { value = current; }); return null; }
beforeEach(() => { mockData.clear(); mockAccount = 'a'; mockRequest.mockReset(); });
test('keeps the cached week on network failure and clears it on an authoritative 404', async () => {
 const today = calendarDay(), week = weekStart(today);
 savePlan('a', parsePlan({ id: 'cached', week_of: week, notes: [], days: [] })!, today);
 mockRequest.mockRejectedValueOnce(new Error('offline'));
 let tree: ReturnType<typeof create>; await act(async () => { tree = create(<Harness />); });
 try {
  expect(value.plan?.id).toBe('cached'); expect(value.error).toBe('offline');
  mockRequest.mockResolvedValue({ status: 404 });
  await act(async () => { await value.refresh(); });
  expect(value.plan).toBeNull(); expect(readPlan('a', week)).toBeNull();
 } finally { act(() => tree.unmount()); }
});
test('aborts an old account response and serializes repeated generation taps', async () => {
 let resolve!: (v: unknown) => void;
 mockRequest.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(response('b-week'));
 let tree: ReturnType<typeof create>; await act(async () => { tree = create(<Harness />); });
 try {
  const oldSignal = mockRequest.mock.calls[0][1].signal;
  mockAccount = 'b'; await act(async () => tree.update(<Harness />));
  expect(oldSignal.aborted).toBe(true); expect(value.plan?.id).toBe('b-week');
  await act(async () => { resolve(response('old-a')); });
  expect(readPlan('a', weekStart(calendarDay()))).toBeNull(); expect(value.plan?.id).toBe('b-week');
  const before = mockRequest.mock.calls.length;
  await act(async () => { await Promise.all([value.generate(), value.generate()]); });
  expect(mockRequest.mock.calls.length).toBe(before + 1);
 } finally { act(() => tree.unmount()); }
});
