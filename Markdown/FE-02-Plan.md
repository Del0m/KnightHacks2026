# FE-02 — Sign up and login with Neon Auth

Issue: https://github.com/Del0m/KnightHacks2026/issues/27

## Scope

Email sign-up/login, secure session persistence, and authenticated API requests. Auth feature screens belong in `apps/mobile/src/screens/Auth/`; shared navigation/configuration changes are limited to what authentication needs. Keep the existing white/light-blue glass design and concise functional copy.

## Steps

1. Fetch the current main and check FE-01 PR integration before creating the FE-02 branch. Include the scaffold if it has not merged. Stop and involve the user if merge/rebase conflicts arise.
2. Confirm the team's Neon Auth configuration and current SDK/native integration, public Auth URL, allowed web origins/mobile callback configuration, API URL, email verification settings, and BE-02 JWT contract. Do not add database/admin secrets to the client.
3. Build email/password sign-up and login screens with password visibility, field validation, loading feedback, and readable errors. Handle email verification if the project's configuration requires it. Keep onboarding and social providers outside this issue.
4. Integrate the appropriate Neon session client. Persist native session credentials with platform secure storage; use provider-managed secure browser sessions for web. Restore sessions on launch, handle expiry, and clear sessions on logout. Do not persist passwords or place credentials in the existing local training storage.
5. Add auth state and account gates for Me, Feed, and Buddies while leaving Train, Plan, and workouts public, plus a shared API request path that attaches the current JWT as a Bearer token. Handle rejected/expired authentication without retry loops. Scope or clear local workout/profile data when accounts change.
6. Verify sign-up, login, invalid credentials, launch/reload persistence, logout, protected routes, authenticated requests, and expiry/401 handling. Run typecheck, lint, and appropriate builds; document results before opening the FE-02 PR.

## Dependencies and acceptance

- FE-01 (#26): app scaffold/navigation; physical-iPhone dev-build validation was still pending in PR #77.
- BE-02 (#13): server-side JWT validation and user identity. The local checked-out API tree did not contain the middleware during this planning pass; check the current main before implementation.
- UI and an explicit integration interface can be prepared without a running backend. Real sign-up/login and secure-session/API acceptance require the actual Neon project configuration and a protected endpoint. Do not represent a mock session as authenticated.

## References

- https://github.com/neondatabase/website/blob/main/content/docs/auth/authentication-flow.md
- https://better-auth.com/docs/integrations/expo
- https://better-auth.com/docs/plugins/jwt
- https://docs.expo.dev/develop/authentication/

Frontend implementation is prepared on `codex/fe-02-neon-auth`. The owner requested empty public URL placeholders while a teammate configures Neon. See [FE-02-Auth.md](FE-02-Auth.md) for setup, implementation details, and remaining live acceptance checks.
