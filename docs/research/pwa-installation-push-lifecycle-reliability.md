# PWA installation, push, and lifecycle reliability

Research snapshot: 2026-09-08. This note checks current standards and browser-owner documentation for the supported pilot clients: current major Safari on iPhone/iPad, Chrome on Android, and Chrome, Safari, or Edge on desktop. It does not choose a push vendor, provision infrastructure, authorize spend, or claim delivery guarantees.

## Decision-ready conclusion

The pilot can require a **successful push setup ceremony during onboarding**, but cannot make continued push capability or delivery a membership invariant.

Onboarding may pass only after the client has:

1. entered an installed/app display mode where the platform requires it;
2. received notification permission from a user-initiated action;
3. created a Push subscription and registered its complete endpoint/key material with the server; and
4. completed a test push whose notification the member confirms seeing and opening at the intended in-app destination.

This is evidence about one device at one moment. Afterward, the user or OS can revoke permission, remove the app/site data or service worker, expire or replace the subscription, suppress presentation through notification/Focus settings, delay or discard a message, or route a notification activation somewhere other than the intended deep link. Push is therefore a **best-effort alert transport**. PostgreSQL and in-app deadline state remain authoritative. Revocation or delivery failure must warn and offer repair on next app open; it must not silently alter accountability state or block an already-enrolled member.

## Supported-client rules

### iPhone and iPad

