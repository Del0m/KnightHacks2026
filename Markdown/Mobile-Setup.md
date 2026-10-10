# Spotter mobile · FE-01

The app lives in `apps/mobile/`. The scaffold follows `Architecture.md` §§3, 7, 12–16: quiet coaching, personal progress, opt-in sharing, and a community for beginners.

## Install tooling on macOS

With Homebrew installed:

```sh
brew install node@24
npm install --global --prefix /opt/homebrew pnpm@11.25.0
```

On Apple Silicon, ensure `/opt/homebrew/opt/node@24/bin` and `/opt/homebrew/bin` are in your terminal PATH. Open a new terminal after updating shell configuration, then verify with `node --version` and `pnpm --version`.

The front-end development Mac has Node 24.21.0 and pnpm 11.25.0 installed. Its shell configuration was backed up to `~/.zprofile.before-spotter` before adding the PATH entry.

## Run

Use Node 22.13+ and pnpm 11.25.0. From the repository root:

```sh
cd apps/mobile
pnpm install --frozen-lockfile
pnpm web
```

For an installed native development build, run `pnpm start`. This starts Metro for the development client. Expo Go cannot run the planned Vision Camera frame-processor plugin.

## iPhone development build

The project includes `expo-dev-client`, the `spotter` URL scheme, and EAS development profiles. The current bundle identifier is `com.del0m.spotter`; change it in `app.json` if the team uses another identifier.

For a cloud build, sign into the team's Expo account and register the test iPhone. EAS ad hoc distribution requires an Apple Developer Program membership:

```sh
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest device:create
pnpm build:ios:development
pnpm start
```

`eas init` links the app to the team's project and adds its project ID to `app.json`. Include the registered phone when prompted during the build. Install from the resulting EAS link on that phone, enable Developer Mode if prompted, then open Spotter and connect to Metro on the same network. If LAN access is blocked, use `pnpm start --tunnel`.

Alternatively, with the matching Xcode installed and signing configured:

```sh
pnpm ios:device
```

The `development-simulator` EAS profile supports iOS simulator builds. A simulator build does not satisfy the physical iPhone acceptance criterion.

## Structure and design

- `src/app/_layout.tsx`: root stack, navigation theme, status bar.
- `src/app/(tabs)/`: Train (`/`), Plan, Feed, Buddies, Me.
- `src/screens/`: Train, Planner, Feed, Buddies, Progress; each route forwards to its feature screen.
- `src/components/AppPage.tsx`: shared app layout, typography, and actions.
- `src/components/BodyPreview.web.tsx`: locally hosted rigged model integration; native uses a text fallback.
- `src/theme/tokens.ts`: shared white/light-blue colors and firm Barlow typography.
- `src/state/Training.tsx`: local profile/preferences and manually completed workouts.

The approved UI has a cropped exercise preview, streak, compact agenda rows, glass controls, and an animated five-tab selection highlight. See `Web-Redesign.md` for the implementation and verification record and `Model-Preview.md` for asset provenance. The sample routine is identified as a sample; streaks use completed manual sessions.

Camera, pose inference, authentication, backend sync, social posting, and buddy matching remain separate integrations. The Vision Camera plugin is not included in FE-01; its owner must check compatibility before adding it and rebuild the native client afterward. No backend credentials belong in the mobile app.

## Validation

```sh
pnpm lint
pnpm typecheck
pnpm exec expo install --check
pnpm dlx expo-doctor
pnpm exec expo export --platform all
```

Local verification: Expo Doctor passed all 21 checks; lint and strict TypeScript passed; iOS, Android, and static web bundles exported; iOS native generation passed with `expo prebuild --platform ios --no-install`; all five tabs were exercised in the web preview.

Still required for issue #26: install a signed development build on a teammate's iPhone, open all five tabs, and record the phone/iOS version and result here. This machine has no Xcode and no team Expo/Apple credentials have been configured, so physical-device acceptance remains unverified.

## References

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo Router tabs](https://docs.expo.dev/router/advanced/tabs/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [EAS internal distribution](https://docs.expo.dev/build/internal-distribution/)
- [FE-01 issue #26](https://github.com/Del0m/KnightHacks2026/issues/26)
