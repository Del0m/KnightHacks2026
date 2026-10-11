# Pitch video (Remotion)

Animated clips for the pitch deck and the Devpost video, written in React with [Remotion](https://www.remotion.dev/). Everything uses the deck's palette and Barlow fonts, and the architecture animation reads the same parts and arrows as the printed handout.

| Composition | Length | What it is | Used in |
|---|---|---|---|
| `ArchitectureFlow` | 25 s | Builds the architecture one part at a time, then lights up the amber cloud-pose path. Fades out at the end so it loops | Deck `how` slide (loops while presented); Devpost 1:45 beat |
| `ProblemStats` | 20 s | Beginners and injury-recovery stats, then "Both groups train alone." | Devpost 0:15 beat |
| `SponsorCards` | 15 s | One card per sponsor prize. Presage only shows with `includeUnbuilt: true` | Devpost 2:10 beat |
| `TitleCard`, `CloseCard` | 4 s, 5 s | Name and one-line promise; close adds the repo link and team names | Devpost close |
| `RoughCut` | 2:30 | The whole Devpost video, assembled from `src/data/script.json` with burned-in captions | Devpost |

Rendered copies of the first four are in [`out/`](out/).

## Run it

```sh
cd docs/pitch/video
npm install
npm run studio            # preview and scrub every composition in the browser
npm run render            # render everything to out/
npm run render -- ArchitectureFlow   # or just one
```

Renders need Chrome. Remotion downloads its own headless Chrome the first time; to use one you already have, set `BROWSER_EXECUTABLE=/path/to/chrome` before `npm run render`.

## Editing

- **Architecture:** `src/data/architecture.json` holds the parts, arrows, timings (seconds) and captions. Keep it in step with `../architecture-handout.html`.
- **Sponsors:** `src/data/sponsors.json`. Set `"built": true` on Presage once the SmartSpectra integration works.
- **Devpost script:** `src/data/script.json` sets each beat's time, clips and caption. Screen recordings go in `public/clips/<name>.mp4` (V numbers match the deck's video slots, plus `moderation.mp4`). Until a clip exists, the rough cut shows a slate with its name, so the timing can be checked before anything is filmed.
- **Fonts** are bundled in `public/fonts/` so renders work offline. Barlow is under the SIL Open Font License.

After changing `ArchitectureFlow`, re-render it and upload the new mp4 and a still frame to the deck's `how` slide.
