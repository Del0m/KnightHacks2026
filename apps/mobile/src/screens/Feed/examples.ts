import type { FeedPost } from './feedApi';
const entries = [
 { name: 'Maya', kind: 'goal', body: 'First week back. Three sessions, no skipping leg day.' },
 { name: 'Jordan', kind: 'session', tier: 'gold', exercise: 'Squat', id: 'squat', reps: 36, note: 'Kept the same depth from the first rep to the last.' },
 { name: 'Alex', kind: 'pr', body: 'Squat · 60 kg for 8 reps. Up from 55 kg last month.', data: { exercise_id: 'squat', metric: 'max_weight_kg', value: 60, previous_value: 55 } },
 { name: 'Sam', kind: 'session', tier: 'silver', exercise: 'Shoulder press', id: 'shoulder_press', reps: 30, note: 'A steadier lockout than last session.' },
 { name: 'Riley', kind: 'goal', body: 'What song gets you through the last set? Mine is still the same one from high school.' },
 { name: 'Noah', kind: 'session', tier: 'bronze', exercise: 'Bicep curl', id: 'bicep_curl', reps: 28, note: 'Finished all three sets. The last one felt smoother.' },
 { name: 'Zoe', kind: 'pr', body: '20 push-ups in one set. My old best was 16.', data: { exercise_id: 'push_up', metric: 'max_reps', value: 20, previous_value: 16 } },
 { name: 'Leo', kind: 'goal', body: 'Finally found a morning routine that sticks. Water, a walk, then training.' },
 { name: 'Avery', kind: 'session', tier: 'gold', exercise: 'Lunge', id: 'lunge', reps: 30, note: 'Better balance on both sides today.' },
 { name: 'Kai', kind: 'pr', body: 'Shoulder press · 15 kg. Small increase, big grin.', data: { exercise_id: 'shoulder_press', metric: 'max_weight_kg', value: 15, previous_value: 12.5 } },
];
/** Preview-only data. Never sent to Neon or attributed to real accounts. */
export const examplePosts: FeedPost[] = entries.map((e, i) => ({
 id: `example-${i + 1}`, kind: e.kind, body: e.body ?? `${e.tier} workout`,
 created_at: new Date(Date.UTC(2026, 9, 10, 18 - i)).toISOString(), author: { id: `example-author-${i}`, handle: null, display_name: e.name },
 data: e.tier ? { tier: e.tier, workout: { date: '2026-10-10', exercises: [{ id: e.id, name: e.exercise, sets: 3, reps: e.reps }], highlights: [e.note] } } : e.data ?? { post_type: 'custom' },
 kudos_count: [12, 34, 21, 16, 8, 19, 42, 11, 28, 23][i], comment_count: [2, 3, 2, 1, 5, 2, 4, 1, 2, 3][i], viewer_gave_kudos: false,
}));
