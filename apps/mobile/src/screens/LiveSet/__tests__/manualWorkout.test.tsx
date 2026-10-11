import React from 'react';
import WorkoutEntry from '@/app/workout';
import { exercises } from '@/data/workout';
import { uploadWorkout } from '@/services/workoutApi';

const { act, create } = jest.requireActual('react-test-renderer');
const mockFinish = jest.fn(() => 'local-workout');
const mockRemove = jest.fn();

jest.mock('@/state/Training', () => ({ useTraining: () => ({ finish: mockFinish, removeWorkout: mockRemove }) }));
jest.mock('@/services/workoutApi', () => ({ uploadWorkout: jest.fn() }));
jest.mock('@/components/AppPage', () => ({ ui: {}, AppPage: 'Page', Action: 'Action' }));
jest.mock('@/components/BodyPreview', () => ({ BodyPreview: 'Preview' }));
jest.mock('@/components/PolishedPressable', () => ({ PolishedPressable: 'Button' }));
jest.mock('expo-router', () => ({ router: {}, useLocalSearchParams: () => ({ setup: 'done' }) }));

test('manual sets save locally once and can be undone without uploading pose data', () => {
  jest.useFakeTimers();
  let screen: ReturnType<typeof create>;
  act(() => { screen = create(<WorkoutEntry />); });
  const press = (label: string) => act(() => screen.root.findAllByType('Action')
    .find((node: { props: { children: string } }) => node.props.children === label).props.onPress());
  try {
    const totalSets = exercises.reduce((total, exercise) => total + exercise.sets, 0);
    for (let index = 0; index < totalSets; index++) {
      press('Mark set complete');
      if (index < totalSets - 1) press('Skip rest');
    }
    press('Finish Workout');
    expect(mockFinish).toHaveBeenCalledTimes(1);
    expect(mockFinish).toHaveBeenCalledWith(totalSets,
      exercises.reduce((total, exercise) => total + exercise.sets * exercise.reps, 0), 1);
    expect(uploadWorkout).not.toHaveBeenCalled();
    expect(screen.root.findByType('Page').props.intro).toBe('Workout saved on this device');
    act(() => screen.root.findByType('Button').props.onPress());
    expect(mockRemove).toHaveBeenCalledWith('local-workout');
    expect(screen.root.findByType('Page').props.intro).toBe('Session complete');
  } finally {
    act(() => screen.unmount());
    jest.useRealTimers();
  }
});
