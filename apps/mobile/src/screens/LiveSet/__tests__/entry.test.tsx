/* eslint-disable @typescript-eslint/no-require-imports -- Renderer matches existing mobile tests. */
import React from 'react';
import { dailyWorkout, calendarDay } from '@/data/workout';
import { cameraSpec } from '../exercises';
import { Text } from 'react-native';
import CameraSetupScreen from '../index';
import WorkoutEntry from '@/app/workout';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/screens/Auth/session';
import { readActiveWorkout } from '@/services/workoutQueue';
import { useTraining } from '@/state/Training';
const { act, create } = require('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: jest.fn(), Redirect: (props: unknown) => require('react').createElement('Redirect', props) }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: (props: unknown) => require('react').createElement('Page', props), Action: 'Action' }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: jest.fn(() => ({ user: null })) }));
const mockDraftStorage = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: (key: string) => mockDraftStorage.get(key), set: (key: string, value: string) => mockDraftStorage.set(key, value) }) }));
jest.mock('@/state/Training', () => ({ useTraining: jest.fn() }));
jest.mock('../WorkoutCamera', () => ({ __esModule: true, default: 'WorkoutCamera' }));
jest.mock('@/screens/Summary', () => ({ WorkoutSummary: 'WorkoutSummary' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: 'Body' }));
jest.mock('@/components/SetupPage', () => ({ SetupPage: (props: unknown) => require('react').createElement('SetupPage', props) }));
jest.mock('@/components/GlassChoice', () => ({ GlassChoice: 'Choice' }));
jest.mock('../CameraCheck', () => ({ __esModule: true, default: 'CameraCheck' }));
jest.mock('../PlacementDiagram', () => ({ PlacementDiagram: 'Diagram' }));
const finish = jest.fn(() => 'saved');
beforeEach(() => { mockDraftStorage.clear(); jest.clearAllMocks(); jest.mocked(useAuth).mockReturnValue({ user: null } as never); jest.mocked(useLocalSearchParams).mockReturnValue({}); jest.mocked(useTraining).mockReturnValue({ workouts: [], finish } as never); });
test('a direct workout entry starts camera setup first', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  expect(screen.root.findByType('Redirect').props.href).toBe('/camera-setup');
  act(() => screen.unmount());
});
test('camera setup starts a prepared workout and rechecks preserve an existing session', () => {
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<CameraSetupScreen />); });
  act(() => screen.root.findByType('SetupPage').props.onSecondary());
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/workout', params: { setup: 'done', mode: 'manual', exercise: 'bicep_curl' } });
  act(() => screen.unmount());
  jest.mocked(useLocalSearchParams).mockReturnValue({ returnTo: 'workout' });
  act(() => { screen = create(<CameraSetupScreen />); });
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('SetupPage').props.onAction());
  act(() => screen.root.findByType('CameraCheck').props.onContinue());
  expect(router.back).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
});
test('leaving during rest preserves the unfinished workout without finalizing it', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('WorkoutCamera').props.onComplete({ exercise_id: 'bicep_curl', reps: [{ quality: null, flags: [], tempo_ms: 2000, range_deg: 100 }] }, null));
  act(() => screen.root.findByType('Page').props.headerAction.props.onPress());
  expect(finish).not.toHaveBeenCalled();
  expect(readActiveWorkout(null)?.sets).toHaveLength(1);
  expect(router.replace).toHaveBeenCalledWith('/');
  act(() => screen.unmount());
});
test('leaving before the first set does not create an empty workout', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('Page').props.headerAction.props.onPress());
  expect(finish).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
  act(() => screen.unmount());
});
test.each(['curl', 'press'])('manual entry uses the daily routine rather than reordering it for %s', exercise => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'manual', exercise });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  expect(screen.root.findByType('Body').props.selected).toBe(dailyWorkout()[0].id);
  act(() => screen.unmount());
});

