# FE-01 physical iPhone development-build check

Status: pending. PR #77 merged and issue #26 closed automatically, but no physical-iPhone build has been verified.

## Build route

The user has no paid Apple Developer membership. Use a local Xcode build with a free Apple ID; EAS internal/ad hoc iPhone distribution requires paid membership. Expo account sign-in is not required for the local build route.

This Mac was checked on 2026-10-10: macOS 15.1.1, Command Line Tools selected, no full Xcode installation. Expo SDK 57 documents Xcode 26.4+; Apple lists macOS Tahoe 26.2+ for Xcode 26.4.1. Update this Mac to a compatible macOS/Xcode combination or use a teammate's compatible Mac. Accept Apple agreements and sign into Xcode personally.

Rechecked after the user's update on 2026-10-10: macOS 27.0.1 (26A434). Full Xcode is still absent and Command Line Tools remain selected. Started the official Xcode Get flow in the App Store; it has reached the account confirmation sheet, so installation is not yet verified. The USB registry currently lists no connected iPhone. Connect the phone with a data-capable cable and unlock it before the device check.

The user downloaded `Xcode_27.1_Release_Candidate.xip` from Apple. Extracted it successfully, verified the expanded app with `codesign --verify --deep --strict` outside the sandbox (exit 0), and moved it to `/Applications/Xcode.app`. Opened Xcode; first-run setup is currently waiting for the user to review and accept the Xcode and Apple SDKs Agreement. Toolchain selection, platform components, signing, and the physical-device build remain pending. The latest USB check still showed the hub but no iPhone.

After the user completed first-run setup, verified Xcode 27.1 (27A9275) and the iOS 27.1 SDK. Installed CocoaPods 1.17.0 and completed native dependency installation successfully (107 pods). Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for CLI builds while the global selection remains Command Line Tools. Xcode Apple Account sign-in is pending; opened its sign-in screen for the user. `devicectl` has not detected a physical iPhone. An unsigned generic-iPhone compilation check is in progress; it is not an installed or signed development build.

Verified Apple Account sign-in and availability of the user's Personal Team. The generic iOS Debug build completed with exit 0 and `BUILD SUCCEEDED`, using `CODE_SIGNING_ALLOWED=NO`; output is `apps/mobile/ios/build/DeviceBuild/Build/Products/Debug-iphoneos/Spotter.app`. This proves compilation only. Installation is blocked on the USB connection: macOS detects the hub but not the iPhone, and `devicectl` lists only a simulated device. Requested a direct connection with a different data-capable cable. Registering the physical phone, signing, installing, launching, and verifying tabs remain pending.

## Once Xcode is ready

1. Open Xcode and finish its first-run component setup. Select its command-line toolchain.
2. Add the Apple ID in Xcode Settings > Accounts; use its Personal Team for free development signing. Never put Apple credentials in chat or the repo.
3. Connect and unlock the iPhone with a USB cable, trust the Mac, and enable Developer Mode when prompted.
4. From `apps/mobile`, run `pnpm ios:device` and select the connected iPhone. Resolve bundle-identifier/signing errors against the user's team if needed.
5. Launch Spotter, connect to Metro on the same network, and verify Train, Plan, Feed, Buddies, and Me plus the shared theme.

The interactive 3D preview remains web-only; native has a textual muscle-target fallback. This check verifies the development-client app shell and navigation.

## Record after verification

- iPhone model:
- iOS version:
- Xcode/macOS versions:
- Development client installed and opens:
- All five tabs work:
- Shared colors/type render:
- Tester and result:

Do not mark the physical-device criterion complete until the installed build has been observed on the phone.

## Sources

- https://docs.expo.dev/develop/development-builds/introduction/
- https://docs.expo.dev/versions/latest/
- https://developer.apple.com/xcode/system-requirements/
