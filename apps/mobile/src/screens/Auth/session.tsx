import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { openAuthSessionAsync } from 'expo-web-browser';
import { authClient, apiUrl, authConfigured, googleSignInEnabled } from './client';
import { createAuthenticatedFetch } from './api';
import type { Credentials, AuthMode } from './validation';

const verifierParam = 'neon_auth_session_verifier';
const appReturnURL = 'steadyforum://google-auth';
const appCallbackURL = 'https://steadyforum.fit/google-app-callback.html';

type User = { id: string; email: string; name: string };
type AuthState = { user: User | null; loading: boolean; error: string | null };
type AuthContextValue = AuthState & {
  configured: boolean; refresh: () => Promise<void>; logout: () => Promise<void>;
  authenticate: (mode: AuthMode, fields: Credentials) => Promise<boolean>;
  /** Whether "Continue with Google" is offered (EXPO_PUBLIC_GOOGLE_SIGN_IN). */
  googleEnabled: boolean;
  /** True once signed in. On web the page leaves for Google and this resolves false. */
  signInWithGoogle: () => Promise<boolean>;
  resendVerification: (email: string) => Promise<void>;
  apiFetch: ReturnType<typeof createAuthenticatedFetch>;
  /** A fresh API token for connections fetch can't make (the cloud pose WebSocket, AI-17); null when signed out. */
  getApiToken: () => Promise<string | null>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: authConfigured, error: null });
  const generation = useRef(0), refreshSequence = useRef(0), mutating = useRef(false), activeUser = useRef<string | null>(null);
  function commit(next: AuthState) { activeUser.current = next.user?.id ?? null; setState(next); }
  async function refresh() {
    if (!authClient || mutating.current) return;
    const current = generation.current, sequence = ++refreshSequence.current;
    function apply(next: AuthState) {
      if (current !== generation.current || sequence !== refreshSequence.current) return;
      if (activeUser.current !== (next.user?.id ?? null)) ++generation.current;
      commit(next);
    }
    try {
      const callback = Platform.OS === 'web' ? new URLSearchParams(window.location.search) : null;
      const verifier = callback?.get(verifierParam);
      const { data, error } = await authClient.getSession({ query: { disableCookieCache: true, ...(verifier ? { [verifierParam]: verifier } : {}) } });
      if (current !== generation.current || sequence !== refreshSequence.current) return;
      if (error?.status === 401) { apply({ user: null, loading: false, error: 'Your authentication session expired. Please log in again.' }); return; }
      if (error) throw new Error('Could not restore your session. Check your connection and try again.');
      if (!data?.user && (verifier || callback?.get('oauth') === 'google')) throw new Error('Google sign-in could not establish a session. Please try again.');
      if (data?.user && callback && (verifier || callback.get('oauth') === 'google')) {
        const url = new URL(window.location.href);
        url.searchParams.delete(verifierParam); url.searchParams.delete('oauth');
        window.history.replaceState(window.history.state, '', url.href);
      }
      apply({ user: data?.user ?? null, loading: false, error: null });
    } catch (error) { apply({ user: activeUser.current === state.user?.id ? state.user : null, loading: false, error: message(error) }); }
  }
  const refreshOnFocus = useEffectEvent(() => { void refresh(); });
  useEffect(() => {
    refreshOnFocus();
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') refreshOnFocus(); });
    function focus() { refreshOnFocus(); }
    if (Platform.OS === 'web') window.addEventListener('focus', focus);
    return () => { subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('focus', focus); };
  }, []);
  async function authenticate(mode: AuthMode, fields: Credentials) {
    if (!authClient) throw new Error('Sign-in is not connected yet.');
    if (mutating.current) throw new Error('Please wait for the current sign-in request.');
    mutating.current = true;
    const current = ++generation.current;
    try {
      const credentials = { email: fields.email.trim(), password: fields.password };
      const result = mode === 'signup'
        ? await authClient.signUp.email({ ...credentials, name: fields.name.trim() })
        : await authClient.signIn.email(credentials);
      if (result.error) throw new Error(result.error.code === 'EMAIL_NOT_VERIFIED' ? 'Verify your email before logging in.' : result.error.message || 'Could not sign in. Please try again.');
      const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
      if (error) throw new Error('Could not confirm your session. Please try logging in.');
      if (current !== generation.current) return false;
      commit({ user: data?.user ?? null, loading: false, error: null });
      return Boolean(data?.user);
    } finally { mutating.current = false; }
  }
  async function signInWithGoogle() {
    if (!authClient || !googleSignInEnabled) throw new Error('Google sign-in is not available yet.');
    if (mutating.current) throw new Error('Please wait for the current sign-in request.');
    mutating.current = true;
    const current = ++generation.current;
    try {
      // Neon requires an HTTPS callback. The hosted page hands the verifier back
      // to native, where the Expo adapter has retained the challenge cookie.
      const web = Platform.OS === 'web';
      const origin = web ? window.location.origin : '';
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: web ? `${origin}/login?oauth=google` : appCallbackURL,
        errorCallbackURL: web ? `${origin}/login` : appCallbackURL,
        ...(!web ? { disableRedirect: true } : {}),
      });
      if (result.error) throw new Error(result.error.message || 'Could not sign in with Google. Please try again.');
      if (web) return false; // the browser is on its way to Google
      if (!result.data?.url) throw new Error('Google sign-in did not return an authorization URL.');
      const returned = await openAuthSessionAsync(result.data.url, appReturnURL);
      if (returned.type !== 'success') return false;
      const callback = new URL(returned.url);
      if (callback.protocol !== 'steadyforum:' || callback.hostname !== 'google-auth' || callback.searchParams.has('error')) throw new Error('Google sign-in didn’t finish. Please try again.');
      const verifier = callback.searchParams.get(verifierParam);
      if (!verifier) throw new Error('Google sign-in did not return a session verifier. Please try again.');
      const query = { disableCookieCache: true, [verifierParam]: verifier };
      const { data, error } = await authClient.getSession({ query });
      if (error) throw new Error('Could not confirm your session. Please try again.');
      if (current !== generation.current) return false;
      if (!data?.user) throw new Error('Google sign-in could not establish a session. Please try again.');
      commit({ user: data?.user ?? null, loading: false, error: null });
      return Boolean(data?.user);
    } finally { mutating.current = false; }
  }
  async function logout() {
    if (!authClient) return;
    if (mutating.current) throw new Error('Please wait for the current sign-in request.');
    mutating.current = true;
    ++generation.current;
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error('Could not log out. Check your connection and try again.');
      ++generation.current;
      commit({ user: null, loading: false, error: null });
    } finally { mutating.current = false; }
  }
  async function resendVerification(email: string) {
    if (!authClient) throw new Error('Sign-in is not connected yet.');
    const { error } = await authClient.sendVerificationEmail({ email: email.trim() });
    if (error) throw new Error(error.message || 'Could not send verification email.');
  }
  async function getApiToken() {
    // A token for an account that logged out or changed while it was fetched is never handed out.
    const requestGeneration = generation.current, requestUser = activeUser.current;
    if (!authClient || !state.user || requestUser !== state.user.id) return null;
    const { data, error } = await authClient.token();
    if (requestGeneration !== generation.current || requestUser !== activeUser.current) return null;
    return error || !data?.token ? null : data.token;
  }
  async function apiFetch(path: string, options?: RequestInit) {
    const requestGeneration = generation.current;
    function invalidate() {
      if (requestGeneration !== generation.current) return;
      ++generation.current;
      commit({ user: null, loading: false, error: 'Your authentication session expired. Please log in again.' });
    }
    function rejectApiSession() {
      if (requestGeneration !== generation.current) return;
      setState(current => ({ ...current, error: 'The workout server could not verify your session. Try again.' }));
    }
    const response = await createAuthenticatedFetch(apiUrl, async () => {
      if (!authClient || !state.user || activeUser.current !== state.user.id) return null;
      const { data, error } = await authClient.token();
      if (error?.status === 401) invalidate();
      if (error || !data?.token) throw new Error('Could not get your session token. Please log in again.');
      return requestGeneration === generation.current ? data.token : null;
    }, rejectApiSession)(path, options);
    if (requestGeneration !== generation.current) throw new Error('Your account changed. Please try again.');
    return response;
  }
  return <AuthContext.Provider value={{ ...state, configured: authConfigured, googleEnabled: googleSignInEnabled, signInWithGoogle, refresh, authenticate, logout, resendVerification, apiFetch, getApiToken }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
