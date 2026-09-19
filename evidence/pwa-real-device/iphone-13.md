# iPhone physical-device evidence — iPhone 13

Candidate: base commit `59d2872` on `codex/pwa-integrated-acceptance`, plus current working-tree 200% Page Zoom CSS and browser regression-test changes.

Date/tester: 2026-09-18, user-assisted physical-device run

Device: Apple iPhone 13; physical device identifier withheld

OS/browser: iOS 26.5; Safari

Support floor: pass; iOS 26.5 exceeds iOS/Safari 16.4 minimum in ADR 0005.

Network/origin: local LAN at `http://192.168.1.150:4174`. This is local validation, not hosted HTTPS evidence.

Artifacts: no screenshots or runtime logs available. No personal identifiers were recorded.

| Check | Result | Observation and artifact |
| --- | --- | --- |
| Browser open, routes, refresh, viewport/safe-area fit | pass at 100% | User inspected routes and refresh in Safari. Layout and safe areas looked good at default Page Zoom. |
| Install, home-screen launch, standalone mode | pass | Safari Add to Home Screen succeeded. Home-screen launch opened standalone without Safari address bar. |
| Real OTP, authenticated Group entry | pass with storage boundary | Safari session did not transfer into standalone, consistent with separate browser/standalone storage. Fresh OTP sign-in succeeded in standalone. |
| Close/relaunch session restoration and sign-out cutoff | pass | Closing and relaunching standalone restored authenticated state. After sign-out, close/relaunch remained signed out. |
| Weekly target, check-in, progress, finalized history | read-only inspection | User inspected weekly, progress, and History surfaces. No target or check-in mutation was exercised, and naturally elapsed finalized history was not verified in this run. |
| Keyboard and safe area | pass | Target field and actions remained reachable with keyboard open; value remained unchanged. |
| 200% text and Page Zoom | fail, deferred | Safari Page Zoom at 200% improved after narrow-layout repair, but text and background-box alignment still failed physical inspection. User accepted this as nonblocking for issue #158 and deferred repair to [#166](https://github.com/aeltoum/no-excuses/issues/166). |
| Reduced motion | pass | User enabled reduced motion and found no motion-dependent action. |
| VoiceOver | pass | User verified labels, reading order, selected state, buttons, and fields. |
| Alternative input | pass | Voice Control Show Numbers reached all five navigation tabs. |
| Console/network/runtime diagnostics | not run | Developer Mode was disabled and no usable physical Safari inspection source was available. |

Defect: [#166](https://github.com/aeltoum/no-excuses/issues/166) — physical iPhone Safari Page Zoom at 200% retains text/background-box alignment defects after automated narrow-layout improvement.

Overall verdict: **accepted iPhone physical-device scope for issue #158 with one explicit deferred defect**. Browser use at 100%, installation, standalone launch, standalone OTP, session restoration, keyboard reachability, reduced motion, VoiceOver, Voice Control, and sign-out persistence passed. 200% Safari Page Zoom did not pass and remains tracked in #166. Runtime diagnostics were not run. Weekly/progress/history were inspected read-only; this run does not prove a mutated weekly journey or naturally elapsed finalized outcome.
