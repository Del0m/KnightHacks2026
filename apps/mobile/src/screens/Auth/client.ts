import { createAuthClient } from 'better-auth/react';
import { jwtClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const authUrl = process.env.EXPO_PUBLIC_NEON_AUTH_URL?.trim();
export const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? '';
function validAuthUrl(value: string | undefined) {
  if (!value) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export const authConfigured = validAuthUrl(authUrl);
// "Continue with Google" shows only once Google is enabled in Neon Auth (Console > Auth >
// OAuth providers), so the button never leads to a "provider not found" error.
export const googleSignInEnabled = authConfigured && process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN?.trim() === 'true';
// Neon Auth exposes Better Auth APIs. The Expo adapter keeps native cookies in
// SecureStore; the browser uses the provider's HttpOnly cookie, never localStorage.
export const authClient = authConfigured ? createAuthClient({
  baseURL: authUrl,
  plugins: [jwtClient(), ...(Platform.OS === 'web' ? [] : [expoClient({
    scheme: 'steadyforum', storagePrefix: 'steadyforum-auth', storage: SecureStore,
    cookiePrefix: ['neonauth', 'neon-auth', 'better-auth'], disableCache: true,
  })])],
  fetchOptions: { credentials: 'include' },
}) : null;
