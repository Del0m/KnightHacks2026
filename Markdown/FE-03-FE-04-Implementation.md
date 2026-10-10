# FE-03 / FE-04 implementation

Branch: `codex/fe-03-fe-04`, based on `386a337`. Local changes only; no push or PR.

Design: [FE-03-FE-04-Design.md](FE-03-FE-04-Design.md).

## Delivered frontend

- Four-step onboarding with 12 glass goal bubbles and exactly three choices, Beginner/Experienced/Advanced, conditional PBs with units and reps, weekly or interval schedules with a date preview, and optional free-text injuries with the disclaimer.
- Onboarding drafts stay in memory, survive navigation and failed saves, and are discarded on account changes. Only a verified server response counts as completed setup.
- Train links to setup; Me’s top-right Settings button opens all four onboarding questions. Confirmed accounts with a missing/incomplete server profile are prompted once per account session; users can defer setup and keep training. Plan shows the saved training rhythm and goals; Me shows self-reported PBs.
- Camera setup asks users to choose their exercise spot, place the phone about 8 feet away, then return to the spot for a live framing check. Squats and lunges get side-on placement instructions.
- Live framing uses the existing iPhone pose pipeline, an outline, a text status, and phone-placement hints. All 17 joints must exceed 0.35 confidence, be inside the cropped preview with an 8% margin, be centered, and occupy at least 45% of preview height. Detection must remain suitable for 800 ms. Results older than 1 second are stale. Missing joints, camera errors, camera changes and backgrounding clear readiness.
- Web/Android retain the placement instructions and an honest manual-tracking fallback. This issue does not add live rep counting or video recording; workouts still use manual tracking.
- Native iOS 26 Liquid Glass via SDK-matched `expo-glass-effect`; readable fallbacks on other platforms, older builds and reduced-transparency settings. Reduced motion, explicit accessible checked states, step announcements, safe areas, scrolling and keyboard avoidance are included.

## BE-03 dependency: proposed integration contract

The current API tree has no BE-03 routes. This is an explicit frontend adapter contract awaiting agreement with the backend owner, not a verified existing backend schema. Auth/API public URLs also need the FE-02 setup.

`GET /me/profile` and `PUT /me/profile` return a profile object with these fields (additional unrelated fields are allowed):

```json
{
  "goals": ["muscle", "strength", "core"],
  "experience_level": "experienced",
  "personal_bests": [{"exercise": "squat", "weight": 100, "unit": "lb", "reps": 5}],
  "schedule": {"kind": "weekly", "days": [1, 3, 5]},
  "onboarding_completed": true
}
```

Goal IDs: `muscle`, `weight`, `strength`, `endurance`, `mobility`, `consistency`, `chest`, `back`, `shoulders`, `arms`, `core`, `legs`. Exactly three distinct goals. Experience: `beginner`, `experienced`, `advanced`. PB exercise IDs: `squat`, `bench`, `deadlift`; units: `lb` or `kg`; positive weight up to 2,000 and integer reps 1–100. Beginners or unknown PBs submit an empty PB array.

Weekly days use JS weekday numbers (Sunday=0). Interval schedules use `{"kind":"interval","every_days":3,"start_date":"2026-10-10"}`. Interval input supports 1–14 days and starting dates in 2020–2100. Calendar arithmetic preserves local days across DST. These frontend limits must be reconciled with backend validation.

`GET /me/injuries` returns an array of objects with string `description` fields. `POST /me/injuries` accepts `{"description":"user-entered text"}` (trimmed, at most 1,000 characters) and returns an object confirming that description. No diagnosis is inferred. No buddy-sharing consent is set. Existing injuries are retained; blank/Skip does not delete existing records.

Saving writes the profile with completion false, reconciles an injury note against GET before POST, verifies the injury acknowledgement, then writes and verifies completion true. A retry after a partial or ambiguous save checks the injury list again to avoid duplicating the note. This assumes backend read-after-write consistency; cross-device concurrent writes should ultimately use backend idempotency/uniqueness. No frontend mock can claim successful saving.

Missing profile GET (404) allows setup. Unsupported payloads, malformed responses, unavailable endpoints, rejected sessions and failed writes remain errors with answers retained. The app uses FE-02 authenticated requests; it never embeds database credentials.

## Verification and remaining acceptance

