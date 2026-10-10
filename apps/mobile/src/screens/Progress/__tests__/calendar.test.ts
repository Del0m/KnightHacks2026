import { monthCells } from '../calendar';
import { initialProfile, readSaved } from '@/data/workout';
it('aligns February leap days to the correct weekday', () => {
  const days = monthCells(2024, 1);
  expect(days.slice(0, 4)).toEqual([null, null, null, null]);
  expect(days[4]).toEqual({ number: 1, key: '2024-02-01' });
  expect(days.filter(Boolean)).toHaveLength(29);
  expect(days.find(day => day?.number === 29)?.key).toBe('2024-02-29');
  expect(days.length % 7).toBe(0);
});
it('reads old profiles without losing workout history', () => {
  const saved = readSaved({ profile: { name: 'Sam', days: [1, 3, 5], focus: 'Stay consistent', buddyTime: 'Evenings' }, workouts: [{ id: '1', day: '2024-02-29', finishedAt: '2024-02-29T12:00:00Z', sets: 3, reps: 12, minutes: 5 }] });
  expect(saved?.workouts).toHaveLength(1);
  expect(saved?.profile.bio).toBe(''); expect(saved?.profile.avatar).toBe('');
});
it('keeps a bio and real photo while rejecting executable image URLs', () => {
  expect(readSaved({ profile: { ...initialProfile, bio: 'Training daily', avatar: 'data:image/jpeg;base64,YQ==' }, workouts: [] })?.profile.avatar).toBe('data:image/jpeg;base64,YQ==');
  expect(readSaved({ profile: { ...initialProfile, avatar: 'javascript:alert(1)' }, workouts: [] })?.profile.avatar).toBe('');
});
