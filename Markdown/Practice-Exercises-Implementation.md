# SteadyForum exercise practice

## Behavior

- The existing daily routine stays in place. Five exercise previews appear below it for testing: bicep curl, squat, shoulder press, push-up, and lunge.
- All five use the existing rigged human model, with exercise-specific bone animation, camera framing, and muscle highlights. Dumbbells appear for curls and shoulder presses.
- Selecting an exercise reveals a green Practice button. Practice uses the live camera and form engine, then shows good-rep feedback and advice. Practice again starts a fresh attempt; Return to Training exits. Practice does not save or upload workout sets.
- Pause is at the top left of the model. A rotation slider below the model replaces native finger rotation. Pinch still zooms; a single finger scrolls the page.
- Onboarding Continue and Finish setup use the shared glass Action button.
- The displayed product name is SteadyForum. Existing storage keys, URL scheme, database catalog, and package identifiers stay compatible with installed data and integrations.

## Validation

- Mobile: 59 test suites, 607 tests pass; TypeScript passes; lint has no errors and eight existing warnings.
- Animation tests load the actual skeleton assets and check movement, planted limbs, transitions, pause, and rotation bounds.
- Practice tests cover feedback, a fresh retry, exiting, and avoiding workout history writes.
- Web export succeeds, including the practice route.
- iOS device build succeeds. The rebuilt app is installed and launched on the connected iPhone; owner confirmation of the new practice and slider flow is pending.
- Native-model browser inspection renders push-ups and lunges without shader errors.
- Private environment-value scan: 42 changed/new files, zero matches.
