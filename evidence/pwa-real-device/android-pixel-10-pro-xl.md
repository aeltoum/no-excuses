# Android physical-device evidence — Pixel 10 Pro XL

Candidate: base commit `0cf6461` on `codex/pwa-integrated-acceptance`, plus current working-tree favicon repair in `apps/web/index.html`. User-flow checks ran on the base commit; clean post-repair CDP diagnostics ran on the working-tree candidate.

Date/tester: 2026-09-14, user-assisted physical-device run

Device: Google Pixel 10 Pro XL; physical device serial withheld and recorded only as `android-pixel-10-pro-xl`

OS/browser: Android 17; Chrome 152.0.7977.83

Support floor: pass; Chrome 152 exceeds Chrome/Android 111 minimum in ADR 0005.

Network/origin: USB connection with ADB reverse for ports 4174, 8787, and 54321; `http://127.0.0.1:4174`. Chrome installed the PWA from this device-local origin. This is local validation, not hosted HTTPS evidence.

Artifacts: [browser-ready](android-pixel-10-pro-xl/browser-ready.png), [Group created](android-pixel-10-pro-xl/group-created.png), [standalone History](android-pixel-10-pro-xl/standalone-history.png), [200% text](android-pixel-10-pro-xl/text-200-percent.png), [target after keyboard](android-pixel-10-pro-xl/target-keyboard-result.png), [workout saved](android-pixel-10-pro-xl/home-workout.png). Screenshots containing personal notifications were excluded. Included screenshots contain no email, invitation token, or OTP code.

| Check | Result | Observation and artifact |
| --- | --- | --- |
| Browser open, routes, refresh, viewport/safe-area fit | pass | Home, Group, Target, History, and Account checked without clipping. Browser entry shown in [browser-ready](android-pixel-10-pro-xl/browser-ready.png). |
| Install, home-screen launch, standalone mode | pass | Installed from Chrome. Standalone process used `com.android.chrome/...SameTaskWebApkActivity`; no browser chrome in [standalone History](android-pixel-10-pro-xl/standalone-history.png). |
| Real OTP, consent, authenticated Group entry | pass | Six-digit code retrieved from local Mailpit; 18+, pilot, and product consent accepted; Group created with weekly target 2. [Group created](android-pixel-10-pro-xl/group-created.png). |
| Close/relaunch session restoration and sign-out cutoff | pass | Standalone relaunch restored authenticated History. After sign-out, reopen remained signed out. Sign-out screenshot omitted because device notifications exposed personal information. |
| Weekly target, check-in, progress, history | pass with boundary | Keyboard entry, scroll, and save changed target to 3; PostgreSQL verified 3. Initial one-member workout returned generic `Action denied`; issue #165 records this UX defect. After a synthetic invited peer joined, membership was active with 2 members; workout saved and authoritative count became 1. [Target result](android-pixel-10-pro-xl/target-keyboard-result.png), [workout saved](android-pixel-10-pro-xl/home-workout.png). Naturally elapsed finalized history was not run. |
| Keyboard and safe area | pass | Target field and action remained reachable; entered and saved target 3. |
| 200% text | pass | Android `font_scale=2.0`; user inspected Home, Target, History, and Account. No horizontal movement or clipped controls observed. [200% text](android-pixel-10-pro-xl/text-200-percent.png). |
| Reduced motion | pass | Animator duration, transition animation, and window animation scales set to 0. User observed about one second of loading, with no motion-dependent action. Values restored to 1 afterward. |
| TalkBack | pass | TalkBack service enabled; user reported labels and interaction looked good. Evidence screenshot excluded because notification shade contained personal information. Accessibility service restored to disabled afterward. |
| Alternative input | pass | ADB `KEYCODE_TAB` focus reached Home, Group, Target, History, Account, and page content. |
| Console/network/runtime diagnostics | pass | Initial direct CDP reload found two console errors tied to HTTP `404 /favicon.ico`. After declaring the existing SVG favicon, direct CDP reloaded the current Chrome browser-tab target at `http://127.0.0.1:4174/`: title `No Excuses`, heading `Sign in required`, `displayModeStandalone=false`, and zero page errors, console errors, request failures, or relevant local HTTP responses at status 400 or higher. Browser-tab CDP diagnostics are separate from standalone proof. |
| Cleanup | pass | Font scale restored to 1.0; animation scales restored to 1; accessibility disabled; synthetic Auth and application database rows verified at count 0. |

Defect: [#165](https://github.com/aeltoum/no-excuses/issues/165) — one-member setup Group permits the workout form but API returns generic `Action denied`. Nonblocking for this physical-device verdict because the required two-member Group flow passed after the invited synthetic peer joined. The issue remains product UX work.

Overall verdict: **PASS for Android physical-device scope**. User-flow checks passed; physical Chrome browser-tab CDP diagnostics were clean after the favicon repair; standalone mode remains independently proven by `SameTaskWebApkActivity` and the standalone screenshot. #165 remains recorded and naturally elapsed finalized-history presentation remains not run. This result does not cover iPhone Safari.
