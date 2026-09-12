# True MVP PWA architecture options

Status: architecture recommendation approved by the owner on 2026-09-12 for issue #154.
Hosting, paid services, and deployment configuration remain unselected.

## Recommendation

Use a **React + TypeScript single-page application built with Vite**, added as
`apps/web` in the existing pnpm workspace.

Keep the first delivery boundary deliberately small:

- client-rendered routes and accessible semantic HTML;
- direct reuse of `@no-excuses/contracts` runtime Zod schemas and generated OpenAPI types;
- calls to the existing delivery/API boundary rather than a second framework-owned backend;
- Supabase email OTP and browser-managed client sessions, with authorization remaining in
  PostgreSQL Row Level Security and server/API checks;
- a checked-in web app manifest, icons, install guidance, and HTTPS in deployed environments;
- no service worker, offline cache, push, background sync, server rendering, or framework
  middleware in the first installable shell.

This is the smallest option matching active scope. Vite officially supplies a `react-ts`
template, transpiles TypeScript, and builds optimized static assets; it does not perform type
checking, so the repository's existing `tsc --noEmit` gate remains necessary
([Vite getting started](https://vite.dev/guide/),
[Vite features](https://vite.dev/guide/features.html#typescript)). Vite's `dist` output can be
served by any static host, keeping hosting separate from the client choice
([Vite static deployment](https://vite.dev/guide/static-deploy.html)).

No third contender is justified. React already exists in the repository's deferred mobile
client, TypeScript and pnpm are established, and the contracts package is framework-neutral.
A second UI ecosystem would increase decisions and dependencies without reducing PWA work.

## Option comparison

| Concern | Vite React SPA | Next.js App Router |
| --- | --- | --- |
| MVP fit | Thin browser client over existing API/Supabase boundaries. | Can build an SPA, but adds Server/Client Component, rendering, cache, and runtime choices. |
| Workspace integration | One `apps/web` package; import workspace contracts directly; static output. | One `apps/web` package, but static export versus Node runtime must be selected and policed. |
| Auth | Native browser Supabase client; OTP code verification has no redirect requirement. | SSR auth requires cookie storage, PKCE callback handling, and `@supabase/ssr`, currently documented as beta. |
| PWA primitives | Plain manifest/icons; optional later service worker. | Built-in typed manifest convention; service worker is still authored separately. |
| Deployment | `dist` is portable static content; host needs HTTPS and SPA route fallback. | Static export is portable, but cookies, redirects, rewrites, headers, dynamic request handlers, and Server Actions are unsupported; full features require a Node-compatible runtime. |
| Main cost | Client-only initial render; route fallback must be configured on host. | More framework surface and deployment coupling before any MVP requirement needs SSR. |

Next.js is viable, not preferred. Its official PWA guide provides built-in App Router manifest
metadata but still instructs developers to create and secure a service worker themselves
([Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)). Next.js can start
as a strict SPA, yet that future-facing server capability is not current value
([Next.js SPA guide](https://nextjs.org/docs/app/guides/single-page-applications)). Static export
can run on any static server, but loses cookies, rewrites, redirects, headers, Server Actions,
and request-dependent handlers; using the full feature set requires a Node.js server
([Next.js static export](https://nextjs.org/docs/app/guides/static-exports),
[Next.js platform deployment](https://nextjs.org/docs/app/guides/deploying-to-platforms)).

## Installability and lifecycle boundary

Ship one manifest linked from the application document with at least:

- stable `id` and `start_url`;
- `name` and `short_name`;
- `display: "standalone"`;
- theme/background colors;
- 192px and 512px icons, including a maskable Android asset;
- an explicit iOS `apple-touch-icon` because WebKit gives it precedence over
  manifest-declared icons.

Chromium install promotion expects HTTPS plus the manifest name, 192/512 icons, `start_url`,
an installable display mode, and no truthy `prefer_related_applications`
([Chrome install criteria](https://web.dev/articles/install-criteria)). On iPhone/iPad, a
manifest with `display: standalone` or `fullscreen` makes an Add-to-Home-Screen site launch as
a separate web app; iOS/iPadOS 16.4 also allowed third-party browsers to expose Add to Home
Screen, while the install action remains Share-menu-driven rather than
`beforeinstallprompt`-driven
([WebKit Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)).

Do **not** add a service worker merely to earn the PWA label. Current installability guidance
describes service workers as optional for offline behavior, while True MVP explicitly excludes
offline-first and advanced lifecycle work
([MDN PWA definition](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)). A service worker introduces persistent cache/version state
and interception risk around authenticated responses. Add one only in a later approved slice
with named cache rules, update behavior, logout/account-deletion clearing, and offline-state
acceptance tests. Never cache authenticated API responses by default.

Installation still requires HTTPS outside localhost. Provide contextual, platform-specific
help: browser install UI on Android Chrome; Share -> Add to Home Screen on iPhone. Do not gate
core use on installation or assume `beforeinstallprompt`, which is unavailable on iOS.

## Browser support strategy

Start with an explicit support floor matching Vite's current default production baseline:
**iOS/Safari 16.4+ and Chrome/Android 111+**. Vite's current production target names Safari and
iOS 16.4 plus Chrome 111; it transforms syntax but does not automatically polyfill missing Web
APIs
([Vite production compatibility](https://vite.dev/guide/build.html#browser-compatibility)).

Before implementation acceptance, compare that floor with actual pilot devices. If an invited
member needs older iOS, lower `build.target` deliberately and test required APIs; do not add a
blanket legacy bundle without evidence. Use progressive enhancement and feature detection for
installation UI. Unsupported install affordances must degrade to the normal responsive site,
not block sign-in or the weekly loop.

Automated coverage should run Playwright projects for mobile Chromium and mobile WebKit device
profiles, plus compact/enlarged-text layouts. Playwright emulates viewport, user agent, screen,
and touch settings, but its WebKit build is not branded Safari; keep real iPhone Safari and real
Android Chrome install/standalone/session checks as release evidence
([Playwright emulation](https://playwright.dev/docs/emulation),
[Playwright browsers](https://playwright.dev/docs/browsers#webkit)).

## Authentication and session implications

Prefer the six-digit email OTP flow already named by product screens:

1. `signInWithOtp({ email })` sends the OTP template.
2. User types the code in the same browser context.
3. `verifyOtp` returns the authenticated session.
4. Client calls existing API/Supabase boundaries with that session; database RLS remains
   authoritative.

Supabase distinguishes email templates: `{{ .Token }}` sends an OTP, while
`{{ .ConfirmationURL }}` sends a magic link
([Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[Supabase `signInWithOtp`](https://supabase.com/docs/reference/javascript/auth-signinwithotp)).
Typed-code OTP avoids cross-browser and installed-versus-tab return ambiguity. Preserve generic
responses for unknown/ineligible addresses; Supabase notes that sign-in errors may intentionally
not distinguish account existence.

If magic links are later required, add a dedicated callback route and allow-list every exact
development/preview/production redirect origin. Supabase requires `redirectTo` URLs to match
configured redirect URLs
([Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)). For PKCE links,
the callback must exchange the one-time, five-minute authorization code using
`exchangeCodeForSession`
([Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)).

Client-only Supabase auth stores sessions in browser storage by default. Next.js SSR changes the
design: session tokens move to cookies, PKCE becomes necessary, refresh-cookie writes must be
handled, and Supabase's recommended `@supabase/ssr` package remains beta
([Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side)). No active requirement
needs that complexity. Installed and tab contexts must still be tested for session restore,
sign-out, access revocation, and Account deletion; never treat client session presence as
authorization.

## Accessibility and verification gate

Framework choice does not supply accessibility. Implement existing route-title focus, return
focus/scroll restoration, status announcements, keyboard behavior, reduced motion, 200% reflow,
48px targets, safe-area insets, loading/empty/failure/denied states, and no horizontal overflow
as application contracts.

Minimum automated gate:

- Vitest for pure state, adapters, and contract parsing;
- Playwright for OTP UI with mocked/local Supabase, deep-link and refresh routing, session
  restore/sign-out, install metadata fetch, keyboard-only flows, focus restoration, reduced
  motion, narrow landscape/portrait, and 200% text/reflow;
- `@axe-core/playwright` scans on every major state, while retaining manual VoiceOver/TalkBack
  review because Playwright explicitly says automated accessibility tests detect only some
  problems
  ([Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)).

Real-device release checks must cover: install from iPhone Share menu and Android Chrome UI;
standalone launch; safe-area and software-keyboard layout; OTP entry and session restoration;
browser-to-installed-app transitions; network loss messaging; and uninstall/reinstall behavior.

## Smallest implementation sequence

1. Add `apps/web` as Vite React TypeScript workspace package; reuse root formatting,
   type-checking, and test conventions.
2. Add client routing with host fallback to `index.html`; define stable routes needed by active
   True MVP only.
3. Import `@no-excuses/contracts`; keep network adaptation in one thin client module that parses
   responses with existing Zod schemas.
4. Add Supabase OTP request/verify/session adapter with environment validation. Expose only
   publishable client configuration; never privileged keys.
5. Add manifest/icons/install help. Verify manifest delivery and HTTPS. Keep service worker
   absent.
6. Add Playwright Chromium/WebKit projects, axe checks, then real iPhone/Android release checks.

## Reconsideration triggers

Reconsider Next.js only when an approved requirement needs server-rendered public content,
server-held cookies, framework route handlers/actions, or another measured server-rendering
benefit. Reconsider a service worker only when an approved offline/push/update requirement has
explicit cache, privacy, lifecycle, and recovery acceptance criteria.
