# Clip replay (INT-09)

Replays every clip in `apps/mobile/src/engine/__fixtures__/` through the set path and compares the result with a golden file per clip in `__golden__/`.

1. **Engine (AI-06).** The mobile form engine, imported from `apps/mobile`.
2. **Rules (AI-07).** The mobile form rules run on the engine's events, and each rep goes out with its flags. Where a clip lists `expected.flags`, the replay checks that exactly those flags reach the API.
3. **Set record (AI-08).** The phone's set recorder (`apps/mobile/src/engine/setRecord.ts`), fed every pose and engine event the way the phone feeds it. `toSetPayload` in `pipeline.ts` wires it up. The session's `inference_mode` is the clip's pose source.
4. **API.** The real Express app on PGlite with the real migrations and exercise specs: `POST /sessions`, `POST /sessions/:id/sets`, `POST /sessions/:id/finish`.
5. **Databricks upload.** The real uploader writes both files to a faked volume.

Databricks (token, scoring, file upload) and Hugging Face (rest notes) run their real clients with `fetch` faked. Any other outbound request fails the replay.

Each golden file pins:

- the engine's rep count, partials, set end and per-rep timing;
- the set payload sent;
- the set and finish responses, including score, rest note, medal and PRs;
- the stored `sessions`, `sets`, `reps`, `form_flags` and `medals` rows;
- the upload: metadata JSON, plus a summary and hash of the joints file.

Ids and wall-clock times are replaced so the files only change when behaviour does.

## Run it

From `apps/api`:

```bash
npm run test:replay          # just the replay
npm test                     # the whole API suite, replay included
```

The repo has no CI workflow yet, so nothing runs this automatically.

## After an intended change

```bash
npm run test:replay -- -u
```

This rewrites the golden files. Review `git diff test/replay/__golden__` before committing.

## Adding a recorded clip

Record a set with the PoseDebugScreen recorder and save the clip JSON to `apps/mobile/src/engine/__fixtures__/`. Fill in `expected` by hand: `reps`, `partials` and `set_end`. The replay checks those numbers on every run. Run `npm run test:replay -- -u` once to write the new clip's golden file.