const countedSet = { exercise_id: cameraSpec(dailyWorkout()[0].id).id, reps: [{ quality: null, flags: [], tempo_ms: 2000, range_deg: 100 }] };
test.each(['countdown', 'early'])('starts the next camera set after %s rest without a framing tap', end => {
  jest.useFakeTimers();
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('WorkoutCamera').props.onComplete(countedSet, null));
  expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
  if (end === 'countdown') {
    act(() => jest.advanceTimersByTime(44750));
    expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
    act(() => jest.advanceTimersByTime(250));
  } else {
    act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Start next set now').props.onPress());
  }
  expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(1);
  expect(screen.root.findAllByType(Text).some((n: any) => Array.isArray(n.props.children) && n.props.children.join('') === `Set 2 of ${dailyWorkout()[0].sets} · aim for ${dailyWorkout()[0].reps} reps`)).toBe(true);
  expect(finish).not.toHaveBeenCalled();
  act(() => screen.unmount());
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('rest expiry after the final set does not start another camera set', () => {
  jest.useFakeTimers();
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  for (let i = 0; i < dailyWorkout().reduce((sum, item) => sum + item.sets, 0); i++) {
    act(() => screen.root.findByType('WorkoutCamera').props.onComplete(countedSet, null));
    if (i < dailyWorkout().reduce((sum, item) => sum + item.sets, 0) - 1) act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Start next set now').props.onPress());
  }
  act(() => jest.advanceTimersByTime(45000));
  expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
  const finishButton = screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Finish Workout');
  expect(finishButton).toBeDefined();
  act(() => finishButton.props.onPress());
  expect(finish).toHaveBeenCalledTimes(1);
  expect(screen.root.findAllByType('WorkoutSummary')).toHaveLength(1);
  act(() => screen.unmount()); expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('persists before the completion pulse and restores the same next set after remount', () => {
 jest.useFakeTimers();
 jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
 let screen: ReturnType<typeof create>; act(() => { screen = create(<WorkoutEntry />); });
 act(() => screen.root.findByType('WorkoutCamera').props.onRecorded(countedSet, null, 'vision'));
 const saved = readActiveWorkout(null)!; expect(saved.sets).toHaveLength(1);
 expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(1);
 // Termination during the pulse: no completion callback or Finish is needed.
 act(() => screen.unmount()); jest.mocked(useLocalSearchParams).mockReturnValue({});
 act(() => { screen = create(<WorkoutEntry />); });
 expect(screen.root.findAllByType('Redirect')).toHaveLength(0);
 expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
 act(() => jest.advanceTimersByTime(45000));
 expect(screen.root.findByType('WorkoutCamera').props.setIndex).toBe(1);
 expect(readActiveWorkout(null)?.id).toBe(saved.id); expect(finish).not.toHaveBeenCalled();
 act(() => screen.unmount()); jest.useRealTimers();
});


test('auth refresh after resuming preserves newer completed sets and a cleared draft', () => {
  jest.useFakeTimers();
  const account = { id: 'resume-refresh' };
  const request = jest.fn(async () => { throw new Error('offline'); });
  jest.mocked(useAuth).mockReturnValue({ user: account, apiFetch: request } as never);
  jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera', exercise: 'curl' });
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findByType('WorkoutCamera').props.onComplete(countedSet, null));
  act(() => screen.unmount());
  act(() => { screen = create(<WorkoutEntry />); });
  act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Start next set now').props.onPress());
  act(() => screen.root.findByType('WorkoutCamera').props.onComplete(countedSet, null));
  expect(readActiveWorkout(account.id)?.sets).toHaveLength(2);
  jest.mocked(useAuth).mockReturnValue({ user: account, apiFetch: jest.fn(request) } as never);
  act(() => screen.update(<WorkoutEntry />));
  expect(readActiveWorkout(account.id)?.sets).toHaveLength(2);
  for (let i = 2; i < dailyWorkout().reduce((sum, item) => sum + item.sets, 0); i++) {
    act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Start next set now').props.onPress());
    act(() => screen.root.findByType('WorkoutCamera').props.onComplete(countedSet, null));
  }
  act(() => screen.root.findAllByType('Action').find((n: any) => n.props.children === 'Finish Workout').props.onPress());
  expect(readActiveWorkout(account.id)).toBeNull();
  jest.mocked(useAuth).mockReturnValue({ user: account, apiFetch: jest.fn(request) } as never);
  act(() => screen.update(<WorkoutEntry />));
  expect(readActiveWorkout(account.id)).toBeNull();
  act(() => screen.unmount()); jest.useRealTimers();
});
test('a generated rest day never starts a sample workout', () => {
 const { calendarDay } = jest.requireActual('@/data/workout');
 const { weekStart, savePlan } = jest.requireActual('@/screens/Planner/plan');
 const today = calendarDay();
 savePlan('a', { id: 'empty-week', weekOf: weekStart(today), days: [], notes: [] }, today);
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'a' } } as never);
 jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'manual' });
 let screen: ReturnType<typeof create>;
 act(() => { screen = create(<WorkoutEntry />); });
 expect(screen.root.findByType('Page').props.title).toBe('Workout');
 expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
 expect(screen.root.findAllByType('Action').map((n: { props: { children: string } }) => n.props.children)).toEqual(['View your week']);
 act(() => screen.unmount());
});
test('library exercises keep their prescription and interrupted sessions survive regeneration', () => {
 const { calendarDay } = jest.requireActual('@/data/workout');
 const { weekStart, dateForDay, savePlan } = jest.requireActual('@/screens/Planner/plan');
 const today = calendarDay(), week = weekStart(today), day = (dateForDay(today).getDay() + 6) % 7;
 const item = { id: 'Dumbbell_Lunges', name: 'Dumbbell lunges', itemId: 'item', position: 0, sets: 1, reps: 8, tracked: false, reason: null, safetyNote: null, swapNote: null, sources: [] };
 const original = { id: 'week', weekOf: week, notes: [], days: [{ day, date: today, items: [item, { ...item, id: 'Dumbbell_Squat', name: 'Dumbbell squat', itemId: 'second', position: 1, reps: 12 }] }] };
 savePlan('a', original, today);
 jest.mocked(useAuth).mockReturnValue({ user: { id: 'a' } } as never);
 jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'camera' });
 let screen: ReturnType<typeof create>;
 act(() => { screen = create(<WorkoutEntry />); });
 expect(screen.root.findAllByType('WorkoutCamera')).toHaveLength(0);
 const started = readActiveWorkout('a')!;
 expect(started.sets).toEqual([]);
 expect(started.routine?.[0]).toMatchObject({ id: 'Dumbbell_Lunges', reps: 8 });
 savePlan('a', { ...original, days: [] }, today);
 act(() => screen.unmount());
 act(() => { screen = create(<WorkoutEntry />); });
 expect(readActiveWorkout('a')?.id).toBe(started.id);
 const press = (label: string) => act(() => screen.root.findAllByType('Action').find((n: { props: { children: string } }) => n.props.children === label).props.onPress());
 press('Log set');
 expect(readActiveWorkout('a')?.sets[0]).toMatchObject({ exercise_id: 'Dumbbell_Lunges', reps: expect.any(Array) });
 expect(readActiveWorkout('a')?.sets[0].reps).toHaveLength(8);
 expect(readActiveWorkout('a')?.routine).toEqual([expect.objectContaining({ id: 'Dumbbell_Lunges', sets: 1, reps: 8 }), expect.objectContaining({ id: 'Dumbbell_Squat', reps: 12 })]);
 act(() => screen.unmount());
 savePlan('a', { ...original, days: [] }, today);
 act(() => { screen = create(<WorkoutEntry />); });
 press('Start next set now'); press('Log set');
 expect(readActiveWorkout('a')?.sets).toHaveLength(2);
 expect(readActiveWorkout('a')?.sets[1].exercise_id).toBe('Dumbbell_Squat');
 expect(readActiveWorkout('a')?.sets[1].reps).toHaveLength(12);
 act(() => screen.unmount());
});

test('a daily workout is durable before its first set and stays unchanged after midnight', () => {
 jest.useFakeTimers().setSystemTime(new Date(2026, 9, 11, 12));
 jest.mocked(useLocalSearchParams).mockReturnValue({ setup: 'done', mode: 'manual' });
 let screen: ReturnType<typeof create>;
 act(() => { screen = create(<WorkoutEntry />); });
 const saved = readActiveWorkout(null)!;
 expect(saved.routine).toEqual(dailyWorkout(calendarDay()));
 expect(saved.planDate).toBe('2026-10-11');
 expect(saved.sets).toEqual([]);
 act(() => screen.unmount());
 jest.setSystemTime(new Date(2026, 9, 12, 12));
 jest.mocked(useLocalSearchParams).mockReturnValue({});
 act(() => { screen = create(<WorkoutEntry />); });
 expect(readActiveWorkout(null)?.routine).toEqual(saved.routine);
 expect(screen.root.findByType('Body').props.selected).toBe(saved.routine![0].id);
 expect(dailyWorkout()).not.toEqual(saved.routine);
 act(() => screen.unmount()); jest.useRealTimers();
});