- Baseline: 101 tests passed before changes.
- Added checks cover goals, PBs, schedules/DST, invalid dates, account isolation, guest saving, partial-save retry, unsupported responses and injury acknowledgement; framing checks cover stale/missing/cropped joints, centering, distance, stability, mirroring and permission denial; step announcements have a regression test.
- Web UI inspected at 390×844 and 320×568, including all onboarding steps and side-on phone-placement instructions. Desktop layout also inspected. Previews are in [Previews/FE-03-FE-04/](Previews/FE-03-FE-04/).
- Independent code review found injury acknowledgement, a year-boundary preview crash and missing VoiceOver step announcements. All were reproduced with failing tests and fixed.
- Shared pose callback refs now update in layout effects, resolving React lint errors in the camera code consumed by FE-04.
- Final `jest --runInBand`: 21 suites, 121 tests passed.
- Final `tsc --noEmit`: passed.
- Final `expo lint`: passed with zero errors and six existing pose-test `require()` import warnings.
- Final `expo export --platform all --output-dir /tmp/spotter-fe-final`: passed for iOS, Android and web, including 17 static web routes. This verifies bundling, not a native-device run.
- `git diff --check`: passed.

Still required for live acceptance: BE-03 endpoint/payload agreement and a real authenticated round trip; rebuild the iPhone development app after adding native glass, then check actual camera placement, side-on all-17-joint tracking, native glass appearance, VoiceOver, large Dynamic Type, reduced transparency and background/resume on a physical iPhone. The strict facial-joint requirement can be difficult side-on; it has not been silently relaxed. No hardware test or measured-distance capability is claimed.

## Execution record

- FE-03 frontend: implemented; backend integration remains dependent on BE-03.
- FE-04 frontend: implemented; real-iPhone acceptance remains pending.
- Decision: work on a new local feature branch in the provided checkout, preserving the unrelated untracked `FE-01-iPhone-Check.md` file.
- Decision: eight feet is a placement suggestion, because the supplied pose contract has no calibrated depth.
- Decision: use a documented proposed BE-03 payload rather than changing backend-owned code or manufacturing successful saves.

## Requested polish follow-up

- Begin Workout enters camera setup. The duplicate Set up my camera action is removed; direct workout links also enter setup unless the user has completed it or explicitly chosen manual tracking. Rechecking placement during a workout returns to the existing session.
- Goal, experience and schedule choices have stronger translucent blue surfaces, gradient highlights, inset rims and soft shadows; web also uses backdrop blur. Native iOS glass and reduced-transparency fallbacks remain supported. PB and injury inputs receive a tinted surface.
- Me has a top-right Settings button. Settings opens Goals, Experience & personal bests, Workout schedule, and Injuries & limitations at the corresponding step with the current draft. Back dismisses to the existing Settings screen; the header wraps for larger text. Continue through the remaining questions to save the complete profile. Injury notes still follow the proposed append-only backend contract above.
- Follow-up verification: 125 tests in 23 suites pass, typecheck passes, and lint has zero errors with the same six existing warnings. iOS, Android and web export passes (18 static web routes). Browser verified Begin Workout → camera setup and updated glass choices at 390×844. Authenticated settings and physical-iPhone checks still depend on the acceptance items above.

## FE-03 copy and settings polish

- Removed motivational filler from onboarding, settings, workout, planner, camera instructions and empty states. Labels now describe the question or action directly. Login’s unavailable state no longer exposes the auth vendor or team setup details.
- Me’s Settings action is a gear in a circular 48-point glass control with an accessible Settings label. The existing native glass, reduced-transparency fallback and web treatment are reused.
- Verified the gear on a 390×844 browser preview using an empty guest profile through a temporary local preview route. The route was removed after inspection; the normal Me account gate remains in place. Preview: `Previews/FE-03-FE-04/profile-gear-390.jpg`.
- 125 tests pass; typecheck and lint pass with the same six existing warnings. BE-03 saving and authenticated device acceptance remain pending.
- Latest user instruction: keep the FE-03 changes local. Do not push or create a PR until explicitly authorized again.

## Compact Settings layout

Removed the four descriptions beneath the question buttons and arranged the glass controls in a two-column grid with equal-height rows. Verified at 390×844 in the authenticated Settings screen. Existing question-navigation test, typecheck and lint pass (six existing warnings). Preview: `Previews/FE-03-FE-04/settings-compact-390.jpg`. Changes remain local.
