/* eslint-disable @typescript-eslint/no-require-imports -- Match the existing hook-test renderer setup. */
import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from '../session';
import { authClient } from '../client';
const { act, create } = require('react-test-renderer');
jest.mock('../client', () => ({
  authConfigured: true, googleSignInEnabled: true, apiUrl: 'https://api.example.com',
  authClient: {
    getSession: jest.fn(), token: jest.fn(), signOut: jest.fn(),
    signIn: { email: jest.fn(), social: jest.fn() }, signUp: { email: jest.fn() }, sendVerificationEmail: jest.fn(),
  },
}));
const client = authClient!;
const first = { id: 'first', email: 'first@example.com', name: 'First' };
const google = { id: 'google-user', email: 'g@example.com', name: 'Google User' };
let auth: ReturnType<typeof useAuth>, renderer: ReturnType<typeof create> | null = null;
function Harness() { const value = useAuth(); useEffect(() => { auth = value; }, [value]); return null; }
async function mount() { await act(async () => { renderer = create(<AuthProvider><Harness /></AuthProvider>); }); }
function unmount() { if (renderer) { const r = renderer; renderer = null; act(() => r.unmount()); } }
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(client.getSession).mockResolvedValue({ data: { user: first, session: {} }, error: null } as never);
  jest.mocked(client.signIn.social).mockResolvedValue({ data: {}, error: null } as never);
});
afterEach(unmount);

it('returns through the app scheme and confirms the session with the server (native)', async () => {
  jest.mocked(client.getSession).mockResolvedValueOnce({ data: null, error: null } as never);
  await mount();
  expect(auth.googleEnabled).toBe(true);
  jest.mocked(client.getSession).mockResolvedValue({ data: { user: google, session: {} }, error: null } as never);
  let result: boolean | undefined;
  await act(async () => { result = await auth.signInWithGoogle(); });
  expect(client.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' });
  expect(result).toBe(true);
  expect(auth.user?.id).toBe('google-user');
});

it('stays signed out when the user closes Google without finishing', async () => {
  jest.mocked(client.getSession).mockResolvedValue({ data: null, error: null } as never);
  await mount();
  let result: boolean | undefined;
  await act(async () => { result = await auth.signInWithGoogle(); });
  expect(result).toBe(false); expect(auth.user).toBeNull();
});

it('reports a provider error and keeps the current session', async () => {
  await mount();
  jest.mocked(client.signIn.social).mockResolvedValue({ data: null, error: { message: 'Provider not found' } } as never);
  await act(async () => { await expect(auth.signInWithGoogle()).rejects.toThrow('Provider not found'); });
  expect(auth.user?.id).toBe('first');
});

it('on the web, sends the browser to Google and back to this site', async () => {
  const { Platform } = require('react-native');
  const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
  const hadLocation = 'location' in globalThis;
  const listeners = { add: window.addEventListener, remove: window.removeEventListener };
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://steadyforum.fit' } });
  window.addEventListener = jest.fn(); window.removeEventListener = jest.fn(); // the provider listens for focus on web
  try {
    await mount();
    const sessionCalls = jest.mocked(client.getSession).mock.calls.length;
    let result: boolean | undefined;
    await act(async () => { result = await auth.signInWithGoogle(); });
    expect(client.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: 'https://steadyforum.fit/', errorCallbackURL: 'https://steadyforum.fit/login' });
    expect(result).toBe(false); // the page is leaving for Google
    expect(jest.mocked(client.getSession).mock.calls.length).toBe(sessionCalls);
  } finally {
    unmount();
    Object.defineProperty(Platform, 'OS', os);
    window.addEventListener = listeners.add; window.removeEventListener = listeners.remove;
    if (!hadLocation) delete (globalThis as { location?: unknown }).location;
  }
});
