// Push-only service worker: no fetch handler, so it never caches or intercepts requests.
self.addEventListener("push", (event) => {
  let message = { title: "No Excuses", body: "" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
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
