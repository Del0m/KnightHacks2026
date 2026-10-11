# Train front page redesign — proposal

## User brief

Follow the supplied hand-drawn layout: SteadyForum title, streak with growing flame, grey 3D humanoid, today's exercise list, Begin Workout button, and a raised bottom navigation bar. Keep white and light blue with firm Barlow typography. Replace the promotional photo hero on Train.

## Streak

| Days | Shape | Colour |
| --- | --- | --- |
| 0 | Grey dot | Grey |
| 1–6 | Two spikes, single layer | Orange |
| 7–29 | Three spikes, two layers | Red |
| 30–99 | Five spikes, three layers | Blue |
| 100+ | Seven spikes, four layers | Blue, bright core |

`Previews/Streak-Icons.svg` shows the five proposed icons. Use a fixed icon slot beside the day count so the text stays aligned. Flames retain a similar width and shared baseline. Streak milestones increase height, spike count, and layered colour intensity rather than scaling the same silhouette. Count completed workout days, not app opens; use local calendar days and increment at most once per day. Streak persistence needs actual completed-session data. Initially show 0 rather than inventing history.

## Layout and interaction

- Mobile: a single vertical flow with restrained spacing, no marketing headline, no photo hero.
- A matte grey humanoid sits on a subtle light-blue background. Default view shows the whole body and all target muscles for today's routine.
- Exercise rows show exercise name, sets/reps, and target muscle names. Selecting a row highlights its muscles red, rotates toward their best view, and adjusts camera framing. Selection is also expressed with text and a clear row indicator.
- Motion respects reduced-motion preferences. The model supports manual orbit and a reset-to-whole-body control. Show a useful textual fallback if 3D fails to load.
- Begin Workout opens a frontend session for the selected routine. It must not claim camera coaching works before the separate camera feature exists.
- The five-tab bar has larger icons and labels, a compact centred group on wide screens, rounded top corners, and a raised top edge. It sits against the phone sides and respects the bottom safe area.
- On desktop, constrain the app to a comfortable centred width rather than stretching five tabs across the window.

## Data assumptions

The backend and planner are not connected. Use an explicitly identified preview routine to demonstrate selection and muscle focus; do not present it as a personalised recommendation or completed history. Exercise-to-muscle regions are curated mappings, not measured physical strain.

## 3D model shortlist

1. [Anatomy study 2.0 Basemesh Human Male Body — varvarwork](https://sketchfab.com/3d-models/anatomy-study-20-basemesh-human-male-body-c3f13a4baa2f4ea5a0a88d29e7fa1779). Sculpted base, CC Attribution. Closest visual starting point; inspect downloaded mesh/material structure before choosing.
2. [Female muscles base mesh — horanbeckman](https://sketchfab.com/3d-models/female-muscles-base-mesh-abd8ccef6aeb42058601c192aadb8198). Alternative anatomy sculpt. Downloadability and exact license must be checked before bundling.
3. [MakeHuman](https://static.makehumancommunity.org/about/license.html). Neutral humanoid exports from official software are CC0. Best licensing simplicity, but muscle highlight regions must be added.
4. [Z-Anatomy](https://www.z-anatomy.com/). Detailed anatomy option with individually identifiable structures; more preparation and asset size than a simplified fitness mannequin. Check each source asset license before use.

## Implementation approach to verify

Use a real, non-generative humanoid asset with named muscle regions, loaded locally rather than a third-party embedded viewer. Adapt a Three.js renderer for web and Expo native rendering. Keep renderer code separate from routine/streak state. Verify Expo SDK compatibility, model download/license, geometry structure, and device performance before committing to a specific asset. No generative artwork.

## Acceptance checks

Streak boundaries at 0/1/6/7/29/30/99/100; each exercise selects the correct muscle regions and camera target; whole-body reset; keyboard and screen-reader selection; loading/error fallback; reduced motion; mobile/desktop layout; navigation safe area; lint/typecheck/builds; physical iPhone performance remains a separate required check.
