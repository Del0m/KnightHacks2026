/* eslint-disable @typescript-eslint/no-require-imports -- Isolate the platform/env client factory. */
import { createAuthClient } from 'better-auth/react';
jest.mock('better-auth/react', () => ({ createAuthClient: jest.fn(() => ({})) }));
jest.mock('better-auth/client/plugins', () => ({ jwtClient: () => ({ id: 'jwt' }) }));
jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({ id: 'expo' }) }));
jest.mock('expo-secure-store', () => ({}));
let mockPlatform = 'ios';
jest.mock('react-native', () => { const native = jest.requireActual('react-native'); Object.defineProperty(native.Platform, 'OS', { configurable: true, get: () => mockPlatform }); return native; });
const original = process.env.EXPO_PUBLIC_NEON_AUTH_URL;
afterEach(() => { process.env.EXPO_PUBLIC_NEON_AUTH_URL = original; jest.clearAllMocks(); });
function options(platform: 'ios' | 'android' | 'web') {
 mockPlatform = platform;
 process.env.EXPO_PUBLIC_NEON_AUTH_URL = 'https://auth.example.com/neondb/auth'; jest.isolateModules(() => require('../client')); return jest.mocked(createAuthClient).mock.calls.at(-1)?.[0];
}
it.each(['ios', 'android'] as const)('sends the auth HTTPS Origin on %s while preserving the native cookie adapter', platform => {
 const configured = options(platform)!;
 expect(configured.fetchOptions?.headers).toEqual({ Origin: 'https://auth.example.com' });
 expect(configured.plugins).toEqual([{ id: 'jwt' }, { id: 'expo' }]);
});
it('lets the browser provide its actual Origin and manage cookies', () => {
 const configured = options('web')!;
 expect(configured.fetchOptions?.headers).toBeUndefined(); expect(configured.fetchOptions?.credentials).toBe('include');
 expect(configured.plugins).toEqual([{ id: 'jwt' }]);
});
