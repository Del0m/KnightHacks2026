# FE-03 / FE-04 integration

Branch: `codex/fe-03-fe-04`. Merged `origin/main` at `c889e6c`, including BE-03 and AI-06. Changes remain local; no push or PR.

## Onboarding and settings

Four steps: choose three of 12 glass goal bubbles, select experience and optional self-reported PBs, choose weekly days or an interval, and enter an optional injury note. The profile gear opens the compact Settings grid for editing any step. Drafts remain available after errors and are isolated by account. Plan and Me consume the confirmed profile.

The adapter now uses the real authenticated `GET/PUT /me/profile` route. UI “Experienced” maps to the backend’s `intermediate`; the original `schedule` time-slot array remains for buddy availability. Onboarding cadence uses `training_schedule`, preserving every-N-days schedules without inventing workout times.

BE-03 lacked storage for PBs, interval cadence and completion, so this integration adds migration `0002_onboarding.sql` and four profile columns: `personal_bests`, `training_schedule`, `onboarding_completed`, and an internal `onboarding_injury_id`.

A save sends:

```json
{
  "goals": ["muscle", "strength", "core"],
  "experience_level": "intermediate",
  "personal_bests": [{"exercise":"squat","weight":100,"unit":"lb","reps":5}],
  "training_schedule": {"kind":"interval","every_days":3,"start_date":"2026-10-10"},
  "injury_note": "User-entered note",
  "onboarding_completed": true
}
```

The backend validates cadence, real calendar dates, PBs and completion fields. It locks the account’s profile row and saves all answers and the private injury note in one transaction. The note is stored as `body_part=other` with no inferred diagnosis. Editing or clearing it replaces/removes only the onboarding-managed injury; other records remain. Retries do not accumulate injury records. GET returns `injury_note` for settings hydration. Notes are limited to BE-03’s 500 characters.

PBs are self-reported onboarding answers, separate from earned workout records. Authenticated requests come from FE-02; no database credentials are included in the app. A successful screen transition requires the server to confirm every submitted field.

## Camera and AI-06

Begin Workout enters the three-step camera guide: choose a spot, place the phone about eight feet away, then check framing. Exercise names, IDs and recommended views now come from AI-06’s bundled specs. Existing Train IDs `curl` and `press` resolve to `bicep_curl` and `shoulder_press`. Curls, squats, lunges and push-ups use side placement; shoulder presses use front placement.

The iPhone framing screen retains the pose pipeline, cropped-preview geometry, confidence checks, 800 ms stability requirement and one-second stale-result cutoff. Camera changes, errors, backgrounding and leaving the screen clear readiness. Eight feet is a starting suggestion, not a depth measurement. Web/Android retain placement instructions and manual tracking.

AI-06’s debug recorder/export and our camera-ref layout effect both survive the approved merge conflict. Added the missing Node test types and corrected form-engine render-time ref/state synchronization for the mobile lint rules. The engine regression suite passes.

Live workout rep counting is FE-05 / INT-02 and remains outside FE-03/FE-04. Setup does not start a counted set or pretend manual tracking is live tracking.

## Verification

- Mobile: 33 suites / 314 tests passed, including AI-06, camera, settings, onboarding and spec mapping.
- API: full suite 12 files / 63 tests passed against fresh PGlite databases and real JWT verification. The new test calls the actual frontend adapter through Express and checks reload, interval cadence, PBs, injury edits/clearing, retries and account isolation.
- Mobile and API typecheck and lint passed; mobile has seven existing test-import warnings and zero errors.
- Browser verified Begin Workout → spec-backed picker → side-on curl placement. Restarted Metro to load the merged watch-folder config. Preview: `Previews/FE-03-FE-04/curl-spec-placement.png`.
- iOS, Android and web exports passed (18 static web routes). Bundling does not verify native camera hardware.

## Runtime configuration still needed

`apps/mobile/.env.local` has an empty `EXPO_PUBLIC_API_URL`, and `apps/api/.env` is absent. A development API URL is required to test saving in the running app. The API deployment must apply `0002_onboarding.sql` before serving this frontend (`cd apps/api && npm run db:migrate` with its own configured development database). No shared database or deployment was modified.

Physical iPhone checks remain: camera placement, side-on joint confidence, background/resume, native glass, VoiceOver and Dynamic Type. The strict all-17-joint framing criterion can be difficult side-on and has not been relaxed without hardware evidence.
