# Glass workout figure

The web workout figure uses a clear physical glass material in place of opaque gray plastic. The user-supplied glass sculpture is the finish reference; the existing model asset and rig are retained.

- Three.js r180 physical transmission, zero metalness, low roughness, glass refraction, and a light blue absorption tint.
- Procedural studio reflections define the silhouette; a small white-to-blue backdrop supplies the refraction pass. A 14px edge fade blends the preview into the surrounding page.
- The existing muscle heat, shimmer, selection transitions, playback, camera controls and reduced-motion logic are retained. No external images, dependencies, model assets or generated artwork are added.
- Browser inspected at 390×844 and 1280×900; exercised curl, squat and press selection plus play/pause. No browser errors observed. The renderer script passes Node syntax checking; TypeScript passes and lint reports zero errors with the six existing pose-test warnings.
- Independent review found no functional issue. GPU performance and physical-device rendering are not benchmarked.

Previews: [mobile](Previews/Glass-Model/mobile.jpg), [desktop](Previews/Glass-Model/desktop.jpg).

Changes stay local. Pushing and PR creation remain on hold under the user's latest instruction.
