// Push notifications, plus a cache for proof photos. Nothing else is intercepted.
const photoCache = "proof-photos";
const photoLimit = 300;

// Each feed load signs photo URLs with a new token. Cache by object path so a
// photo downloads once, whatever token its URL carries.
const photoKey = (url) =>
  url.pathname.includes("/storage/v1/object/sign/proof-photos/")
    ? url.origin + url.pathname
    : null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const key = photoKey(new URL(event.request.url));
  if (!key) return;
  event.respondWith(
    caches.open(photoCache).then(async (cache) => {
      const hit = await cache.match(key);
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(key, response.clone());
        // Oldest photos go first once the cache is full.
        const keys = await cache.keys();
        for (const old of keys.slice(0, Math.max(0, keys.length - photoLimit)))
          await cache.delete(old);
      }
      return response;
    }),
  );
});

self.addEventListener("push", (event) => {
  let message = { title: "No Excuses", body: "" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {}
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(message.title, {
        body: message.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
      }),
      // A dot on the app icon until the app opens and sets the real count.
      self.navigator.setAppBadge?.().catch(() => {}),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) =>
        windows.length > 0 ? windows[0].focus() : self.clients.openWindow("/"),
      ),
  );
});
