# Project rules

- Store documentation under `Markdown/`.
- Prioritize frontend work; the front-end developer owns the mobile UI.
- Use `Architecture.md` as the design reference. Its original `docs/Architecture.md` references resolve here.
- Keep changes within the current issue's area, with shared setup and documentation as needed.
- Keep repository authorship and collaborator settings under the team's control. Do not add automated co-author metadata.
- Use Expo Router in `apps/mobile/src/app/`, with feature components in `src/screens/`.
- Install native dependencies with `expo install` to match the project's SDK.
- Run lint and typecheck before finishing a mobile change.
- Generate native projects through Expo config and plugins; do not edit generated native files manually.

- Follow `Frontend-Rules.md` for frontend design; prioritize the white and light-blue Spotter direction.
- Do not create or use fully generative AI art; small logos are the only permitted exception.
