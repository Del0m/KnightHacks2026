# SteadyForum exercise practice

## Behavior

- The existing daily routine stays in place under Today’s Workout. The Practice selector beneath the figure lists five exercise previews: bicep curl, squat, shoulder press, push-up, and lunge.
- All five use the existing rigged human model, with exercise-specific bone animation, camera framing, and muscle highlights. Dumbbells appear for curls, shoulder presses, and lunges. Lunges use straight arms and a neutral grip, with fingers closed around the weights.
- The Workout/Practice selector accepts held drags, with a blue tint for Workout and a green tint for Practice that blend continuously with thumb position, before release. Its highlight follows the finger and springs back on cancellation.
- Workout and Practice share the same selected exercise, playback and viewing angle; switching selectors leaves the figure running.
- Selecting an exercise smoothly expands a indented bright-green Practice Form subheading beneath the exercise row. Practice uses the live camera and form engine, then shows good-rep feedback and advice. Practice again starts a fresh attempt; Return to Training exits. Practice does not save or upload workout sets.
- Completion checks occupy a fixed-width column at the far right, with a 12-point gap.
- All five main tabs transition horizontally across the screen, without a crossfade. The bottom tabs support dragging their glass highlight, with resisted overscroll and a spring return at either end. Shared glass surfaces have a light rim; shared pressable controls have a small spring response that respects Reduce Motion.
- Single-finger drags over the figure reach the native page ScrollView directly. The native wrapper captures only two-finger pinch, so model scrolling uses the page’s native momentum and speed.
- Practice rows use highlight and expansion without +/− indicators.
- The rotation slider has a neutral track with no colored progress trail and a ↔ thumb indicator at rest. Holding it hides the arrow to expose the native bubble.
- Pause is at the top left of the model. A rotation slider below the model replaces native finger rotation. Pinch still zooms; a single finger scrolls the page.
- Onboarding Continue and Finish setup use the shared glass Action button.
- The displayed product name is SteadyForum. Existing storage keys, URL scheme, database catalog, and package identifiers stay compatible with installed data and integrations.

## Validation

- Mobile: 60 test suites, 611 tests pass; TypeScript passes; lint has no errors and eight existing warnings.
- Animation tests load the actual skeleton assets and check movement, planted limbs, transitions, pause, and rotation bounds.
- Practice tests cover feedback, a fresh retry, exiting, and avoiding workout history writes.
- Web export succeeds, including the practice route.
- iOS device build succeeds. The rebuilt app is installed and launched on the connected iPhone; owner confirmed native figure scrolling now matches the page. The final Practice Form subheading follows the owner’s feedback.
- Native-model browser inspection renders push-ups and lunges without shader errors.
- Private environment-value scan for this refinement: 4 changed/new files, zero matches.
