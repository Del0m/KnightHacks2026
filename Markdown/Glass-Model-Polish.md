# Glass workout figure

The web workout figure uses a clear physical glass material in place of opaque gray plastic. The user-supplied glass sculpture is the finish reference; the existing model asset and rig are retained.

- Three.js r180 physical transmission, zero metalness, low roughness, glass refraction, and a light blue absorption tint.
- Procedural studio reflections define the silhouette; a small white-to-blue backdrop supplies the refraction pass. A 14px edge fade blends the preview into the surrounding page.
- The existing muscle heat, shimmer, selection transitions, playback, camera controls and reduced-motion logic are retained. No external images, dependencies, model assets or generated artwork are added.
- Browser inspected at 390×844 and 1280×900; exercised curl, squat and press selection plus play/pause. No browser errors observed. The renderer script passes Node syntax checking; TypeScript passes and lint reports zero errors with the six existing pose-test warnings.
- Independent review found no functional issue. GPU performance and physical-device rendering are not benchmarked.

Previews: [mobile](Previews/Glass-Model/mobile.jpg), [desktop](Previews/Glass-Model/desktop.jpg).

Changes stay local. Pushing and PR creation remain on hold under the user's latest instruction.

## Depth and playback follow-up

- Fixed foreground dumbbell leakage into the glass. Three.js screen-space transmission samples the opaque scene without testing whether the sampled object is behind the glass. A depth-only pass of the opaque weights now supplies that test; foreground samples use the studio backdrop, while samples behind the body retain physical refraction. Studio reflections and muscle glow are preserved.
- The depth target follows the drawing-buffer resolution. Only the body mesh is hidden for the depth pass, so weights attached to its skeleton remain visible to that pass.
- Train focuses and autoplays the first exercise once reduced-motion preferences resolve. Reduced motion keeps the same focus with playback paused. Clicking an already-selected exercise does nothing; changing exercises starts the new demonstration. Full-body toggling is removed from the exercise rows and their accessibility hint.
- Added three regression checks for autoplay, repeat selection, manual pause and delayed/reduced-motion preference loading. Full suite: 128 tests in 24 suites passed. Typecheck, renderer-script syntax and diff checks pass; lint has zero errors and the same six existing warnings.
- Browser verified clean front view and retained behind-body refraction after orbiting to the back, plus mobile autoplay and repeat-selection behavior. No shader errors observed. Proof: [front](Previews/Glass-Model/refraction-front.jpg), [back](Previews/Glass-Model/refraction-back.jpg). GPU performance remains unbenchmarked.
