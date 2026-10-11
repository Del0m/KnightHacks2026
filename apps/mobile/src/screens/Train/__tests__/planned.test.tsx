/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer workflow. */
import React from 'react';
import Train from '../index';
import { useWeeklyPlan } from '@/screens/Planner/useWeeklyPlan';
import { calendarDay, type Workout } from '@/data/workout';
import { addPlanDays, parsePlan, weekStart } from '@/screens/Planner/plan';
jest.mock('@/screens/Onboarding/state', () => ({ useOnboarding: () => ({ profile: null }) }));
const { act, create } = require('react-test-renderer');
let mockHistory: Workout[] = [];
jest.mock('@/screens/Planner/useWeeklyPlan', () => ({ useWeeklyPlan: jest.fn() }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => ({ user: { id: 'a' } }) }));
jest.mock('@/state/Training', () => ({ useTraining: () => ({ workouts: mockHistory }) }));
jest.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: 'Page', Action: 'Action' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: 'Preview' }));
jest.mock('@/components/RotationSlider', () => ({ RotationSlider: 'Slider' }));
jest.mock('@/components/Streak', () => ({ Streak: 'Streak' }));
jest.mock('@/components/ExerciseTabs', () => ({ ExerciseTabs: 'Tabs' }));
jest.mock('@/components/ExerciseMenu', () => ({ ExerciseMenu: 'Menu' }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
jest.mock('expo-router', () => { const navigation = { addListener: () => () => {} }; return { router: {}, useNavigation: () => navigation, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }; });
test('Train renders prescribed exercises and does not carry today’s completion into another date', () => {
 const today = calendarDay(), week = weekStart(today), day = 6, selectedDate = addPlanDays(week, day);
 const plan = parsePlan({ id: 'plan', week_of: week, notes: [], days: [{ day, date: selectedDate, items: [{ id: 'item', sets: 1, reps: 8, exercise: { id: 'squat', name: 'Squat', tracked: true } }] }] })!;
 const otherDate = selectedDate === today ? addPlanDays(today, -1) : today;
 mockHistory = [{ id: 'completed', day: otherDate, finishedAt: `${otherDate}T12:00:00`, details: [{ exercise_id: 'squat', reps: 8 }], sets: 1, reps: 8, minutes: 1 }] as Workout[];
 jest.mocked(useWeeklyPlan).mockReturnValue({ plan, selectedDate, today } as never);
 let tree: ReturnType<typeof create>; act(() => { tree = create(<Train />); });
 try {
  expect(tree.root.findByType('Preview').props.selected).toBe('squat');
  expect(tree.root.findAllByProps({ testID: 'exercise-curl' })).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('8');
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Squat completed' })).toHaveLength(0);
  mockHistory = [{ ...mockHistory[0], day: selectedDate, finishedAt: `${selectedDate}T12:00:00` }];
  act(() => tree.update(<Train />));
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Squat completed' }).length).toBeGreaterThan(0);
 } finally { act(() => tree.unmount()); }
});
