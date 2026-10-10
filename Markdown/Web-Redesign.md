# Spotter website design

## Implemented

The website follows the approved simple front page: firm Barlow typography, white/light-blue atmosphere, Spotter title, real workout-day streak, approved silver humanoid, divider-separated exercise list, Begin Workout, and compact five-tab navigation with curved upper corners. No generated artwork was added.

- **Train:** local rigged model with camera tweening, bilateral shimmering target glow, curl/squat/press demonstrations, pause/resume, and repeat-selection reset. The approved model and controlled squat depth are retained.
- **Plan:** selectable training days and focus, saved locally. The three-exercise routine is explicitly labelled a sample; these preferences do not yet generate workouts.
- **Feed:** personal completed-session activity and an honest empty state. Public community sharing is not connected.
- **Buddies:** locally saved training-time preference; matching remains an empty state until backend integration.
- **Me:** locally saved name, workout history, and streak. History and preferences remain in the current browser.
- **Workout:** manual rep entry across nine sets, rest countdown/skip, explicit demonstration playback, completion summary, save, and undo. No camera tracking or coaching is claimed.

Streaks count consecutive local calendar days with completed workouts, deduplicate multiple sessions on one day, and start at zero. The fixed-width flame slot changes silhouette/layers at 1, 7, 30, and 100 days. Reduced motion disables shimmer and camera/entrance transitions, and exercise demonstrations begin paused.

## Run

From `apps/mobile`:

```sh
pnpm web
```

For the production export and local preview with extensionless route support:

```sh
pnpm export:web
python3 scripts/serve-web.py
```

Open http://127.0.0.1:8081/. The local preview binds only to loopback. The static export lives in `apps/mobile/dist`; deploy using a host that supports Expo's generated route HTML.

## Verification

- TypeScript, ESLint, and Expo web export pass.
- `node apps/mobile/checks/workout.mjs` passes calendar/streak boundaries, duplicate-day completion, milestone, and stored-data validation checks.
- Browser checks cover phone 390 × 844 and desktop, all five tabs, direct Plan/Me reloads, persisted preferences/name, exercise focus/reset, and the complete nine-set workflow.
- A completed sample session saved nine sets and 96 reps, appeared in history, and increased the streak. Undo removed it and returned the streak to zero. Test profile/preferences were restored.
- Accessible selected/checked/pressed states are explicitly exposed on navigation, focus choices, days, and exercises.
- Phone screenshot: `Previews/Website-Glass-Mobile.png`.

## Remaining integrations

Backend accounts/sync, community posts, buddy matching, generated workout plans, and camera coaching are not connected. Native screens provide a textual model fallback; the interactive 3D implementation is currently web-only. Physical iPhone performance has not been tested.

## Glass refinement

The Train preview is 320 px tall, with a slightly closer default/reset camera (2.9 rather than 3.2 distance). Gray divider lines separate the streak, model, and agenda. The heading is “Todays agenda: Full body” for the sample routine. Rows are 52 px high, use ordinal ordering, omit arrows, and right-align sets/reps and muscle labels. Row names align with the streak text; ordinals and section edges share the icon-column edge.

A frosted Play/Pause control sits at the lower left inside the preview, switches its icon and label, and is disabled until an exercise is selected. The old model help/glow label is removed. Navigation and action buttons use translucent surfaces, highlights, restrained shadows, and browser backdrop blur; native keeps the translucent styling. No new dependencies or artwork were added.

Verification: typecheck, lint, and production export pass; browser checks cover the default framing, selection/reset, pause/resume, 390 × 844 phone layout, and 1280 × 900 desktop layout.

## Refractive glass and streak alignment

The corrected reference shows the small flame sitting below the streak text. Each SVG now centers its visible silhouette inside the same icon slot, including the zero-day dot. The streak label has an explicit line height; icon and text centers align without altering the milestone flame shapes.

Web glass controls use a separate backdrop layer with restrained blur, saturation, SVG displacement, a translucent blue/white gradient, edge reflections, and inset highlights. Foreground labels and navigation icons remain unfiltered. The selected navigation item has a clear glass highlight. Browsers that cannot apply SVG backdrop displacement retain blur/transparency, and reduced-transparency preferences switch to opaque surfaces. This is a web approximation inspired by [Apple's Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), not Apple's native material.

Verification: typecheck, lint, and web export pass; browser checks confirm the displacement backdrop filter is applied, streak alignment, exercise selection/pause, and navigation labels staying crisp above distorted content. Screenshot: `Previews/Website-Refractive-Mobile.png`.

## Default exercise focus

Train now selects the first agenda exercise on initial load, each tab press (including an already active Train tab), and when returning from another screen. The preview starts with upper-body framing rather than the full-body camera. Playback starts paused, with Play available. Manual exercise selection and repeat-selection reset remain available.

Verified initial first-row selection, changing exercises then re-clicking Train, returning from Plan, cropped model framing, typecheck, lint, and production export. Screenshot: `Previews/Website-Default-Exercise.png`.

## Consistent interaction polish

The bottom navigation uses one glass selection highlight that tweens horizontally in 380 ms with cubic easing. New tab selections interrupt from the current animated position; resizing updates its slot width. Reduced motion places it immediately.

Shared press controls enlarge by 2.5% during a tap across tabs, exercise rows, preferences, actions, and workout controls. Web pointer hover adds a subtle 2% enlargement, with consistent easing for scale, color, and opacity. Disabled controls do not enlarge; reduced motion disables scaling and tweening. Text fields gain a subtle focus accent.

Plan, Feed, Buddies, and Me no longer show introductory marketing headings or supporting slogans. Empty-state headings are concise functional labels. Training controls and backend/storage status remain available.

Verification: TypeScript, ESLint, and production export pass. Browser checks cover all tabs, intermediate and final highlight positions, interrupted tab transitions, and computed hover enlargement. Screenshot: `Previews/Website-Polished-Plan.png`.
