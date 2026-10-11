# FE-13 — Gym buddies

The Buddies tab now loads the authenticated backend’s real suggestions, incoming requests, outgoing requests and accepted buddies. Suggestions show the person’s display name/handle, gym name and the server’s matching reasons. No precise locations or private injury details are rendered.

## Contract

- `GET /buddies/suggestions` supplies ranked suggestions and the setup/empty-state hint.
- `GET /buddies` supplies accepted and pending relationships in both directions.
- `POST /buddies/:userId/request`, `/accept`, `/decline` use stable, encoded other-user IDs. Buttons lock immediately while a write is in progress; completed actions appear locally before the refresh, so a subsequent connection failure does not undo the successful action.
- `GET /me/profile` and partial `PUT /me/profile` load/save only matching gym fields and day/time slots (`mon_am` through `sun_eve`). Updating these preserves onboarding, goals, training schedule, privacy settings and existing gym coordinates.

The screen refreshes on focus without clearing its loaded cards. Requests are canceled on blur; older responses cannot replace a newer refresh. Account-keyed screen state clears matching data, pending writes and editor drafts on account changes/sign-out. Failed saves retain the draft; offline refresh offers retry with existing cards visible. Mutations require a live authenticated connection rather than queuing friendship writes offline.

## Privacy correction

The matching service already excludes mutual blocks from suggestions and new requests. The relationships endpoint now also excludes either-direction blocks, and accepting/declining a blocked request returns 404 without mutating it. Two database-backed regression cases verify both block directions and unchanged stored status.

## Existing service limitation

There is no gym search/place lookup endpoint in the current API. The preference editor therefore exposes the saved gym name and shared gym/place ID, with no home-location or GPS collection. Lifters must use the same gym ID to match. A searchable gym picker can replace this input when an actual place-search service is available; no mocked lookup or invented endpoint is used.

## Verification

- New mobile renderer tests: real suggestions/reasons, duplicate request prevention, incoming accept/decline, stale-account rejection, exact partial gym/schedule payload, offline refresh, retained failed-save drafts and sign-out cleanup (9 passing).
- `apps/api/test/buddies.test.ts`: existing scoring/request behavior plus both block directions (8 passing).
- Mobile and API typechecks, and scoped Buddies lint, run during implementation. Root integration verification covers the combined FE-09/FE-12/FE-13 suite and signed phone build.

## Phone check

Open Buddies while logged in, Edit the gym and matching slots, Save, then view Suggestions. Request a second test account and inspect Outgoing; log in as the recipient to inspect Incoming, accept/decline, and inspect Buddies. Repeat refresh while disconnected: loaded cards stay visible and retry appears. Verify no previous account cards or drafts remain after logout/login.
