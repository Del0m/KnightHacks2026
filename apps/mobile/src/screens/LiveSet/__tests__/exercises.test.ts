import { cameraExercises, cameraSpec } from '../exercises';
import { EXERCISE_SPECS } from '@/engine/specs';
test('camera picker and placement use AI-06 specs, including legacy Train ids', () => {
  expect(cameraExercises.map(e => e.id)).toEqual(EXERCISE_SPECS.map(e => e.id));
  expect(cameraSpec('curl')).toMatchObject({ id: 'bicep_curl', recommended_view: 'side' });
  expect(cameraSpec('press')).toMatchObject({ id: 'shoulder_press', recommended_view: 'front' });
  expect(cameraSpec('push_up').recommended_view).toBe('side');
  expect(cameraSpec('unknown').id).toBe('bicep_curl');
});
