# Native accessibility and local E2E evidence

Scope: issue #150, PR #151. Environment: local Docker-backed Supabase after a full
database reset; Expo development clients built from the PR working tree on 2026-09-11.

## Automated and source evidence

- `tests/mobile-accessibility-layout.test.ts` covers keyboard-aware form surfaces,
  deterministic focus and announcements, target sizing, responsive Home layout, and native
  Metro resolution of the source-exported contracts package.
- `pnpm check` and `git diff --check` are required before handoff.

## Native development-build smoke

- iOS: iPhone 17 Pro simulator, iOS 26.5, portrait, host loopback network. Native build,
  install, Metro bundle, and launch passed. Accessibility inspection exposed `SIGN IN`, the
  invitation-email instruction, and `Continue to sign in`. Screenshot:
  `evidence/runtime/native-accessibility-e2e/ios-iphone17pro-signin-ready.png`.
- Android: Pixel 10 Pro XL AVD, Android 17/API 37, portrait, ADB-reversed host
  loopback network. Native Gradle build, APK install, Metro bundle, and launch passed.
  UIAutomator exposed `SIGN IN`, the invitation-email instruction, and the named
  `Continue to sign in` control. Filtered React Native, Expo, and Android fatal logs were
  empty. Screenshot:
  `evidence/runtime/native-accessibility-e2e/android-pixel10proxl-signin.png`.

The smoke exposed and fixed a native-only Metro failure: the source-exported contracts
entrypoint referenced `.js` siblings that do not exist in the source tree. Explicit `.ts`
specifier support and a regression assertion now keep native resolution testable.

## Open gates

- Authenticated Group, Home, and You journeys were not completed. Android automation was
  interrupted by the emulator keyboard's first-run Google Translate consent prompt after
  submitting a local-only test identity.
- Simulators do not satisfy the physical-device gate. VoiceOver and TalkBack, approximately
  200-percent text, reduced motion, alternative input, portrait/landscape, device/OS, and
  network-profile records remain required on one current-major physical iOS device and one
  current-major physical Android device.

Issue #150 and PR #151 therefore remain open and draft.
