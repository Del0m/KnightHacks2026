# FE-08 and FE-10

Issues: FE-08 (#33), FE-10 (#35). Dependencies BE-05 (#16), INT-06 (#90), and BE-09 (#20) are closed. Work is on `codex/fe-08-fe-10`, built on the pending camera/mobile PR #121 plus current main.

## Workout summary

Finishing a workout opens the Summary component from the existing workout route. It shows a glass medal card, one-line explanation, total sets/reps, form score and percentage-point comparison with the 28-day baseline, and server personal records with their previous values. The immediate phone result follows INT-06 thresholds and averages previous measured sessions; the server award replaces it after account syncing. Manual or mixed manual workouts do not display or share a fabricated measured form score. Offline PRs are never invented.

The upload queue preserves the validated snake-case finish response in account-scoped MMKV/localStorage, then notifies the visible summary. Recovery uses `GET /sessions/:id/summary` after a lost/malformed finish response. That endpoint reads the committed award, baseline, PRs, and rep counts, checks ownership, and rejects unfinished sessions; it does not award or export again.

Share to feed starts off. Selecting it reveals an explicit Share workout button. Guests and unsynced summaries cannot publish. Sharing uses `PUT /sessions/:id/share` with `{ body, data }`; the server checks ownership and completion and locks the session row before reusing or creating its session post. Lost responses and repeated requests cannot create duplicate session posts. Moderation still applies. Successful share status is retained on the device. Existing account auto-post preferences remain separate from this per-workout action.

## Feed

The account-gated Feed uses a FlatList with the same glass page frame, cursor pagination from `GET /feed`, pull-to-refresh, deduplication, loading/empty/end/error states, and retry without discarding loaded posts. It renders session, PR, medal, goal, and advice posts using backend author, body, date, kudos and comment counts. Gold workout cards have a gold glass tint, rim, and explicit label.

Kudos uses the existing POST/DELETE endpoints, prevents duplicate taps, and only updates after success. A refresh that already contains the mutation does not double-adjust its count. Requests are canceled on blur, account changes remount the feed, and late account responses are discarded. Comment counts are displayed; the Feed follow-up below adds composing and browsing comments.

## Deployment and checks

### Intermittent blank tab on iPhone

The owner's screenshots show Feed selected with the whole page missing, including the brand and heading; the working state shows the expected empty feed. Installed Expo Router 57.0.25 still derives native screen activity state from native-driven animated progress in `BottomTabView.js`. This matches [Expo #49681](https://github.com/expo/expo/issues/49681), which describes blank tabs with animated transitions and automatic detachment.

The tab navigator now sets `detachInactiveScreens={false}`. Sliding transitions, the custom glass tab bar and lazy initial loading remain. Visited tab views stay attached, using more memory; this avoids the affected native detach path without patching dependencies. Feed still cancels requests on blur. Revisit this setting after an SDK-compatible Expo Router release contains the upstream fix. Physical confirmation should switch Feed ↔ Train and Feed ↔ Me repeatedly, including rapid switches and both tapping and dragging the bottom bar.

Follow-up checks: mobile typecheck passed, lint passed with eight existing warnings and zero errors, and the three Feed/tab suites passed all 10 tests. Those tests cover API/feed behavior and swipe selection; they do not reproduce native detachment. The owner's iPhone check remains required.

The Workout/Practice selector captures touches at the start and owns its page scroll lock through responder release, termination, or unmount. Vertical drags remain reserved to the selector; horizontal drags update the bubble and tint. Tap selection and accessible tab buttons remain available. AppPage no longer clears other controls' locks on bubbling touch cancellation. Regression tests cover ownership, tap selection, vertical holding, release, cancellation, and cleanup. Physical iPhone confirmation is still required after this follow-up.

Deploy the two new API routes alongside the frontend. No dependencies, database migrations, credentials, or native signing changes are needed. Physical signed-in phone verification against the updated API remains a manual check: finish a camera session, verify award/PRs, choose sharing, confirm one gold/session card, paginate/refresh, and toggle kudos. This implementation does not post any real workout during automated checks.

Verified October 10, 2026: 64 mobile suites / 627 tests and 21 API files / 147 tests passed. Mobile/API typechecks passed. Mobile lint has zero errors and eight existing warnings; changed API files pass lint and formatting. Web export succeeds. Regression coverage includes finish-result recovery, share ownership/retries, unmeasured manual summaries, cursor deduplication/retries, account changes, and kudos during refresh. The supplied private environment values were scanned against changed/new source files without printing values.

## Durable uploads after every set — October 10, 2026

Each camera set uses main's shared schema-version-1 recorder: actual bounded pose frames, relative rep times, stable set index, end flags, and the actual Core ML/Vision inference source. Manual and legacy records remain local rather than becoming fabricated measured records. Main's strict session and set routes are preserved alongside summary recovery and public sharing.

Before the completion flashlight pulse or React state update, the workout synchronously stores its completed sets, feedback, original start time, inference source, session checkpoint, exercise order and rest deadline in account-scoped MMKV (localStorage on web). Signed-in camera sets immediately enter the durable upload queue and start uploading during rest. Active uploads never call session finish. Transient failures retry through the existing foreground/30-second worker; permanently rejected uploads remain stored separately and do not block other workouts. Guests and manual workouts keep their drafts locally.

Train offers Resume Workout when a draft exists. Back to Train leaves that workout unfinished. Restarting restores the next stable set index and remaining rest interval without rechecking framing. Upload checkpoints survive retries, including lost set responses (409). A newer set or Finish arriving during an upload retains the newest queue payload and the same server session. Finish writes local history with the original draft ID, queues session finalization and summary recovery, then clears the active draft. Manual Undo restores the durable draft. Auth refresh cannot restore an obsolete snapshot or resurrect a finished workout.

Verification: 69 mobile suites / 739 tests and 28 API files / 536 tests passed; both TypeScript checks passed; web export passed; mobile lint has zero errors and eight existing warnings. Added recovery, before-pulse persistence, account isolation, lost-response retry, upload/Finish races, authentication refresh and manual Undo/remount coverage. The two review regressions failed when their fixes were temporarily removed, then passed with the fixes restored. API replay goldens now reflect four seconds of stillness, and the sharing test creates a session using main's required inference mode. Independent review found no remaining blocking durability issues.

Credential comparison against supplied private environment values found no matches in outgoing changes/history and no tracked private env files. The local FE-01 iPhone note remains untracked. Physical interruption/offline recovery and signed-in syncing against the deployed updated API still need an iPhone check; automated tests do not publish real workouts.

## Public Feed discovery and local connection diagnosis

The iPhone's configured temporary API endpoint was unavailable, and no API/tunnel was running on the Mac. Starting the existing API with the ignored Neon environment returned database readiness `ok`. A read-only aggregate query found three posts from one author, zero shared session posts, and one completed session; unshared session history is not automatically published.

The app now requests `GET /feed?scope=public`, which retrieves persisted shared posts across authors without requiring follows or a matching gym. Default `scope=following` preserves the existing curated API contract. Both modes keep newest-first cursor pagination and mutual blocking. Public-post kudos/comments use the same public visibility rule. No private/raw workout sessions are exposed and no demo posts are inserted into the real database. Network TypeErrors now explain that the workout server could not be reached instead of displaying raw fetch errors.

Public-discovery regression tests cover historical pagination, an unfollowed advanced author at another gym, existing shared workout data and author names, exclusion of an unshared session, kudos/comments, and blocking in both directions. API tests passed 28 files / 537 tests; Feed tests passed 2 suites / 9 tests; mobile/API TypeScript passed; mobile lint has zero errors and eight existing warnings; changed API files pass lint/formatting.

The owner approved temporary Cloudflare testing after reviewing token transit and alternatives. Both HTTP/2 TCP and QUIC outbound connections on port 7844 failed in the execution environment; no tunnel registered, and the mobile API URL was deliberately left unchanged. The local API remains running on port 3000. The owner was asked to start the downloaded official `/private/tmp/cloudflared` utility in Terminal and provide its registered HTTPS URL before the app is reconfigured.


## Feed cards, composing, and example preview

The Feed now distinguishes custom posts (light purple glass), workout medals (bronze, silver, or gold glass with a medal on the right), and personal records (clear glass with softened rainbow reflections confined to the rim). Public workout cards render shared exercises and positive highlights. The UI calls kudos “Rep”; existing database and endpoint names are preserved.

The circular filter beside Feed selects Recent, Custom posts, Medals, or Personal records. The API filters before cursor pagination, so older records remain discoverable even beyond a page of custom posts. Comments include profile display names. New Post opens an animated bottom sheet at 55% of the screen height, with an expanding text field that fills the sheet, a 500-character limit and counter; comments use a taller sheet and retain their existing 1,000-character contract. Submission is explicit, guarded against duplicate taps, and preserves rejected drafts. A delayed comments read cannot erase a just-submitted comment.

Filter → Preview 10 examples shows three fictional custom posts, four medals (including all three tiers), and three records. Preview reactions, comments, and posts remain local and never write fake identities or workouts to Neon. `/feed-examples` offers the same fictional preview for layout checking. Live Feed still requires a confirmed account.

The owner's temporary tunnel stopped returning API responses after the Mac changed networks. Cloudflare returned HTTP 530, while the local API remained available. Returning to the iPhone hotspot restored a new approved HTTPS tunnel, whose database readiness returned `ok`. Only the ignored local mobile environment was updated; no tunnel URL or private credentials are committed. The refreshed iPhone requested `/me/profile` and `/feed?scope=public`, both HTTP 200.

Verification: API 28 files / 538 tests passed. Both TypeScript checks passed; mobile lint has zero errors and eight existing warnings, and changed API files pass lint. Feed regression coverage includes server-side type pagination, local-only examples, explicit posting, moderation drafts, comment races, and the 500-character limit. The owner confirmed posts load again on the connected iPhone. Follow-up softened the rim and filled the composer with the text field. Both GET and POST comment results deduplicate by ID, and sheets can shrink when the keyboard opens. Native keyboard appearance remains a manual check. Final mobile suite: 71 suites / 749 tests; latest Feed checks: four suites / 18 tests. Web export passes.
