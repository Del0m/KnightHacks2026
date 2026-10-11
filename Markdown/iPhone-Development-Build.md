# Physical iPhone development build

October 10, 2026: connected an iPhone 14 Pro running iOS 26.1. The owner enabled Developer Mode, approved creation of the Apple development signing certificate and provisioning profile, and trusted the profile on the phone.

Regenerated the ignored native iOS project from the existing Expo configuration. The stale project targeted iOS 16.4; the configured target and pose module require iOS 17. Exported and verified both 320/256 Core ML pose models with the repository's pinned `ml/pose_export/export.py` workflow, then installed CocoaPods dependencies. These generated artifacts remain ignored.

The Personal Team could not register the repository's default bundle identifier, so the local signed build used a unique development identifier through Xcode build-setting overrides. No production bundle identifier was changed. Xcode's signed Debug build succeeded, device installation succeeded, and launch succeeded after the owner trusted the profile. Verified the signature, device provisioning, matching app identifier, camera usage description and both compiled pose models.

Physical startup exposed two defects that automated exports had missed:

- Train constructed `Intl.PluralRules`, which is unavailable in this phone's native JavaScript engine. Replaced it with the existing English ordinal-label helper using arithmetic suffix selection. A regression test reproduces module loading without that constructor.
- Shared page containers rendered Expo Head on native, which requires a configured Apple Handoff origin. Browser page titles now render only on web in AppPage, SetupPage and FeatureScreen. The native setup regression test rejects accidental Head rendering.

Verification after these fixes: 33 mobile suites / 315 tests pass, typecheck passes, lint has zero errors and seven existing test-import warnings, and the 18-route web export passes. Train, onboarding and camera setup retain their web page titles. The phone was relaunched with the fixes through Metro.

The owner confirmed that Train loads and Begin Workout → placement guide → Check my framing → Allow camera opens a live preview on the physical iPhone. All-17-joint framing readiness, side-on confidence, background/resume, native glass, VoiceOver and Dynamic Type still require verification. Xcode 27's Device Hub cannot screen-share this iOS 26 phone, so installation and launch were verified with Apple's device tools and startup/camera results were supplied by the owner. Authenticated saving on the phone remains unverified; the current local API URL targets the Mac's localhost and needs a device-reachable API address for that check.

These runtime fixes are committed locally. No signing credentials, provisioning profiles, native build artifacts, model weights or environment files are included in the commit.
