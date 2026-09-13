# PWA real-device evidence template

Copy once per candidate and physical device. Fill actual observations; leave unrun items `not run`. Use synthetic accounts. Store screenshots/logs in approved evidence location without tokens, email addresses, or private Group data.

Candidate commit: `not run`

Date/tester: `not run`

Device model and physical device ID alias: `not run`

OS and browser versions: `not run`

Support floor met (iOS/Safari 16.4+ or Chrome/Android 111+): `not run`

Network profile and origin (HTTPS for install): `not run`

Evidence artifact paths: `not run`

| Check | Result (`pass`/`fail`/`not run`) | Observation and artifact |
| --- | --- | --- |
| Browser open, routes, refresh, viewport/safe-area fit | not run | |
| Install prompt/help, home-screen icon, standalone launch | not run | |
| Real OTP request, return path, authenticated Group entry | not run | |
| Close/relaunch: session restoration; sign-out cutoff | not run | |
| Weekly target, check-in, progress, finalized history through real API/DB | not run | |
| Keyboard opens/closes: fields and actions remain visible | not run | |
| 200% text: reflow, no clipped actions or horizontal overflow | not run | |
| Reduced motion: no motion-dependent action | not run | |
| VoiceOver or TalkBack: labels, order, status, focus after action | not run | |
| Alternative input: all core actions reachable | not run | |
| Console/network/runtime errors inspected | not run | |

Defect or compatibility ticket (URL, device, exact reproduction): `none recorded`

Overall verdict and reason: `not run`

One passing device does not cover both platforms. Record iPhone Safari and Android Chrome separately. If actual pilot device misses support floor or a check fails, keep release gate open and link a compatibility ticket.
