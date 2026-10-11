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
const user = { id: 'first', email: 'first@example.com', name: 'First' };
const credentials = { name: 'Second', email: ' second@example.com ', password: ' secret ' };
let auth: ReturnType<typeof useAuth>, renderer: ReturnType<typeof create>;
function Harness() { const value = useAuth(); useEffect(() => { auth = value; }, [value]); return null; }
async function mount() { await act(async () => { renderer = create(<AuthProvider><Harness /></AuthProvider>); }); }
beforeEach(() => {
  jest.clearAllMocks();
  for (const method of [client.getSession, client.token, client.signOut, client.signIn.email, client.signIn.social, client.signUp.email, client.sendVerificationEmail]) jest.mocked(method).mockReset();
  jest.mocked(client.signIn.social).mockResolvedValue({ data: {}, error: null } as never);
  jest.mocked(client.getSession).mockResolvedValue({ data: { user, session: {} }, error: null } as never);
  jest.mocked(client.signIn.email).mockResolvedValue({ data: {}, error: null } as never);
  jest.mocked(client.signUp.email).mockResolvedValue({ data: {}, error: null } as never);
  jest.mocked(client.signOut).mockResolvedValue({ data: {}, error: null } as never);
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
it('restores a server-confirmed session before releasing the loading state', async () => {
  await mount(); expect(auth.user?.id).toBe('first'); expect(auth.loading).toBe(false);
  expect(client.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
});
it('keeps an unverified signup outside the authenticated app and preserves password bytes', async () => {
  jest.mocked(client.getSession).mockResolvedValue({ data: null, error: null } as never);
  await mount(); let result: boolean | undefined;
  await act(async () => { result = await auth.authenticate('signup', credentials); });
  expect(result).toBe(false); expect(auth.user).toBeNull();
  expect(client.signUp.email).toHaveBeenCalledWith({ name: 'Second', email: 'second@example.com', password: ' secret ' });
});
it('clears the app session after a successful logout', async () => {
  await mount(); await act(async () => { await auth.logout(); }); expect(auth.user).toBeNull();
});
it('does not reinstate an old session when its refresh finishes after logout', async () => {
  await mount(); let resolve!: (value: never) => void;
  jest.mocked(client.getSession).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
  let refresh!: Promise<void>;
  await act(async () => { refresh = auth.refresh(); });
  await act(async () => { await auth.logout(); resolve({ data: { user, session: {} }, error: null } as never); await refresh; });
  expect(auth.user).toBeNull();
});
it('reports restoration failure without granting access from a stale cache', async () => {
  jest.mocked(client.getSession).mockResolvedValue({ data: null, error: { message: 'offline' } } as never);
  await mount(); expect(auth.user).toBeNull(); expect(auth.error).toContain('restore'); expect(auth.loading).toBe(false);
});
it('leaves the protected app if the auth service rejects its session token', async () => {
  await mount();
  jest.mocked(client.token).mockResolvedValue({ data: null, error: { status: 401, message: 'expired' } } as never);
  await act(async () => { await expect(auth.apiFetch('/me')).rejects.toThrow(); });
  expect(auth.user).toBeNull();
});
it('does not let a focus refresh cancel a successful login', async () => {
  jest.mocked(client.getSession).mockResolvedValueOnce({ data: null, error: null } as never);
  await mount();
  let resolve!: (value: never) => void;
  jest.mocked(client.signIn.email).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
  let login!: Promise<boolean>;
  await act(async () => { login = auth.authenticate('login', credentials); await auth.refresh(); });
  let signedIn = false;
  await act(async () => { resolve({ data: {}, error: null } as never); signedIn = await login; });
  expect(signedIn).toBe(true); expect(auth.user?.id).toBe('first');
});
it('does not restore a revoked account from a focus refresh started during logout', async () => {
  await mount();
  let finishLogout!: (value: never) => void, finishRefresh!: (value: never) => void;
  jest.mocked(client.signOut).mockImplementationOnce(() => new Promise(r => { finishLogout = r; }) as never);
  jest.mocked(client.getSession).mockImplementationOnce(() => new Promise(r => { finishRefresh = r; }) as never);
  let logout!: Promise<void>, refresh!: Promise<void>;
  await act(async () => { logout = auth.logout(); refresh = auth.refresh(); });
  await act(async () => { finishLogout({ data: {}, error: null } as never); await logout; if (finishRefresh) finishRefresh({ data: { user, session: {} }, error: null } as never); await refresh; });
  expect(auth.user).toBeNull();
});
it('keeps token acquisition valid across a harmless focus refresh', async () => {
  await mount(); let resolve!: (value: never) => void;
  jest.mocked(client.token).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
  const original = globalThis.fetch, send = jest.fn(async () => ({ status: 200, ok: true } as Response)); globalThis.fetch = send;
  try {
    let request!: Promise<Response>;
    await act(async () => { request = auth.apiFetch('/me'); await auth.refresh(); });
    await act(async () => { resolve({ data: { token: 'jwt' }, error: null } as never); await request; });
    expect(send).toHaveBeenCalledTimes(1);
  } finally { globalThis.fetch = original; }
});

describe('Google sign-in', () => {
  const second = { id: 'google-user', email: 'g@example.com', name: 'Google User' };
  it('returns through the app scheme and confirms the session with the server (native)', async () => {
    jest.mocked(client.getSession).mockResolvedValueOnce({ data: null, error: null } as never);
    await mount();
    expect(auth.googleEnabled).toBe(true);
    jest.mocked(client.getSession).mockResolvedValue({ data: { user: second, session: {} }, error: null } as never);
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
    const hadWindowLocation = 'location' in globalThis;
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://steadyforum.fit' } });
    const listeners = { add: window.addEventListener, remove: window.removeEventListener };
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
      if (renderer) act(() => renderer.unmount());
      Object.defineProperty(Platform, 'OS', os);
      window.addEventListener = listeners.add; window.removeEventListener = listeners.remove;
      if (!hadWindowLocation) delete (globalThis as { location?: unknown }).location;
    }
  });
});
