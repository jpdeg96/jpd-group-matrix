/**
 * Service worker.
 *
 * Exists for one reason: iOS will not deliver a push to a web app without one.
 * It deliberately does NOT cache anything — this app is a live view of a shared
 * database, and a cached dashboard is a lie about who is working on what. The
 * network is the only source of truth here, so there is no fetch handler.
 *
 * Served from /sw.js, at the site root, so its scope covers every page.
 */

// Take over immediately rather than waiting for every tab to close. A worker
// stuck on an old version is the usual reason a push silently stops arriving
// after a deploy.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push that is not ours, or a malformed one. Showing a notification with
    // raw bytes in it would be worse than showing nothing.
    return;
  }

  const title = payload.title || "JPD Group Matrix";
  const options = {
    body: payload.body || "",
    // Reused for the badge rather than shipping a second asset; iOS ignores
    // the badge field and Android renders it monochrome either way.
    icon: "/android-chrome-192x192.png",
    badge: "/android-chrome-192x192.png",
    // Same tag collapses with any unread notification about the same thing, so
    // an event flagged and resolved twice while somebody is away is one line
    // rather than four.
    tag: payload.tag || undefined,
    // Replace quietly when it collapses: the first one already buzzed, and
    // re-alerting for an update to something you have not read yet is how a
    // notification becomes something people turn off.
    renotify: false,
    data: { url: payload.url || "/dashboard", kind: payload.kind || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      /*
       * Reuse an open window rather than opening another.
       *
       * Somebody with the app already open gets that window brought forward
       * and navigated; the alternative is a second copy of a live dashboard
       * holding its own event stream, which is both wasteful and confusing
       * when the two end up showing different filters.
       */
      for (const client of clients) {
        if (new URL(client.url).origin !== url.origin) continue;
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url.href);
          return;
        }
      }

      await self.clients.openWindow(url.href);
    })(),
  );
});
