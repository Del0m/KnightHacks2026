# Standalone iPhone access

The installed Debug development client loads JavaScript from Metro on the Mac. A cable is not inherently required, but access to that development server is. Use a Release build for a phone that must open away from the Mac.

The screenshot’s labelling import points to the correct shared module. Main added `ml/labelling` and its Metro watch folder while the existing Metro process was running. Restarting Metro clears the stale configuration; a fresh iOS export successfully resolves the module. Changing the relative import would break the correct path.

## Local installation

From `apps/mobile`, generate/update native dependencies through the existing Expo workflow, then build the Xcode workspace with configuration **Release**, the connected iPhone destination and the existing development signing team. Release runs Expo’s embed export and stores `main.jsbundle` inside the application; Debug skips that bundle. Do not launch a Release app with a Metro development-client URL.

Keep the current bundle identifier to preserve the installed app’s local workout data and account storage. Verify the signed application includes `main.jsbundle` and native pose models, then install it using Xcode or `xcrun devicectl device install app`. Stop Metro and launch by bundle identifier to verify it does not request development code from the Mac. The physical acceptance check is opening Train and camera practice with the cable disconnected and mobile data enabled, then repeating with airplane mode.

For cloud builds, the existing `preview` EAS profile is an internal distribution build without `developmentClient`; `development` intentionally requires Metro. Signing/distribution eligibility must be configured for the owner’s Apple account. Release configuration alone does not change the signing profile’s expiration.

## Online services

Feed, authentication and account sync require reachable HTTPS services. `EXPO_PUBLIC_API_URL` is embedded at build time; changing `.env.local` after installing Release does not change that installed build. The current testing URL is a temporary Cloudflare tunnel to the Mac, so it still stops working when the Mac or tunnel stops. Permanent deployment is tracked in BE-14 (#25). Configure the API on the team’s chosen host, migrate the existing Neon schema, check `/health`, set the permanent HTTPS URL in the private mobile environment, then rebuild/install. Database credentials and moderation tokens belong only in the hosted API’s secret configuration, never in the mobile bundle.

References: [Expo local release builds](https://docs.expo.dev/guides/local-app-production/) and [Expo local build options](https://docs.expo.dev/build-reference/local-builds/).

## October 11 verification

Fresh iOS export and signed Release build passed. The app package contains a 13,236,506-byte `main.jsbundle` and two compiled Core ML model directories. Private server environment values were absent from the embedded JavaScript. The existing Personal Team provisioning profile expires October 17, 2026 at 19:36:34 UTC. An installation attempt returned CoreDevice 4016 because the phone was unavailable; installation and launch with Metro stopped await reconnection. A permanent API host and longer-lived signing/distribution remain necessary for enduring access away from the Mac.
