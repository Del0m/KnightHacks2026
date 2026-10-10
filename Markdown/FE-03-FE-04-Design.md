# FE-03 and FE-04 — Proposed design

Updated October 10, 2026. This records the requested design before implementation.

## FE-03: Simple onboarding

Four screens, one decision per screen, compact progress indicator, Back and Continue controls. Keep answers while navigating and after a failed save. Use the existing Spotter white/light-blue palette and Barlow typography.

### 1. Goals

Prompt: “Pick 3 things to work toward.” Exactly three selections across both categories, with a visible `0 / 3` counter. No category quota. Selected bubbles get a blue tint and checkmark; a fourth choice prompts the user to deselect one. Bubbles wrap naturally and remain accessible at larger text sizes.

- Training goals: Increase muscle, Lose weight, Build strength, Improve endurance, Improve mobility, Stay consistent.
- Areas to build: Chest, Back, Shoulders, Arms, Core, Legs & glutes.

Twelve preset interactive glass bubbles total.

### 2. Experience

Beginner, Experienced, Advanced. Experienced and Advanced reveal compact personal-best fields inside this screen, keeping onboarding at four steps. Proposed exercise presets: Squat, Bench press, Deadlift. Record exercise, weight, lb/kg and reps so a multi-rep best is not mistaken for a one-rep maximum. Allow “I don't know yet”; do not encourage users to test a max for onboarding. Changing to Beginner removes PBs from the submitted payload.

### 3. Schedule

Two modes: “Weekly days” and “Every few days.” Weekly mode offers Mon–Sun toggles plus a Mon/Wed/Fri shortcut. Interval mode offers an every-N-days value, defaulting to 3, and a starting date. Display a short upcoming-date preview. Store these as distinct schedule types, rather than converting an interval into fixed weekdays. Require at least one day in weekly mode and a valid interval/start date in interval mode. Exact allowed interval range must agree with the backend contract.

### 4. Injuries

Optional multiline input: “Anything we should keep in mind?” Plain-language placeholder, visible “Not medical advice” disclaimer, Skip and Finish actions. Blank/Skip means no injury provided. Treat the text as user-reported information; do not infer a diagnosis or publish it to buddies. Structured injury mapping, if required by BE-03, needs agreement with the backend owner rather than guessing a body-part diagnosis from text.

### Saving and navigation

Reuse FE-02 authenticated requests for BE-03 `GET/PUT /me/profile` and `GET/POST/DELETE /me/injuries`. Confirm support for three goals, PBs, both schedule modes and free-text injuries before integration. These endpoints are absent in the current local API tree. Do not mark onboarding completed until all required writes succeed; retries must avoid duplicate injury entries after a partial save. Keep drafts account-scoped and discard them on account changes. Train, Plan and workouts remain public.

## FE-04: Choose a spot, place the phone, check framing

Interpretation: the user chooses where to exercise; the guide helps place the phone relative to that spot. This is placement guidance, not automatic room mapping.

1. “Stand where you'll do your reps.” Ask the user to choose a clear exercise spot and remember it using a floor landmark.
2. “Place your phone about 8 feet from that spot.” Show a simple diagram of the exercise spot and phone position, with side-on placement for squats and lunges. Eight feet is an initial suggestion within the architecture's 2–3 metre placement range; actual suitability depends on the camera and movement.
3. “Return to your spot.” Show the live preview and body outline. Use pose confidence, preview crop geometry and body position to suggest one adjustment at a time: move the phone farther back, center the exercise spot in view, or adjust the phone angle. Avoid implying that the intended exercise spot needs to move.
4. Turn the guide green and show “Ready” when all 17 joints meet the confidence threshold and are inside the visible preview with framing margin. Require stable detection to reduce flicker. Clear readiness on missing/stale results, camera changes, errors and backgrounding. Confirm in the UI that the exercise's movement needs to stay in frame; a standing pose alone cannot guarantee the whole rep is visible.

Reuse `usePoseOutput` and `jointToView`; create the framing component under `src/screens/LiveSet/FramingGuide.tsx` and integrate it with a camera setup route before camera-assisted sets. Use strict all-17 readiness for FE-04 and verify the side-on experience on an iPhone; report any conflict caused by facial-point occlusion rather than silently relaxing the requirement. Handle permissions, unavailable cameras and detector errors. Unsupported platforms get clear availability messaging.

The current pose contract contains normalized coordinates and confidence, not calibrated depth. Do not display measured feet, a room-space marker or exact distance corrections from that output. Metric distance/AR placement would require a separately agreed calibrated/depth integration.

## Visual polish and accessibility

Follow Apple's iOS 26 Liquid Glass principles: glass for interactive controls and navigation with legible content beneath, purposeful grouping and restrained depth. Verify native glass support for this Expo version before choosing the implementation; supply readable fallbacks on other systems.

- Spacious composition, clear typographic hierarchy, two labelled goal groups, and a single primary action per screen.
- Glass choice bubbles with subtle highlight edges, restrained shadows, clear selection state and generous touch targets.
- Intentional press feedback, selection transitions and screen transitions; respect reduced motion, reduced transparency and increased contrast.
- Safe-area-aware bottom actions, keyboard avoidance, dynamic text, VoiceOver labels and selection announcements.
- Camera status must remain readable over varied backgrounds and use text in addition to color.

Reference: https://developer.apple.com/design/human-interface-guidelines/materials

## Implementation order and verification

1. Confirm the BE-03 payloads and current Expo/native glass APIs.
2. Build FE-03 and verify three-goal limit, conditional PBs, schedule switching, injury skipping, validation, save failures/partial retries and account isolation.
3. Build FE-04 and verify missing/low-confidence/cropped/stale joints, mirrored preview geometry, tracking stability and camera lifecycle.
4. Run mobile lint and typecheck; inspect small/large iPhone layouts, large text, keyboard behavior and accessibility settings. Validate real camera placement, side-on tracking and readiness on a physical iPhone.

Keep documentation in `Markdown/`, preserve teammates' work, and do not push or publish PRs without an explicit request.