- Standards-based Web Push is available to Home Screen web apps on iOS/iPadOS 16.4 and later. Permission may be requested only from direct user interaction, and users retain per-web-app control in system Notifications Settings ([WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- Safari 26 changes Add to Home Screen behavior: every added site defaults to opening as a web app, but the user may turn off **Open as Web App**. Code must therefore verify app display mode after launch rather than treating Add to Home Screen instructions as proof ([WebKit: Safari 26.0 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- iOS/iPadOS badging is exclusive to Home Screen web apps. Code can update a badge while open or during a push event, but the icon displays it only after notification permission; the user can disable badges separately without exposing that preference to the web app ([WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)). Badge visibility cannot be an onboarding or health assertion.
- Focus and notification settings can suppress presentation despite an intact subscription. Their exact presentation policy is user-controlled, not an application contract.

**Pilot consequence:** installation/app-mode is mandatory on iPhone/iPad before push setup. Provide tested, browser-specific instructions and verify `display-mode: standalone` (plus the established iOS standalone signal where needed). Do not depend on a programmatic install prompt: install UI differs across browser/OS combinations, and `beforeinstallprompt` is not supported on iOS/iPadOS ([web.dev: Installation prompt](https://web.dev/learn/pwa/installation-prompt)).

### Android and desktop

- Chrome/Edge can install eligible sites and can also run the product in a browser tab. Install prompting remains browser-controlled: a saved `beforeinstallprompt` event may invoke the browser flow after a user action, but dismissal cannot be overridden ([web.dev: Installation prompt](https://web.dev/learn/pwa/installation-prompt)).
- Edge documents the standard sequence: user permission, Push subscription, server send, service-worker `push` event, and visible notification. A subscription attempt without permission fails; `userVisibleOnly: true` is required ([Microsoft Edge: Re-engage users with push messages](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push)).
- Install availability and presentation differ by platform/browser. An installed PWA still runs on browser technology; feature detection and observed state are safer than browser-name rules ([MDN: Installing and uninstalling web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)).

**Pilot consequence:** installation remains optional on Android and desktop, but notification permission, a current subscription, server registration, and successful test push are required during enrollment. Test both installed and browser-tab modes in the supported matrix.

## What onboarding can and cannot prove

| Check | Can require now | What it does not guarantee |
| --- | --- | --- |
| App display mode | Yes; required on iPhone/iPad | App remains installed, site data remains present, or user does not later launch another copy/bookmark. |
| Notification permission | Yes, after explanatory UI and user gesture | Permission remains granted; OS shows alerts, sounds, lock-screen banners, or badges. |
| `PushManager.subscribe()` | Yes | Endpoint remains valid; subscription is not later refreshed, revoked, lost, or expired. |
| Server registration | Yes; store endpoint, keys, app/user/device association, timestamps, capability version | Device owns endpoint forever, or registration represents current permission. |
| Push-service acceptance | Yes; record HTTP result | A `201 Created` means accepted, not delivered to device ([RFC 8030 section 5](https://www.rfc-editor.org/rfc/rfc8030.html#section-5)). |
| Visible test notification | Yes; member confirms receipt | Future timing, receipt, presentation, badge, or deep-link behavior. |
| Test notification activation | Yes; member confirms expected route | Cold-start activation and deep linking remain reliable across later OS/browser updates and lifecycle states. |

Do not request permission on first page load. Explain value, test installation/app mode, then ask from an explicit member action. A denial is a failed onboarding attempt, not grounds to repeatedly prompt; show platform settings/repair instructions.

## Lifecycle and failure modes

### Permission and subscription drift

A subscription may carry an expiration time; user agents should refresh it, and push services may expire subscriptions at any time. The Push API defines subscription refresh, but the `pushsubscriptionchange` event is not interoperable across major browsers, so it cannot be the only repair path ([W3C Push API](https://www.w3.org/TR/push-api/), [MDN: `pushsubscriptionchange`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event)).

Required design:

- reconcile `Notification.permission`, service-worker registration, `getSubscription()`, endpoint/key fingerprint, and server registration on every foreground launch and after relevant settings/help flows;
- upsert changed subscriptions idempotently and deactivate old endpoints;
- treat push-service `404`/`410` responses as terminal endpoint invalidation; stop retries and mark that device `repair_required`;
- distinguish `not_supported`, `not_installed`, `prompt`, `denied`, `subscribed`, `test_pending`, `verified`, and `repair_required`; and
- allow multiple device subscriptions per member. Never overwrite one device with another.

### Delivery is best effort

RFC 8030 requires a TTL and allows a push service to retain a message for less time than requested, expire it early, or expire a subscription. A successful acceptance response does not prove device delivery. Delivery receipts exist in the protocol, but browser push endpoints and libraries must be verified before treating them as available; even a transport receipt does not prove notification presentation or human attention ([RFC 8030 sections 5.1-5.2 and 7.2-7.4](https://www.rfc-editor.org/rfc/rfc8030.html)).

Required design:

- set bounded TTL by notification meaning; never deliver stale deadline prompts as current;
- store only transport attempt/result and endpoint health as diagnostic evidence, not product truth;
- deduplicate logical notifications across retries/subscriptions;
- use idempotent application routes that re-read authoritative server state; and
- never schedule accountability transitions from client receipt, notification click, or badge count.

### Service-worker update and execution

Service-worker installation is separate from PWA installation. A new worker normally waits while the old worker controls open clients; refresh alone may not activate it. Workers are event-driven and can be stopped between events. `event.waitUntil()` must cover asynchronous push and click work ([web.dev: Service workers](https://web.dev/learn/pwa/service-workers), [web.dev: Service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)).

Required design:

- keep push parsing backward-compatible across at least current and immediately prior deployed payload schemas;
- include a stable notification fallback payload that needs no network fetch to render;
- version caches and payloads; test waiting-worker upgrades with existing subscriptions;
- never require long-running background execution, polling, periodic sync, or exact-time local work; and
- make every foreground launch reconcile authoritative state regardless of missed pushes.

WebKit documents a concrete legacy failure: if service-worker code fails to display a visible notification promptly, including through bugs, network conditions, or local-device conditions, WebKit may revoke the subscription. Declarative Web Push, supported by WebKit beginning with iOS/iPadOS 18.4 and Safari 18.5-era platforms, provides browser-rendered fallback content and a required navigation URL when JavaScript fails. Use feature-compatible declarative payloads where supported, while retaining standards-compatible service-worker handling for other clients ([WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).

### Notification activation and deep links

Service workers can handle `notificationclick`, focus a matching client, or open a same-origin URL. Browser behavior may reuse an existing installed-app context ([MDN: `Clients.openWindow()`](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow)). Deep-link URLs must be same-origin, authenticated routes carrying no private content in query strings. On activation, navigate to a stable route, restore auth, fetch current state, then show the current valid destination or a neutral expired/unavailable state.

Do not promise exact cold-start routing. WebKit's own bug tracker contains current reports of iOS notification clicks failing to dispatch to service-worker JavaScript and historical cases opening the PWA root instead of the requested URL ([WebKit bug 268797](https://bugs.webkit.org/show_bug.cgi?id=268797), [WebKit bug 263687](https://bugs.webkit.org/show_bug.cgi?id=263687)). These are first-party defect reports, not guarantees that every supported release reproduces them; they justify explicit physical-device cold/warm-start tests and root-route recovery UI.

## Product contract implied by push-only

1. **Authority:** every deadline, required action, and resulting accountability consequence exists in PostgreSQL and appears in-app. Push merely points back to current state.
2. **Enrollment:** setup ceremony required on at least one supported device. On iPhone/iPad this includes installed/app display mode. Failed or denied setup prevents completing initial enrollment, but does not create membership/accountability obligations.
3. **After enrollment:** revoked/missing permission or subscription moves device to `repair_required`. Next foreground use shows a persistent repair flow. Existing membership continues; no punitive state follows from transport health.
4. **No fallback channel:** per settled scope, no deadline email/SMS fallback. Product copy must say notifications can be missed and members should open the app to verify current obligations.
5. **Badge:** optional convenience only. Badge count is never authoritative and may be unavailable or hidden.
6. **Privacy:** notifications contain generic, minimal text; no Group name, workout detail, Proof, sanction, vote, health data, or authored content on lock screens. Deep links carry opaque routes/identifiers and reauthorize server-side.

## Verification matrix before pilot

Run on physical current-major devices plus supported desktop OS/browser combinations:

- fresh install/tab enrollment; denied permission; dismissed install; settings repair; later permission revocation;
- multiple devices and multiple iOS Home Screen copies; sign-out/reassignment; app removal/reinstall; cleared site data;
- expired/invalid endpoint (`404`/`410`), offline device through TTL, duplicate and reordered pushes, server retry, key rotation;
- foreground, background, force-quit/cold start, device restart, Focus/Do Not Disturb, notification previews/badges disabled;
- service-worker current-to-next deployment with app/tab left open; malformed/unknown payload; handler exception; network unavailable during push/click;
- notification click with logged-in, expired-session, signed-out, removed-member, expired-action, and deleted-Group states; and
- accessibility of install, permission rationale, test confirmation, repair warning, and current in-app deadline status.

Record observable outcomes, never claim OS-level receipt from server acceptance. Pilot readiness requires successful repeated end-to-end drills, while product safety continues to assume any individual push can fail.

## Decisions now unblocked

- Define exact onboarding state machine and copy for mandatory initial setup, denial, test confirmation, and repair.
- Select push delivery implementation and payload contract, including VAPID key custody, multi-device endpoint lifecycle, TTL/deduplication, and declarative Web Push compatibility.
- Set supported minimum OS/browser versions and physical-device regression matrix from measured results.
- Define server-side push-health diagnostics and privacy-minimized operator view without treating telemetry as accountability facts.
