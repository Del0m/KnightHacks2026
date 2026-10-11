# Standalone native authentication — Origin correction

## Reproduction

The owner reported Plan/Feed/Buddies failing on both Wi-Fi and cellular, with login returning `Missing or null Origin`. Render is the data API; the separately configured Neon Auth service authenticates accounts.

A live probe sent deliberately invalid synthetic credentials and an invalid test cookie to the configured Auth service. With no Origin, it returned 403 `MISSING_OR_NULL_ORIGIN`. Sending the Expo plugin's `expo-origin: spotter://` alone returned the same rejection. Sending standard `Origin` equal to the configured Auth HTTPS origin returned 401 `INVALID_EMAIL_OR_PASSWORD`: the request passed Origin validation and reached credential validation. No real account credentials were used and no account was created.

## Correction

Native Auth client fetch options include the configured HTTPS auth origin on every authentication request. The existing Expo SecureStore cookie adapter remains enabled; its plugin supplies cookie handling and omits browser credentials on native. Browser requests do not override Origin. Server Origin/CSRF protection remains enabled.

Foreground session refresh also preserves an already server-confirmed account during a transient connection failure rather than immediately returning the user to login. Explicit session 401, an empty successful session, logout and account-generation changes retain their invalidation behavior. Initial startup does not grant access from an unverified stale cache. API requests still require a fresh JWT and the server continues to enforce authorization. A Render API 401 no longer destroys a separately valid Neon Auth login; it reports that the workout server could not verify the session. Only the Auth service’s own token/session rejection clears login. Signed-out account gates display their actual restoration error rather than hiding it.

## Verification and delivery

- Live invalid-credential Origin probe as above.
- New client tests cover iOS/Android Origin and unchanged browser headers/cookie behavior.
- New session tests cover a network failure after confirmed login and explicit 401 invalidation.
- 85 mobile suites / 845 tests pass (26 targeted Auth tests); mobile TypeScript and scoped Auth lint pass.
- Signed standalone Release rebuilt using the Render API, with embedded app code and native models. The first corrected Release was installed and launched. The owner confirmed login succeeds, then reported a later session invalidation. Public key discovery verified `Auth URL + /.well-known/jwks.json` returns keys (200), while `/jwks` returns 404. Render’s `NEON_AUTH_JWKS_URL` must match the same Auth branch; optional issuer/audience values must match actual issued tokens. Hosted configuration comparison and final connected-tab acceptance are pending the owner’s Render settings.

References: [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo) and installed `@better-auth/expo` client implementation. The hosted service's treatment of `expo-origin` was established by the live probe rather than assumed from the integration guide's self-hosted server example.

The final realm-separation Release was installed on the connected iPhone. The owner cannot currently inspect Render environment settings; the expected JWKS URL is assumed as requested, not independently verified. Public key endpoint validation is confirmed, but live account API acceptance still needs the phone test/server configuration check. No server authorization was bypassed.

## Confirmed hosted JWKS value

The owner supplied a screenshot showing `NEON_AUTH_JWKS_URL` set to the Neon auth base ending `/neondb/auth/`. A public unauthenticated check returned 404 for that exact URL. The correct endpoint, ending `/neondb/auth/.well-known/jwks.json`, returned 200 with one signing key. Render must use the full signing-key URL and redeploy. This is a server configuration change; changing the phone's auth base URL would be incorrect. The hosted deployment has not yet been reconfigured or verified with a real account token.

## Confirmed client/server branch mismatch

After the owner corrected Render's JWKS configuration, the phone still received API 401 responses. Comparing the ignored mobile configuration and installed Release bundle established that the phone used `ep-square-frost` Auth, while Render used `ep-snowy-sea` signing keys. Both public key endpoints returned 200, but the branches had different signing keys. The owner independently confirmed the phone account existed only on dev, not demo, and that Render's optional issuer/audience settings were unset.

The local mobile environment now uses demo Auth (`ep-snowy-sea`) and the Render API. The public environment example contains the same matched endpoints. A standalone rebuild is required because Expo embeds these public URLs in its bundle; the native bundling script uses `--reset-cache`. Existing dev accounts do not automatically become demo accounts: sign out and create or use a demo account. The current native scheme is `steadyforum://`, not the retired `spotter://`. No server authentication checks were relaxed, and no private environment file is tracked. Final authenticated acceptance still requires signing in on the phone.
