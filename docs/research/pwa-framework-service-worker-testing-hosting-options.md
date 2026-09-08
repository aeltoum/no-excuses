# PWA framework, service-worker, testing, observability, and hosting options

Research snapshot: 2026-09-08. This note evaluates current primary documentation against the proposed No Excuses PWA pilot. It does not authorize application code, dependencies, accounts, deployment, paid capabilities, or infrastructure provisioning.

## Recommendation

Use a statically built React application with **Vite, TypeScript, and React Router Data Mode**. Use **`vite-plugin-pwa` with a custom Workbox service worker through `injectManifest`**. Keep Supabase Edge Functions and versioned HTTPS contracts as the application API; do not add a frontend server runtime.

Validate with **Playwright across Chromium, WebKit, branded Chrome, and Edge**, plus `@axe-core/playwright`. Treat this automation as a fast compatibility layer, not device or accessibility acceptance: retain required hands-on tests on current physical iPhone/iPad Safari, Android Chrome, and supported desktop browsers, including installed and tab modes where applicable.

Keep client observability privacy-minimized and application-owned: send allow-listed failure classes, build/version, capability state, coarse timing, and short-lived opaque correlation IDs to the existing authoritative diagnostic path. Do not send Proof, authored content, Account identifiers, Group identifiers, URLs containing secrets, request bodies, or browser/device fingerprints. Supabase's native reports and logs remain supplemental. Do not add a third-party browser-monitoring processor unless a later decision proves it necessary and resolves retention, privacy, cost, and approval gates.

Prefer a **vendor-neutral static build**. Cloudflare Workers Static Assets or Cloudflare Pages is the strongest hosting candidate for a later explicit environment decision; neither is provisioned by this research. Keep Netlify as a credible fallback. Do not rely on Vercel Hobby for pilot hosting because its terms restrict Hobby use to personal, non-commercial projects.

This recommendation supersedes only the client/tooling direction in the accepted React Native/Expo ADR; it preserves the accepted Supabase backend, server-authoritative state, versioned contracts, and no-spend/no-provisioning boundary.

## Why this framework shape fits

| Option | Fit | Trade-off | Disposition |
| --- | --- | --- | --- |
| React + Vite + React Router Data Mode | Vite emits static assets deployable to any static host. React Router Data Mode adds route loaders/actions while retaining control of bundler and server choices. This matches a private authenticated client whose authoritative API already lives in Supabase. | PWA manifest, service worker, security headers, and SPA fallback routing remain explicit project configuration. | **Recommend.** Smallest credible client surface and lowest hosting coupling. |
| React Router Framework Mode in SPA mode | Adds generated route types, route modules, code splitting, and framework conventions. | Even SPA mode pre-renders the root route at build time, requires an SSR-safe root, and introduces Node adapter/framework machinery the pilot does not currently need. | Reconsider only if route-module ergonomics prove valuable enough to justify added surface. |
| Next.js App Router | Officially supports manifests, Web Push examples, SPAs, and static export, with a path to server-rendered features. | Static export moves Server Actions to an external API and headers to the hosting proxy. Its official PWA guide describes custom service-worker work and says the Serwist option currently requires webpack configuration. No Excuses already has a separate authoritative API, so the extra server/SSR model does not buy a known pilot requirement. | Credible fallback, not default. |

Vite's current default production target is Chrome/Edge 111+, Firefox 114+, and Safari 16.4+, but the project must pin its own supported-browser policy and verify the actual current major browsers selected for the pilot ([Vite production build](https://vite.dev/guide/build), [Vite static deployment](https://vite.dev/guide/static-deploy), [React Router modes](https://reactrouter.com/start/modes), [React Router SPA mode](https://reactrouter.com/how-to/spa), [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)).

## Service worker and offline boundary

