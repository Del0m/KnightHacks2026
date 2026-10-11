# Standalone iPhone access

The installed Debug development client loads JavaScript from Metro on the Mac. A cable is not inherently required, but access to that development server is. Use a Release build for a phone that must open away from the Mac.

The screenshot’s labelling import points to the correct shared module. Main added `ml/labelling` and its Metro watch folder while the existing Metro process was running. Restarting Metro clears the stale configuration; a fresh iOS export successfully resolves the module. Changing the relative import would break the correct path.

## Local installation

From `apps/mobile`, generate/update native dependencies through the existing Expo workflow, then build the Xcode workspace with configuration **Release**, the connected iPhone destination and the existing development signing team. Release runs Expo’s embed export and stores `main.jsbundle` inside the application; Debug skips that bundle. Do not launch a Release app with a Metro development-client URL.

Keep the current bundle identifier to preserve the installed app’s local workout data and account storage. Verify the signed application includes `main.jsbundle` and native pose models, then install it using Xcode or `xcrun devicectl device install app`. Stop Metro and launch by bundle identifier to verify it does not request development code from the Mac. The physical acceptance check is opening Train and camera practice with the cable disconnected and mobile data enabled, then repeating with airplane mode.

For cloud builds, the existing `preview` EAS profile is an internal distribution build without `developmentClient`; `development` intentionally requires Metro. Signing/distribution eligibility must be configured for the owner’s Apple account. Release configuration alone does not change the signing profile’s expiration.

## Online services

Feed, authentication and account sync require reachable HTTPS services. `EXPO_PUBLIC_API_URL` is embedded at build time; changing `.env.local` after installing Release does not change that installed build. The permanent API is now https://knighthacks2026.onrender.com. The private mobile environment and public environment example use this address; the signed Release bundle was checked for the Render URL. `/health` confirms the hosted API connects to Neon and has live language-model, moderation and embedding integrations. Databricks export, server set scoring and cloud pose are disabled on this deployment; native camera inference and local feedback remain available. A sleeping hosted instance can require extra time for its first request. Database credentials and moderation tokens belong only in the hosted API’s secret configuration, never in the mobile bundle.

References: [Expo local release builds](https://docs.expo.dev/guides/local-app-production/) and [Expo local build options](https://docs.expo.dev/build-reference/local-builds/).

## October 11 verification

The updated signed Release build passed and was installed on the paired iPhone, retaining its bundle identifier and local data. The package contains a 13,284,468-byte `main.jsbundle`, the permanent Render URL and two compiled Core ML model directories. Private server environment values were absent from the bundle. No Metro server is listening on 8082. Direct launch was attempted without a development-server URL, but iOS denied it because the phone was locked; opening SteadyForum on the unlocked phone and verifying cellular access remain physical acceptance checks.

The existing Personal Team provisioning profile expires October 17, 2026 at 19:36:34 UTC. The API no longer depends on this Mac. The development signature still needs renewal when it expires; TestFlight or another longer-lived distribution setup is required for ongoing access without reinstalling from the Mac.
