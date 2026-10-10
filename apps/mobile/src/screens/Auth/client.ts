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
// Neon Auth exposes Better Auth APIs. The Expo adapter keeps native cookies in
// SecureStore; the browser uses the provider's HttpOnly cookie, never localStorage.
export const authClient = authConfigured ? createAuthClient({
  baseURL: authUrl,
  plugins: [jwtClient(), ...(Platform.OS === 'web' ? [] : [expoClient({
    scheme: 'spotter', storagePrefix: 'spotter-auth', storage: SecureStore,
    cookiePrefix: ['neonauth', 'neon-auth', 'better-auth'], disableCache: true,
  })])],
  fetchOptions: { credentials: 'include' },
}) : null;
