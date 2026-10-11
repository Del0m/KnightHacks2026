# FE-02 — Auth setup and handoff

Issue: https://github.com/Del0m/KnightHacks2026/issues/27

## Configuration

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and supply these public values:

```dotenv
EXPO_PUBLIC_NEON_AUTH_URL=https://YOUR-PROJECT.neonauth.REGION.aws.neon.tech/neondb/auth
EXPO_PUBLIC_API_URL=https://YOUR-API.example.com
```

Use the exact Auth URL shown in Neon Console → Auth, including its path. The example hostname is a placeholder, not a working service. API URLs may include a base path. Local API development accepts HTTP only on localhost or 127.0.0.1. Do not supply database credentials, signing keys, or administrative secrets. Restart Metro after changing environment values and rebuild exports/development builds when needed.

The URLs intentionally remain empty until the backend teammate supplies them. Login and account creation are disabled with a visible setup message. Train, Plan, and workout sessions are available to guests, even while auth is restoring or unconfigured. Me (You), Feed, and Buddies remain visible but show a login/account-creation prompt until a server-confirmed session exists. Their content does not mount for guests, including direct links. Login/signup provide a continue-without-login action; there is no mock authenticated session.

Configure the actual browser origin and native `steadyforum://` origin with the auth service. Confirm email verification, native cookie support, accepted cookie prefixes, and JWT endpoint/claims with the project's managed Neon Auth configuration. The API needs CORS for its web origin and BE-02 JWT validation. Never use a wildcard CORS origin for credentialed browser auth.

## Google sign-in

"Continue with Google" appears on login and sign-up only when `EXPO_PUBLIC_GOOGLE_SIGN_IN=true`. Until then nothing changes. The API needs no change: it reads only the token's `sub`, so a Google account gets a profile like an email account.

1. **Neon Console → the branch the app uses (demo) → Auth → OAuth providers → Google.**
   - Neon's shared development credentials are fine for trying it.
   - For the live site, create an OAuth client (type "Web application") in Google Cloud. Add the redirect URI Neon shows: Better Auth's `<Auth URL>/callback/google`. Paste the client ID and secret into Neon.
2. **Trusted domains (Neon → Auth → Settings):**
   - `https://steadyforum.fit` and `https://www.steadyforum.fit`, for the web
   - `steadyforum://`, for the native app
3. **Turn it on:** set `EXPO_PUBLIC_GOOGLE_SIGN_IN=true` in the Cloudflare build variables and in local `.env`, then rebuild.
   - **Native:** `expo-web-browser` is a native module, so rebuild the development build once.

**How it works:**
- **Web:** the page goes to Google and comes back to the site's `/`. A failure or cancel returns to `/login?error=…`, which the login screen explains.
- **Native:** Google opens in an in-app browser and returns through the `steadyforum://` scheme. The session is confirmed with the server before the app treats the user as signed in, as with email.

## Frontend behavior

- Email/password sign-up and login; optional password visibility, native autofill, keyboard navigation, validation, loading/errors, and verification-email resend.
- Better Auth client talks to Neon Auth's Better Auth endpoints. The Expo client plugin is used only on native, with Expo SecureStore for session cookies. Web uses provider-managed browser cookies. Passwords/JWTs are not written to localStorage.
- Launch/focus restores the server session. The public Router stack exposes Train, Plan, and workout immediately. Account gates protect Me, Feed, and Buddies until confirmation. Successful logout and rejected JWT requests clear app access. Refresh and auth mutations are ordered to prevent stale sessions returning after logout.
- Current account email/name and logout are available in Me. Local workout/profile keys are scoped to the authenticated account; the old guest key is preserved and never assigned to a new account. Native training history remains in memory, as before; cloud sync is outside FE-02.
- The Router entry and navigation dependencies remain active. Teammates' pose App/debug sources, native modules, tests, and dependencies are preserved for later integration.

Neon's wrapper client excludes custom plugins; the underlying Better Auth client lets the native Expo storage adapter participate. This choice still requires live verification against the team's Neon project and native build.

## API handoff

Inside a component, call the shared helper from `useAuth()`:

```tsx
const { apiFetch } = useAuth();
const response = await apiFetch('/sessions');
if (!response.ok) throw new Error('Could not load sessions.');
const sessions = await response.json();
```

Each request obtains a current JWT and attaches `Authorization: Bearer <JWT>` only to the configured API base. Absolute URLs, escaping paths, and redirects are rejected. A 401 clears the account session and relocks account features without a retry loop; public training remains available. Late responses from a previous account are rejected. No production endpoint was invented; BE-02 remains a dependency.

## Verification

- Jest: 14 suites, 98 tests passed, including existing pose tests and auth/session concurrency regressions.
- TypeScript: passed.
- ESLint on changed auth, routing, Me, and training files: passed.
- Full source lint has existing pose render-time ref errors in `PoseDebugScreen.tsx` and `usePoseOutput.ts`; pose code was left intact.
- Expo export passed for web, iOS, and Android, including 15 static web routes. This is separate from a signed native build and does not prove installation or SecureStore behavior on an iPhone.
- Browser visual inspection was blocked by the browser tool's security policy; no visual verification is claimed.

## Integration with main

Merged main at `8786108`, preserving AI-04 pose benchmark work and `react-native-mmkv`. The owner approved regenerating the conflicting lockfile while keeping both dependency sets. `pnpm install` via Expo succeeded. pnpm 11.25.0 is the declared package manager. The secondary npm lock was regenerated with `npm install --package-lock-only --ignore-scripts --legacy-peer-deps` because npm automatically selected an optional Reanimated version requiring worklets 0.13.x, while pose code pins worklets 0.10.1. Use pnpm for installs; its lock resolves the compatible optional Reanimated 4.5.1. No direct dependency or pose version was removed.

## Pending live acceptance

After adding the real URLs, verify new-account signup, verification required/disabled flows, invalid credentials, login, page reload/app restart persistence, protected-route access, logout, account switching, JWT claims accepted by the API, and expiry/401. Verify native cookie persistence and device installation in a new development build. Keep #27 open until these checks pass.

## References

- https://github.com/neondatabase/neon-js/tree/main/packages/auth
- https://better-auth.com/docs/integrations/expo
- https://better-auth.com/docs/plugins/jwt
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://docs.expo.dev/router/advanced/authentication/
