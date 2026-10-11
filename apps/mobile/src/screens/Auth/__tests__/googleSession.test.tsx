/* eslint-disable @typescript-eslint/no-require-imports -- Match the existing hook-test renderer setup. */
import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from '../session';
import { authClient } from '../client';
import { openAuthSessionAsync } from 'expo-web-browser';
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
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
  jest.mocked(client.signIn.social).mockResolvedValue({ data: { url: 'https://auth.example.com/oauth/google', redirect: false }, error: null } as never);
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: 'success', url: 'steadyforum://google-auth?neon_auth_session_verifier=verified-return' } as never);
});
afterEach(unmount);

it('returns through the app scheme and confirms the session with the server (native)', async () => {
  jest.mocked(client.getSession).mockResolvedValueOnce({ data: null, error: null } as never);
  await mount();
  expect(auth.googleEnabled).toBe(true);
  jest.mocked(client.getSession).mockResolvedValue({ data: { user: google, session: {} }, error: null } as never);
  let result: boolean | undefined;
  await act(async () => { result = await auth.signInWithGoogle(); });
  expect(client.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: 'https://steadyforum.fit/google-app-callback.html', errorCallbackURL: 'https://steadyforum.fit/google-app-callback.html', disableRedirect: true });
  expect(openAuthSessionAsync).toHaveBeenCalledWith('https://auth.example.com/oauth/google', 'steadyforum://google-auth');
  expect(client.getSession).toHaveBeenLastCalledWith({ query: { disableCookieCache: true, neon_auth_session_verifier: 'verified-return' } });
  expect(result).toBe(true);
  expect(auth.user?.id).toBe('google-user');
});

it('stays signed out when the user closes Google without finishing', async () => {
  jest.mocked(client.getSession).mockResolvedValue({ data: null, error: null } as never);
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as never);
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
it.each([
 'steadyforum://google-auth?error=access_denied',
 'steadyforum://google-auth',
 'https://untrusted.example.com/?neon_auth_session_verifier=attacker',
])('rejects an incomplete or unexpected native callback without signing in: %s', async url => {
 jest.mocked(client.getSession).mockResolvedValue({ data: null, error: null } as never);
 await mount();
 jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: 'success', url } as never);
 await act(async () => { await expect(auth.signInWithGoogle()).rejects.toThrow('Google'); });
 expect(auth.user).toBeNull();
 expect(client.getSession).toHaveBeenCalledTimes(1);
});

it('rejects a verifier exchange that returns no native session', async () => {
 jest.mocked(client.getSession).mockResolvedValue({ data: null, error: null } as never);
 await mount();
 await act(async () => { await expect(auth.signInWithGoogle()).rejects.toThrow('establish a session'); });
 expect(auth.user).toBeNull();
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
    expect(client.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: 'https://steadyforum.fit/login?oauth=google', errorCallbackURL: 'https://steadyforum.fit/login' });
    expect(result).toBe(false); // the page is leaving for Google
    expect(jest.mocked(client.getSession).mock.calls.length).toBe(sessionCalls);
  } finally {
    unmount();
    Object.defineProperty(Platform, 'OS', os);
    window.addEventListener = listeners.add; window.removeEventListener = listeners.remove;
    if (!hadLocation) delete (globalThis as { location?: unknown }).location;
  }
});

it('exchanges the web callback verifier before restoring the account and cleans the URL only on success', async () => {
 const { Platform } = require('react-native');
 const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
 const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
 const historyDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'history');
 const listeners = { add: window.addEventListener, remove: window.removeEventListener };
 const replaceState = jest.fn();
 Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
 Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://steadyforum.fit', href: 'https://steadyforum.fit/login?oauth=google&neon_auth_session_verifier=returned-verifier', search: '?oauth=google&neon_auth_session_verifier=returned-verifier' } });
 Object.defineProperty(globalThis, 'history', { configurable: true, value: { state: null, replaceState } });
 window.addEventListener = jest.fn(); window.removeEventListener = jest.fn();
 try {
  jest.mocked(client.getSession).mockResolvedValueOnce({ data: null, error: null } as never);
  await mount();
  expect(client.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true, neon_auth_session_verifier: 'returned-verifier' } });
  expect(auth.user).toBeNull(); expect(auth.error).toContain('Google'); expect(replaceState).not.toHaveBeenCalled();
  jest.mocked(client.getSession).mockResolvedValueOnce({ data: { user: google, session: {} }, error: null } as never);
  await act(async () => { await auth.refresh(); });
  expect(auth.user?.id).toBe('google-user');
  expect(replaceState).toHaveBeenCalledWith(null, '', 'https://steadyforum.fit/login');
 } finally {
  unmount(); Object.defineProperty(Platform, 'OS', os);
  window.addEventListener = listeners.add; window.removeEventListener = listeners.remove;
  if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor); else delete (globalThis as { location?: unknown }).location;
  if (historyDescriptor) Object.defineProperty(globalThis, 'history', historyDescriptor); else delete (globalThis as { history?: unknown }).history;
 }
});