`vite-plugin-pwa` can generate the manifest, service worker, and registration. Its `injectManifest` strategy compiles a project-owned service worker and injects the precache manifest. Workbox supplies focused modules for precaching, routing, cache strategies, expiration, registration, and update lifecycle ([Vite PWA getting started](https://vite-pwa-org.netlify.app/guide/), [`injectManifest`](https://vite-pwa-org.netlify.app/guide/inject-manifest), [Workbox overview](https://developer.chrome.com/docs/workbox/what-is-workbox), [`workbox-window`](https://developer.chrome.com/docs/workbox/modules/workbox-window)).

Choose `injectManifest`, not an opaque generated policy, because No Excuses needs explicit control over private drafts, Proof uploads, update compatibility, and consequential mutations:

- Precache versioned public application-shell assets and a safe offline shell.
- Do **not** runtime-cache authenticated API responses, signed media URLs, Proof, Group-visible state, auth responses, or personalized HTML in Cache Storage.
- Store device-private drafts and the upload journal in IndexedDB behind an app-owned interface; keep blobs separate from server cache. IndexedDB supports offline application data, but transactions can abort on shutdown and storage remains best-effort, so recovery and user-visible loss states remain required ([Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)).
- Retry queued work while the foreground client is open or returns online. Background Sync is not Baseline across major browsers, so it may enhance delivery where available but cannot be required for correctness ([Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)).
- Keep starting a Workout session online and server-acknowledged. Keep consequential mutations visibly pending until acknowledged and idempotent at the server.
- Prompt for updates at a safe boundary and test mixed page/service-worker versions. Workbox documents that a new worker may wait while an older page remains controlled; page/worker messages therefore need explicit version compatibility.
- Require HTTPS outside localhost. Service workers are secure-context features ([Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)).

## Browser, accessibility, and device evidence

Playwright exercises Chromium, WebKit, Firefox, branded Chrome, and Edge, and provides device descriptors. Its WebKit build is useful cross-engine coverage but is not evidence from Safari on a physical Apple device. Playwright's Android device automation is documented as experimental and incomplete. Automated browser coverage therefore cannot replace the approved physical-device quality bar ([Playwright browsers](https://playwright.dev/docs/browsers), [Playwright emulation](https://playwright.dev/docs/emulation), [Playwright Android API](https://playwright.dev/docs/api/class-android)).

Use four layers:

1. Unit/component tests for domain-independent UI, capability adapters, draft migrations, upload-journal transitions, and service-worker message/version contracts.
2. Playwright projects for Chromium, WebKit, Chrome, and Edge covering responsive routes, auth redirects, online/offline transitions, interrupted uploads, stale workers, update prompts, storage loss, permission denial/revocation, and deep links.
3. `@axe-core/playwright` scans on representative states. Playwright explicitly warns automated checks find only some accessibility problems; manual and inclusive testing remain necessary ([Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)).
4. Recorded physical-device acceptance on current iPhone/iPad Safari and Android Chrome, plus desktop Safari/Chrome/Edge. Cover installation/onboarding, standalone launch, camera capture, push grant and later revocation, offline restart, storage eviction, version update, VoiceOver/TalkBack, zoom/text scaling, keyboard/focus, reduced motion, and poor-network interruption. Browser remote-inspection tools can inspect installed PWAs on connected devices ([PWA tools and debugging](https://web.dev/learn/pwa/tools-and-debug)).

## Observability boundary

Browser-only failures such as service-worker activation, storage migration/eviction, install state, permission transitions, camera acquisition, and foreground retry need explicit diagnostic events. Route a narrow event vocabulary through the application API into the existing 14-day application diagnostic store; PostgreSQL operational facts remain authoritative.

Supabase exposes native Logs and Reports across platform services, but those views are vendor diagnostics with plan-specific retention, not the authority for product outcomes or the exact application retention contract ([Supabase Logs](https://supabase.com/docs/guides/observability/logs), [Supabase Reports](https://supabase.com/docs/guides/observability/reports), [Supabase observability](https://supabase.com/docs/guides/observability)). Reuse the existing research conclusion that raw platform logs and third-party telemetry are supplemental. Browser telemetry must be sampled and inspected on physical devices before readiness; client collection must fail closed when an unexpected field appears.

## Hosting comparison

The Vite `dist` output is ordinary static HTML/CSS/JavaScript, so hosting remains replaceable. Required host behavior is narrow: HTTPS, root SPA fallback without intercepting real assets or service-worker files, explicit security/cache headers, immutable hashed-asset caching, no-cache/revalidation for HTML and service worker, preview environments, rollback, and support for a later custom domain.

| Candidate | Current evidence | Constraint | Disposition |
| --- | --- | --- | --- |
| Cloudflare Workers Static Assets / Pages | Cloudflare documents Vite deployment, automatic HTTPS endpoints, preview deployments, and Free Pages limits including 500 builds/month, 20,000 files, and 25 MiB per file. Workers is Cloudflare's current primary platform and can serve static assets without adding an application server design. | Creates another processor/account and requires host-header, rollback, region/privacy, quota, and outage rehearsal. Pages and Workers product direction should be rechecked at selection time. | **Leading candidate for later decision.** |
| Netlify static hosting | Vite's official deployment guide documents Git-connected deploys and preview deployments. | Current free-plan limits, acceptable-use terms, private-repo collaboration, headers, and retention must be verified immediately before selection. | Credible fallback. |
| Vercel static hosting | Strong Vite/Next support, previews, and HTTPS. | Vercel states Hobby is personal/non-commercial only and pauses projects that exceed free limits. Treating a controlled product pilot as eligible is unsafe without a separate terms decision; paid use needs approval. | Do not choose as zero-spend default. |
| GitHub Pages | Vite documents static deployment through GitHub Actions. | Weaker fit for private pilot controls and preview-environment workflow; repo/workflow and site visibility need separate review. | Useful temporary technical demo host, not current pilot recommendation. |

Sources: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Cloudflare Pages](https://developers.cloudflare.com/pages/), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Vite deployment guide](https://vite.dev/guide/static-deploy), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite).

## Decision-ready stack and remaining proof

The planning ticket can safely select this default:

- React + TypeScript + Vite;
- React Router Data Mode;
- app-owned data/capability boundaries around versioned Supabase HTTPS APIs;
- IndexedDB for best-effort device-private drafts and upload journal;
- `vite-plugin-pwa` + Workbox `injectManifest` for manifest/build integration and explicit service-worker policy;
- Playwright + axe, backed by mandatory manual/physical-device evidence;
- privacy-minimized first-party client diagnostics into the existing application store; and
- vendor-neutral static output, with Cloudflare static hosting leading a later no-provisioning environment decision.

Before implementation or hosting commitment, a focused prototype must prove two-photo camera capture and recovery, IndexedDB blob limits/eviction, foreground retry, service-worker update recovery, installation/onboarding, Web Push permission and delivery, and accessible behavior on the exact physical-device/browser matrix. Hosting selection must separately approve the processor, terms, region, cost ceiling, DNS/domain, security headers, preview-data rules, rollback, availability monitoring, and production-like rehearsal. None is authorized here.
