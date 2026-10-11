# FE-08 and FE-10

Issues: FE-08 (#33), FE-10 (#35). Dependencies BE-05 (#16), INT-06 (#90), and BE-09 (#20) are closed. Work is on `codex/fe-08-fe-10`, built on the pending camera/mobile PR #121 plus current main.

## Workout summary

Finishing a workout opens the Summary component from the existing workout route. It shows a glass medal card, one-line explanation, total sets/reps, form score and percentage-point comparison with the 28-day baseline, and server personal records with their previous values. The immediate phone result follows INT-06 thresholds and averages previous measured sessions; the server award replaces it after account syncing. Manual or mixed manual workouts do not display or share a fabricated measured form score. Offline PRs are never invented.

The upload queue preserves the validated snake-case finish response in account-scoped MMKV/localStorage, then notifies the visible summary. Recovery uses `GET /sessions/:id/summary` after a lost/malformed finish response. That endpoint reads the committed award, baseline, PRs, and rep counts, checks ownership, and rejects unfinished sessions; it does not award or export again.

Share to feed starts off. Selecting it reveals an explicit Share workout button. Guests and unsynced summaries cannot publish. Sharing uses `PUT /sessions/:id/share` with `{ body, data }`; the server checks ownership and completion and locks the session row before reusing or creating its session post. Lost responses and repeated requests cannot create duplicate session posts. Moderation still applies. Successful share status is retained on the device. Existing account auto-post preferences remain separate from this per-workout action.

## Feed

The account-gated Feed uses a FlatList with the same glass page frame, cursor pagination from `GET /feed`, pull-to-refresh, deduplication, loading/empty/end/error states, and retry without discarding loaded posts. It renders session, PR, medal, goal, and advice posts using backend author, body, date, kudos and comment counts. Gold workout cards have a gold glass tint, rim, and explicit label.

Kudos uses the existing POST/DELETE endpoints, prevents duplicate taps, and only updates after success. A refresh that already contains the mutation does not double-adjust its count. Requests are canceled on blur, account changes remount the feed, and late account responses are discarded. Comment counts are displayed; composing/browsing comments belongs to FE-11.

## Deployment and checks

The Workout/Practice selector captures touches at the start and owns its page scroll lock through responder release, termination, or unmount. Vertical drags remain reserved to the selector; horizontal drags update the bubble and tint. Tap selection and accessible tab buttons remain available. AppPage no longer clears other controls' locks on bubbling touch cancellation. Regression tests cover ownership, tap selection, vertical holding, release, cancellation, and cleanup. Physical iPhone confirmation is still required after this follow-up.

Deploy the two new API routes alongside the frontend. No dependencies, database migrations, credentials, or native signing changes are needed. Physical signed-in phone verification against the updated API remains a manual check: finish a camera session, verify award/PRs, choose sharing, confirm one gold/session card, paginate/refresh, and toggle kudos. This implementation does not post any real workout during automated checks.

Verified October 10, 2026: 64 mobile suites / 627 tests and 21 API files / 147 tests passed. Mobile/API typechecks passed. Mobile lint has zero errors and eight existing warnings; changed API files pass lint and formatting. Web export succeeds. Regression coverage includes finish-result recovery, share ownership/retries, unmeasured manual summaries, cursor deduplication/retries, account changes, and kudos during refresh. The supplied private environment values were scanned against changed/new source files without printing values.
