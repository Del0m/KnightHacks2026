import { saveOnboarding } from '../api';
import { createDraft } from '../model';

const draft = { ...createDraft(), goals: ['muscle', 'strength', 'core'], experience: 'beginner' as const, injury: 'My left knee bothers me.' };
test('a retry reconciles an injury already written before a failed completion save', async () => {
  const calls: string[] = [];
  let injuries: { description: string }[] = [];
  let failCompletion = true;
  const request = async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === '/me/injuries' && !init?.method) return new Response(JSON.stringify(injuries));
    if (path === '/me/injuries') { injuries.push(body); return new Response(JSON.stringify(body), { status: 201 }); }
    if (body.onboarding_completed && failCompletion) return new Response('', { status: 500 });
    return new Response(JSON.stringify(body));
  };
  await expect(saveOnboarding(request, draft)).rejects.toThrow();
  failCompletion = false;
  await expect(saveOnboarding(request, draft)).resolves.toBeDefined();
  expect(calls.filter(c => c === 'POST /me/injuries')).toHaveLength(1);
});

test('unsupported or failed backend responses never count as successful onboarding', async () => {
  await expect(saveOnboarding(async () => new Response('{}'), { ...draft, injury: '' })).rejects.toThrow();
  await expect(saveOnboarding(async () => new Response('', { status: 404 }), draft)).rejects.toThrow();
});

test('a backend can reorder JSON object keys without changing the confirmed profile', async () => {
  const request = async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    body.schedule = { days: body.schedule.days, kind: body.schedule.kind };
    return new Response(JSON.stringify(body));
  };
  await expect(saveOnboarding(request, { ...draft, injury: '' })).resolves.toBeDefined();
});

test('an injury write must acknowledge the note before setup is completed', async () => {
  let completed = false;
  const request = async (path: string, init?: RequestInit) => {
    if (path === '/me/injuries') return new Response(init?.method ? '{}' : '[]');
    const body = JSON.parse(String(init?.body)); completed ||= body.onboarding_completed;
    return new Response(JSON.stringify(body));
  };
  await expect(saveOnboarding(request, draft)).rejects.toThrow();
  expect(completed).toBe(false);
});
