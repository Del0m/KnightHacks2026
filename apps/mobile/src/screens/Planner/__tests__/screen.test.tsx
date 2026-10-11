/* eslint-disable @typescript-eslint/no-require-imports -- Existing renderer workflow. */
import React from 'react';
import Planner from '../index';
import { parsePlan } from '../plan';
import { useWeeklyPlan } from '../useWeeklyPlan';
const { act, create } = require('react-test-renderer');
jest.mock('../useWeeklyPlan', () => ({ useWeeklyPlan: jest.fn() }));
jest.mock('@/screens/Auth/session', () => ({ useAuth: () => ({ user: { id: 'a' } }) }));
jest.mock('@/screens/Onboarding/state', () => ({ useOnboarding: () => ({}) }));
jest.mock('@/state/Training', () => ({ useTraining: () => ({ profile: { days: [1, 3, 5] } }) }));
jest.mock('@/components/GlassSurface', () => ({ GlassSurface: 'Glass' }));
jest.mock('@/components/AppPage', () => ({ pageStyles: () => ({}), AppPage: 'Page', Action: 'Action' }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
const plan = parsePlan({ id: 'week', week_of: '2026-10-05', notes: [], days: [{ day: 0, date: '2026-10-05', items: [{ id: 'item', sets: 2, reps: 8, exercise: { id: 'squat', name: 'Squat', tracked: true }, reason: 'Build strength', swap_note: 'Knee adaptation', sources: [{ id: 'exercise:squat', title: 'Squat guide' }] }] }] })!;
test('keeps all seven day headings below the selector and expands real reasons/sources', () => {
 const generate = jest.fn(), selectDate = jest.fn();
 jest.mocked(useWeeklyPlan).mockReturnValue({ plan, selectedDate: '2026-10-05', today: '2026-10-05', week: '2026-10-05', busy: false, error: null, generate, refresh: jest.fn(), selectDate } as never);
 let tree: ReturnType<typeof create>; act(() => { tree = create(<Planner />); });
 try {
  let rendered = JSON.stringify(tree.toJSON());
  for (const weekday of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) expect(rendered).toContain(weekday);
  expect(rendered).toContain('Knee adaptation');
  const detail = tree.root.findAllByType('Button').find((n: { props: { accessibilityHint: string } }) => n.props.accessibilityHint === 'Show why this exercise and its sources');
  act(() => detail.props.onPress());
  rendered = JSON.stringify(tree.toJSON()); expect(rendered).toContain('Build strength'); expect(rendered).toContain('Squat guide');
  act(() => tree.root.findAllByType('Action').find((n: { props: { children: string } }) => n.props.children === 'Regenerate week').props.onPress()); expect(generate).toHaveBeenCalledTimes(1);
  act(() => tree.root.findAllByType('Button')[1].props.onPress()); expect(selectDate).toHaveBeenCalledWith('2026-10-06');
 } finally { act(() => tree.unmount()); }
});
