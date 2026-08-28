# Two-platform mobile implementation options

Research date: 2026-08-28

Wayfinder ticket: [#36](https://github.com/aeltoum/no-excuses/issues/36)

Parent map: [#34](https://github.com/aeltoum/no-excuses/issues/34)

## Question and standard

Which current implementation approaches can credibly serve iOS and Android for one developer while supporting:

- in-product photo and video capture for Proof photos and Proof videos;
- private, short-lived media handling;
- device push notifications;
- accessible interaction;
- verified web-to-app links for Group invitations and notification routes;
- HealthKit and Health Connect data for optional aggregate activity sources; and
- dependable Validation-pilot operation?

“Credible” here means that the approach has a maintained path to every required capability, permits platform-native escape hatches, and can be tested on both operating systems. It does **not** mean that every capability is supplied by the shared framework itself. Ratings below are planning judgments derived from the cited platform and framework contracts, not benchmark results.

## Executive findings

Five approaches are credible without a preliminary feasibility spike:

1. **Separate native iOS and Android applications** — highest platform certainty and lowest abstraction risk, but the largest duplicated UI and release workload.
2. **Kotlin Multiplatform shared logic with native SwiftUI and Jetpack Compose UIs** — preserves native interaction and shares domain/data code, but still requires two UIs.
3. **Kotlin Multiplatform with Compose Multiplatform UI** — a single Kotlin UI and shared logic with stable Android and iOS targets; platform integrations remain separate.
4. **React Native with an Expo development-build workflow** — a shared TypeScript/React UI, platform-backed components, strong first-party camera/notification/linking support, and an explicit Swift/Kotlin module escape hatch; HealthKit and Health Connect are the principal native-integration risk.
5. **Flutter** — a shared Dart UI with maintained camera, deep-link, accessibility, and testing support plus platform channels for health integrations; native-dialog and plugin testing need extra coverage.

Two more approaches are technically capable but conditional:

- **Ionic/Capacitor** now has official camera, push, deep-link, filesystem, and HealthKit/Health Connect plugins, but its web UI is not a native-control UI and the stock camera opens system camera UI rather than providing the controlled embedded capture experience implied by Workout sessions. Carry it forward only if a small device spike proves the capture, accessibility, media-lifecycle, and health-plugin contracts.
- **.NET MAUI** can target both platforms and has cross-platform accessibility and media-picker APIs, but the stock capture API opens system camera UI and health access still requires platform code or another dependency. Carry it forward only if the implementing developer already has strong C#/.NET mobile experience.

A browser-only PWA is not credible for this MVP because HealthKit and Health Connect are native platform APIs and the required camera, private-media lifecycle, notification, and app-link behavior must be dependable in installed iOS and Android applications.

No client choice erases platform work. Apple HealthKit requires an iOS capability, purpose strings, and per-type permission; Health Connect is Android-only, requires Google Play services, and is unavailable on some otherwise supported Android devices. Likewise, iOS Universal Links and Android App Links require separately hosted association files and platform configuration. The implementation plan therefore needs explicit platform adapters and device-level acceptance tests regardless of the shared framework.

## Irreducible platform baseline

The following work exists in every credible approach:

| Concern | iOS obligation | Android obligation | Consequence for the plan |
| --- | --- | --- | --- |
| Camera | AVFoundation supports front/rear capture, photo, video, microphone permission, and a live preview; Apple’s sample requires a physical device because Simulator has no camera ([Apple AVCam](https://developer.apple.com/documentation/avfoundation/avcam-building-a-camera-app)). | Google recommends CameraX for new apps; it supplies preview, image capture, and video capture while testing behavior across a range of devices ([CameraX overview](https://developer.android.com/media/camera/camerax)). | Treat camera as a device subsystem, not a generic file picker. Test interruption, rotation, permission denial, foreground/background transitions, and low storage on real devices. |
| Private local media | iOS app files live in an app container, and Data Protection can encrypt files with access tied to device lock state ([files and directories](https://developer.apple.com/documentation/technologyoverviews/files-and-directories), [file protection](https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files)). | Internal app-specific storage is inaccessible to other apps and encrypted on Android 10+; cache is appropriate for temporary sensitive data ([app-specific storage](https://developer.android.com/training/data-storage/app-specific)). | Store unselected candidates and pending uploads only in private app storage, never the gallery by default. Explicitly remove metadata, delete discarded candidates, and verify deletion after every terminal state. |
| Notifications | Remote notifications are delivered through APNs and require user authorization ([User Notifications](https://developer.apple.com/Documentation/usernotifications/), [permission](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)). | Android 13+ disables ordinary notifications until the user grants `POST_NOTIFICATIONS`; FCM is a common delivery layer ([notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission), [FCM Android](https://firebase.google.com/docs/cloud-messaging/android/get-started)). | Notification denial and later settings changes are normal states. Server scheduling, preferences, delivery receipts, and deep-link routing remain backend/application responsibilities. |
| Verified links | Universal Links require an app/site association and route HTTPS URLs into the app, with browser fallback ([Apple Universal Links](https://developer.apple.com/documentation/Xcode/allowing-apps-and-websites-to-link-to-your-content)). | App Links require an app manifest declaration and a hosted Digital Asset Links file; verified links reduce interception risk ([Android App Links](https://developer.android.com/training/app-links/about)). | Use HTTPS invitation URLs, not custom schemes alone. Test installed/not-installed, cold-start/warm-start, expired/revoked invitation, and wrong-account states. |
| Health data | HealthKit is the iOS/watchOS repository and grants access per data type with the person’s permission; the app target needs the HealthKit capability and purpose strings ([HealthKit](https://developer.apple.com/documentation/healthkit), [configuration](https://developer.apple.com/documentation/Xcode/configuring-healthkit-access)). | Health Connect is Android-only, needs Android 9+ and Google Play services, and is built into Android 14 while older supported versions use the Play-distributed app ([availability](https://developer.android.com/health-and-fitness/health-connect/availability), [setup](https://developer.android.com/health-and-fitness/health-connect/get-started)). | Define one app-owned aggregate-activity interface with distinct iOS and Android implementations. Permission denial, revocation, stale data, and unavailable service must leave the core Group experience usable and make the member ineligible for the relevant Crown rather than assigning zero. |

This baseline is also the privacy floor. A cross-platform camera returning a path or URI does not establish where the bytes are stored, whether metadata remains, whether a temporary copy was made, or whether the file is deleted. Those properties require explicit contracts and platform tests.

## Comparison

| Approach | Shared surface | Required capability path | Accessibility and interaction | Testing and operations | Maintenance / migration judgment |
| --- | --- | --- | --- | --- | --- |
| Separate native apps | Domain contracts and backend API only | Direct AVFoundation/CameraX, APNs/FCM, Universal Links/App Links, HealthKit/Health Connect | Strongest access to current platform controls and assistive-technology behavior | Best first-party tooling; two suites, two builds, two release tracks | **High ongoing workload; low abstraction risk.** Exiting has little framework migration cost, but later code sharing is a separate project. |
| KMP logic + native UI | Domain, data, sync, validation, and common tests | Direct platform APIs behind Kotlin interfaces or `expect`/`actual` implementations | Native SwiftUI and Compose UIs preserve platform behavior | Shared logic tests plus XCTest/XCUITest and Android instrumented/UI tests | **Medium-high workload; low-medium migration risk.** Sharing can increase incrementally without replacing native screens. |
| KMP + Compose Multiplatform UI | Domain, data, most UI, and common tests | Platform source sets for camera, push, links, and health | Shared semantics map to Android services and iOS accessibility objects; manual VoiceOver/TalkBack validation remains mandatory | Common tests plus platform-specific integration and UI tests; Kotlin/Gradle/AGP/Xcode version compatibility adds operational work | **Medium workload; medium ecosystem/toolchain risk.** Native hosts remain, but replacing shared UI later is a rewrite. |
| React Native + Expo development builds | Most UI, domain, data, and JS/TS tests | Expo camera/notifications/linking; local Swift/Kotlin module or maintained native library for health | React Native core components are platform-backed and expose cross-platform accessibility properties | Fast JS tests, but device E2E and native module tests are mandatory because JS component tests do not execute native backing code | **Low-medium workload; medium dependency/upgrade risk.** Business logic may be portable; exiting the RN UI requires a rewrite. |
| Flutter | Most UI, domain, and Dart tests | Maintained camera plugin; Firebase Messaging or direct platform setup; built-in deep links; platform channels/plugins for health | Flutter renders its own UI and supplies a semantics layer to assistive technologies, not native controls | Strong unit/widget tests; stock integration tests cannot interact with permission dialogs, notifications, or platform views, so native/device E2E is required | **Low-medium workload; medium plugin risk and medium-high exit cost.** Dart UI is not reusable in a native rewrite. |
| Ionic/Capacitor (conditional) | Web UI, domain, and web tests | Official camera, push, deep-link, filesystem, and health-fitness plugins; custom Swift/Java plugins when needed | Accessibility follows HTML/Ionic semantics inside a web-based UI; it is not the same interaction model as platform-backed native controls | Web tests are fast, but every plugin flow still needs installed-app device tests | **Potentially low initial workload; medium-high product-fit risk.** Web logic is portable, but native plugin and accessibility gaps can force custom code or UI replacement. |
| .NET MAUI (conditional) | C# domain and most UI | MediaPicker, platform configuration, push service/client work, and custom bindings for health | MAUI semantic properties map to underlying platform accessibility APIs | Shared tests plus platform/device tests; capture and health integration need special coverage | **Low-medium only for an experienced .NET developer; otherwise high ramp-up and medium-high exit cost.** |

### 1. Separate native iOS and Android applications

This is the control against which shared frameworks should be evaluated. It exposes AVFoundation, CameraX, HealthKit, Health Connect, notification, storage, and link APIs without a third abstraction or plugin release cycle. The two platform test stacks are mature: Xcode recommends a pyramid of Swift Testing/XCTest unit and integration tests with XCUITest UI tests ([Apple testing](https://developer.apple.com/documentation/xcode/testing)); Android instrumented tests run on devices and can use Espresso, UI Automator, or Compose testing APIs ([Android instrumented tests](https://developer.android.com/training/testing/instrumented-tests)).

The cost is duplication. A single developer owns two UI implementations, two navigation stacks, two lifecycle models, two accessibility passes, and two releases. Shared backend contracts do not prevent user-visible drift. This is still credible for a controlled pilot, but only if the plan deliberately limits platform surface area and budgets parity work on every feature.

**Best fit:** maximum platform confidence, or a developer already fluent in both ecosystems.

**Material limit:** highest calendar and regression burden for one developer.

### 2. Kotlin Multiplatform with native UIs

Google officially supports Kotlin Multiplatform for sharing business logic between Android and iOS and calls it stable and production-ready. Teams can choose how much to share rather than adopting an all-or-nothing architecture ([Android KMP guidance](https://developer.android.com/kotlin/multiplatform)). Kotlin provides common interfaces and `expect`/`actual` declarations for platform-specific implementations, including direct access to iOS APIs from Kotlin/Native ([platform-specific APIs](https://kotlinlang.org/docs/multiplatform/multiplatform-connect-to-apis.html)).

For No Excuses, common code could own the accountability state machine, upload queue policy, report validation, activity normalization, notification preference rules, and API client. SwiftUI and Jetpack Compose would own platform navigation, camera presentation, permission education, accessibility behavior, HealthKit/Health Connect calls, and app-link entry points.

KMP supports common and platform-specific tests; the latter remain essential for platform logic ([KMP testing](https://kotlinlang.org/docs/multiplatform/multiplatform-run-tests.html)). This makes the boundary explicit and offers an incremental migration path, but it does not meet a “one UI implementation” goal.

**Best fit:** platform-native interaction with meaningful logic reuse.

**Material limit:** still two UIs and two platform test suites; the iOS host and Kotlin framework build must stay integrated.

### 3. Kotlin Multiplatform with Compose Multiplatform UI

Compose Multiplatform makes Compose UI APIs available from common Kotlin for Android and iOS ([relationship to Jetpack Compose](https://kotlinlang.org/docs/multiplatform/compose-multiplatform-and-jetpack-compose.html)). Both core KMP and Compose Multiplatform UI are classified Stable on Android and iOS ([supported-platform stability](https://kotlinlang.org/docs/multiplatform/supported-platforms.html)). Current Compose Multiplatform supports iOS 14+ and has its own compatibility matrix across Kotlin, Gradle, Android Gradle Plugin, and Xcode ([compatibility](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html)).

Its iOS semantics are mapped to native accessibility objects used by VoiceOver and XCTest. The official documentation also identifies a current limitation: Material 3 does not supply automatic high-contrast color schemes, so the app must design and test them ([iOS accessibility](https://kotlinlang.org/docs/multiplatform/compose-ios-accessibility.html)). Camera, push, links, private file handling, and health access still live in platform source sets or multiplatform libraries.

This option reduces UI duplication more than KMP with native UIs, but puts more of the product into a newer iOS UI ecosystem and a multi-toolchain compatibility envelope. That is an operational consideration, not a feasibility blocker.

**Best fit:** a Kotlin/Compose-skilled developer who wants maximum sharing and accepts platform adapters.

**Material limit:** compatibility upgrades and platform integration debugging cross Kotlin, Gradle, Android Studio, Xcode, and native APIs.

### 4. React Native with Expo development builds

React Native core components are backed by Android and iOS views, and the framework exposes accessibility properties for VoiceOver and TalkBack ([native components](https://reactnative.dev/docs/intro-react-native-components), [accessibility](https://reactnative.dev/docs/accessibility)). React Native’s New Architecture has been enabled by default since 0.76 and supplies modern native-module and component systems ([New Architecture](https://reactnative.dev/architecture/landing-page)).

Expo fills several concrete gaps:

- `expo-camera` supplies an embedded preview, photo capture, and video recording, saving captures to app cache ([Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/)).
- `expo-notifications` can obtain native APNs/FCM tokens or an Expo push token and receive/respond to notifications ([Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)).
- Expo supports Universal Links and App Links and recommends a development build for realistic link testing ([Expo linking](https://docs.expo.dev/linking/overview/)).
- A development build permits arbitrary native libraries and native configuration, unlike Expo Go ([development builds](https://docs.expo.dev/develop/development-builds/introduction/)).
- The Expo Modules API supports local Swift and Kotlin modules when a required platform feature has no suitable library ([Expo Modules API](https://docs.expo.dev/modules/overview/)).

HealthKit and Health Connect are therefore feasible but must be treated as a native boundary. Before selection, the implementation plan should either validate a maintained library against the exact step-aggregate and permission requirements or budget a small local Expo module with one Swift and one Kotlin implementation.

React Native’s own testing guide warns that JavaScript component tests do not execute the native iOS/Android backing code and cannot catch native defects. Vital flows need release-build device E2E coverage ([React Native testing](https://reactnative.dev/docs/testing-overview)). That warning is especially important for camera, permission, health, notification, and link flows.

**Best fit:** a TypeScript/React-skilled solo developer who values rapid shared-UI delivery and is willing to own a narrow native health adapter.

**Material limit:** native-library compatibility and framework/Expo upgrade cadence; JS tests alone are insufficient.

### 5. Flutter

Flutter provides one natively compiled multi-platform codebase and explicit platform integration paths ([platform integration](https://docs.flutter.dev/platform-integration)). Its maintained `camera` plugin supports previews plus photo and video capture, with a CameraX-backed Android implementation intended to handle device quirks ([Flutter camera](https://docs.flutter.dev/cookbook/plugins/picture-using-camera)). Flutter supports deep links on iOS and Android ([deep linking](https://docs.flutter.dev/ui/navigation/deep-linking)), and Firebase documents a Flutter FCM client path including the required iOS APNs capability setup ([FCM for Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/get-started)).

Flutter has first-class accessibility support and a Semantics widget consumed by assistive technologies ([accessibility](https://docs.flutter.dev/ui/accessibility), [Semantics API](https://api.flutter.dev/flutter/widgets/Semantics-class.html)). It does not use platform-native controls for its main UI, so VoiceOver/TalkBack, text scaling, switch control, motion, contrast, and focus order still require explicit device acceptance tests.

HealthKit and Health Connect require a plugin or custom Swift/Kotlin implementations connected through platform channels; Flutter documents both the channel mechanism and type-safe Pigeon option ([platform channels](https://docs.flutter.dev/platform-integration/platform-channels)). Flutter’s unit/widget/integration stack is strong, but the stock `integration_test` package cannot interact with native permission dialogs, notifications, or platform views. The framework explicitly recommends native-capable alternatives or native UI tests for those cases ([Flutter testing](https://docs.flutter.dev/testing/overview), [plugin testing](https://docs.flutter.dev/testing/testing-plugins)).

**Best fit:** a Dart/Flutter-skilled developer who wants one UI codebase and accepts plugin/platform-channel ownership.

**Material limit:** device-native integrations and dialogs need a second testing layer; leaving Flutter entails rewriting the UI.

### 6. Ionic/Capacitor — conditional

Capacitor is a web-first native runtime: HTML/CSS/JavaScript UI runs in native iOS and Android containers, while plugins expose native SDKs and custom Swift/Java plugins provide escape hatches ([Capacitor overview](https://capacitorjs.com/docs)). Ionic adds a mobile-oriented web component library rather than changing that architecture ([Ionic overview](https://ionicframework.com/docs)).

The current official plugin surface is broader than older hybrid-app comparisons imply:

- Camera can take photos and record videos, but the documented implementation opens device camera UI and on Android launches a separate Activity, creating lifecycle-recovery obligations ([Capacitor Camera](https://capacitorjs.com/docs/apis/camera)).
- Push notifications and deep links have official plugin/guidance paths ([push](https://capacitorjs.com/docs/apis/push-notifications), [deep links](https://capacitorjs.com/docs/guides/deep-links)).
- The official health-fitness plugin accesses HealthKit and Health Connect, including steps, but exposes notable platform asymmetries and configuration hazards: workout queries are iOS-only, some writes differ, Android permissions are inserted at sync time, and missing generated notification strings can crash startup ([health-fitness](https://capacitorjs.com/docs/apis/health-fitness)).

The web UI could reuse skills and concepts from the approved HTML prototype, but accessible HTML inside a mobile container is not equivalent to native-control interaction. More importantly, the stock camera contract does not by itself establish the controlled embedded Workout-session capture experience, temporary candidate isolation, metadata removal, and deterministic deletion required by the domain model.

**Best fit:** an experienced accessible-web/Ionic developer after a device spike proves camera and health behavior.

**Material limit:** higher product-fit and device-E2E risk around web UI, camera lifecycle, and plugin-specific health behavior.

### 7. .NET MAUI — conditional

.NET MAUI targets iOS and Android with a cross-platform C# UI toolkit ([MAUI overview](https://learn.microsoft.com/en-us/dotnet/maui/)). Its semantic properties map onto underlying platform accessibility APIs, and Microsoft still requires platform-by-platform accessibility testing ([MAUI accessibility](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/accessibility)).

The stock MediaPicker can capture photos and videos, but it opens platform camera UI rather than supplying a product-owned embedded preview. Android can destroy and recreate the app during that flow, so MAUI exposes Android-specific recovery APIs ([MAUI MediaPicker](https://learn.microsoft.com/en-us/dotnet/maui/platform-integration/device-media/picker)). Microsoft’s push sample uses a backend and Azure Notification Hubs to fan out to platform push services, illustrating that push is an additional integration rather than a complete MAUI client primitive ([MAUI push sample](https://learn.microsoft.com/en-us/samples/dotnet/maui-samples/webservices-pushnotifications/)). HealthKit and Health Connect likewise need platform-specific code or another maintained package.

**Best fit:** a developer already productive in modern C#/.NET mobile development.

**Material limit:** without that experience, ramp-up plus custom camera/health work removes much of the one-developer advantage.

## Testing implications common to every option

The Validation pilot needs a framework-independent acceptance matrix. At minimum, each supported OS version and representative physical device should cover:

1. **Camera and lifecycle:** first launch, denied permission, later grant, front/rear selection, repeated candidate capture, photo and video, interruption by call/lock/background, process death, rotation, low storage, and automatic 12-hour Workout-session ending.
2. **Private media:** no gallery copy by default; no location/hidden metadata reaches the Group; unselected candidates disappear; selected Proof media survives only as long as required; deletion occurs after withdrawal, Unsupported/Rejected outcomes, verification retention, leaving/removal, and failed or cancelled upload.
3. **Upload resilience:** offline capture, retry after restart, idempotent submission, progress accessibility, expired upload authorization, and server-confirmed deletion.
4. **Accessibility:** VoiceOver and TalkBack traversal; large text/display scaling; focus after navigation, errors, permission returns, and deep links; keyboard/switch access; reduced motion; contrast; captions/transcript path for meaningful Proof-video audio; and Technical-pause recovery.
5. **Notifications:** permission undecided/granted/denied, settings changed later, token rotation, bundling/rate rules, locale/time-zone boundaries, foreground/background/terminated delivery, and link routing to authorized content only.
6. **Links:** installed and uninstalled behavior, cold/warm start, expired/revoked/used invitation, wrong signed-in person, already-in-a-Group, Group full, and offline retry.
7. **Health:** unavailable service, denied and partial permissions, revoked access, stale/late data, duplicate samples, daylight-saving and accountability-week boundaries, multiple data origins, device change, and no-data Crown ineligibility.

Shared unit tests should own domain state transitions and normalization. They cannot replace platform tests for permissions, camera, storage, assistive technologies, push, links, and health stores.

## Migration and lock-in assessment

These are architectural inferences from where each approach places source code:

- **Lowest exit cost:** separate native apps. There is no cross-platform UI runtime to remove.
- **Best incremental sharing/reversal:** KMP with native UIs. Shared logic can be introduced or reduced without replacing both UIs at once.
- **Moderate exit cost:** React Native. TypeScript domain logic may survive, and custom Swift/Kotlin modules can be reused, but screens and navigation must be rewritten.
- **Moderate-to-high exit cost:** Compose Multiplatform shared UI, Flutter, and MAUI. Their shared UI layers are framework/language-specific even though the native hosts and some integration code can remain.
- **Split profile:** Capacitor. Web domain/UI code is portable to a browser product, but replacing the web-container interaction model with native UI is a screen rewrite and plugin contracts must be replaced.

The more important pilot risk is not theoretical future migration; it is letting a community plugin own a privacy-, accessibility-, or correctness-critical contract without an app-owned adapter and device tests. Camera, health, notifications, and links should therefore sit behind narrow internal interfaces in every shared approach.

## Worldwide-pilot implications

None of the credible clients requires a country exclusion by itself. However, “worldwide participation” cannot mean universal availability of every optional device integration:

- HealthKit is an Apple-platform service.
- Health Connect requires Android 9+ and Google Play services and is not available in work profiles ([Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)).
- Notification delivery depends on APNs or an Android push provider and on device/user settings.
- App distribution, vendor regional availability, data transfer, and backend media residency are separate service-selection questions.

The client contract should therefore degrade safely: a member without a supported aggregate activity source can still use the core Group accountability experience but is ineligible for the affected Crown category, matching the existing domain model. This research identifies no evidence-based reason to make the entire pilot US-only or to exclude a country solely because of the mobile framework.

## Result for the planning map

Carry forward four decision lanes:

1. **React Native + Expo development builds**, contingent on a verified HealthKit/Health Connect adapter plan.
2. **Flutter**, contingent on a verified health plugin/platform-channel plan and native-dialog E2E approach.
3. **Kotlin Multiplatform**, explicitly deciding between native UIs and Compose Multiplatform UI.
4. **Separate native apps** as the maximum-certainty baseline against which one-developer cost is measured.

Keep **Ionic/Capacitor** as a conditional spike candidate only if the implementer has a strong accessible-web advantage; the spike must prove embedded Workout-session capture, private temporary media, VoiceOver/TalkBack behavior, process-death recovery, and the exact step-query contract. Keep **.NET MAUI** only if the developer’s existing .NET proficiency is materially stronger than their TypeScript, Dart, Kotlin, and Swift experience.

Do not choose among the four lanes from framework marketing or nominal code sharing. The next decision should score them using the actual developer’s proficiency and a thin vertical proof on physical iOS and Android devices: start a Workout session, capture and discard candidates, retain exactly one Activity photo and one Member-presence photo privately, upload, receive a push, open a verified link, read a permitted step aggregate, revoke permission, and complete the flow with VoiceOver/TalkBack. That evidence will expose the dominant implementation and testing cost without adding production architecture.
