# Accountability slices: notifications, photo proof, Consequence cards

Owner-approved deferred slices activated 2026-10-13. Scope and decisions:
`docs/product/true-mvp-scope.md` ("Activated deferred slices").

| Slice | Automated evidence | Pending |
| --- | --- | --- |
| Web Push | `tests/web-push.test.ts` (peer check-in once, never the author; last-24-hours reminder; weekly result; subscription scoping) | Real VAPID delivery on installed iPhone and Android |
| Photo proof and peer verification | `tests/photo-proof.test.ts` (two own unused photos plus consent; one-peer verify and 24-hour auto-verify; strict-majority reject owing a card; Unsupported and withdrawal; Verified-only settlement waiting on open reviews; report hiding and admin removal; 90-day and abandoned-upload deletion); `apps/web/tests/weekly.spec.ts` (camera inputs, JPEG upload, retry reuse); `apps/web/tests/wall.spec.ts` (feed review, vote, report confirm, Home badge, docked barbell) | Live Supabase Storage upload, signed reads, deletion; physical-device camera capture |
| Consequence cards | `tests/consequence-play.test.ts` (offer, single reroll, select, claim, two approvals, next offer; expiry owing another card; safety pause; rejected claim); `apps/web/tests/consequences.spec.ts` (auto-popped augment hand, decide later, reroll, lock in, in-app confirm, approving a friend's claim, axe) | Physical-device run with real Group members |

Commands: `pnpm check` and the Chromium Playwright suite (`apps/web`, `playwright test`).
WebKit browser runs and `pnpm db:reset` were not available in the authoring environment.
