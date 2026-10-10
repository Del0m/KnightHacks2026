Closes #26.

Adds the Expo development-client scaffold in `apps/mobile/` with Train, Plan, Feed, Buddies, and Me navigation and shared white/light-blue theme tokens. Includes the approved frontend design, locally hosted exercise model, accessible glass controls, reduced-motion behavior, and a manual workout flow with local preferences, history, and streaks.

Development-client configuration, iOS/Android identifiers, EAS development profiles, and installation instructions are included. Architecture, setup, design records, source-asset licenses, and preview screenshots are stored in `Markdown/`.

## FE-01 acceptance

- [x] Five-tab navigation: Train, Plan, Feed, Buddies, Me.
- [x] Shared colors and typography.
- [ ] Signed Expo development build installed and verified on a teammate's physical iPhone. Required before merging; setup steps are in `Markdown/Mobile-Setup.md`.

## Validation

- TypeScript and ESLint pass.
- Expo iOS, Android, and web exports pass.
- Local-calendar streak and saved-data checks pass.
- Rig movement, full-repetition, grip/attachment, and finite-coordinate checks pass.
- Browser checks cover the five tabs, manual workout save/undo, model selection/reset, tab tweening, and phone/desktop layouts.

## Integration boundaries

Authentication, camera pose tracking, backend sync, public feed, and buddy matching are not connected. The interactive model is web-only; native displays a text fallback. The sample routine is explicitly identified, and physical-iPhone development-build acceptance remains pending.
