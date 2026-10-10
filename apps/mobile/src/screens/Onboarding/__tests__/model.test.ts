import { createDraft, toggleGoal, validateStep, profilePayload, upcomingDays, parseProfile, dateFromDay } from '../model';

test('goals are capped at three and can be deselected', () => {
  expect(toggleGoal(['muscle', 'strength', 'core'], 'back')).toEqual(['muscle', 'strength', 'core']);
  expect(toggleGoal(['muscle', 'strength', 'core'], 'strength')).toEqual(['muscle', 'core']);
  expect(validateStep({ ...createDraft(), goals: ['muscle', 'strength', 'core'] }, 0)).toBeNull();
  expect(validateStep({ ...createDraft(), goals: ['muscle', 'muscle', 'core'] }, 0)).toBeTruthy();
});

test('PBs require weight and reps together, and beginners submit none', () => {
  const draft = { ...createDraft(), goals: ['muscle', 'strength', 'core'], experience: 'experienced' as const, unknownBests: false };
  draft.bests[0] = { exercise: 'squat', weight: '100', reps: '' };
  expect(validateStep(draft, 1)).toBeTruthy();
  draft.bests[0].reps = '5';
  expect(validateStep(draft, 1)).toBeNull();
  expect(profilePayload(draft, false).personal_bests).toEqual([{ exercise: 'squat', weight: 100, unit: 'lb', reps: 5 }]);
  expect(profilePayload({ ...draft, experience: 'beginner' }, false).personal_bests).toEqual([]);
});

test('interval schedules remain intervals and preview calendar days across DST', () => {
  const draft = { ...createDraft(), scheduleMode: 'interval' as const, interval: '3', startDate: '2026-10-30' };
  expect(profilePayload(draft, false).schedule).toEqual({ kind: 'interval', every_days: 3, start_date: '2026-10-30' });
  expect(upcomingDays(draft, new Date(2026, 9, 30))).toEqual(['2026-10-30', '2026-11-02', '2026-11-05']);
  expect(validateStep({ ...draft, startDate: '2026-02-30' }, 2)).toBeTruthy();
  expect(validateStep({ ...draft, interval: '0' }, 2)).toBeTruthy();
  expect(validateStep({ ...draft, scheduleMode: 'weekly', days: [] }, 2)).toBeTruthy();
});

test('profile parsing rejects malformed saved data rather than claiming completion', () => {
  const draft = { ...createDraft(), goals: ['muscle', 'strength', 'core'], experience: 'beginner' as const };
  expect(parseProfile({ ...profilePayload(draft, true), goals: ['unknown'] })).toBeNull();
  expect(parseProfile(profilePayload(draft, true))?.goals).toEqual(draft.goals);
});

test('the last supported input year can preview dates in the next year safely', () => {
  const draft = { ...createDraft(), scheduleMode: 'interval' as const, interval: '3', startDate: '2100-12-31' };
  expect(validateStep(draft, 2)).toBeNull();
  const days = upcomingDays(draft, new Date(2026, 9, 10));
  expect(days).toEqual(['2100-12-31', '2101-01-03', '2101-01-06']);
  expect(days.every(day => dateFromDay(day) !== null)).toBe(true);
  expect(validateStep({ ...draft, startDate: '2101-01-01' }, 2)).toBeTruthy();
});
