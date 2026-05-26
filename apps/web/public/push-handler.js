/* eslint-disable */
/**
 * Push- und Notification-Click-Handler.
 *
 * Wird vom workbox-Service-Worker per `importScripts('/push-handler.js')`
 * eingebunden (`apps/web/vite.config.ts`). Bewusst pures Vanilla-JS — der
 * Bundler fasst dieses File nicht an, weil es zur Runtime im SW eingelesen
 * wird, nicht zur Build-Zeit gepatcht.
 *
 * Payload-Schema (siehe `apps/api/src/modules/push/push.service.ts`):
 *   { title, body, url?, icon?, tag? }
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Heb ab!", body: event.data.text() };
  }
  const opts = {
    body: data.body || "",
    icon: data.icon || "/pwa-192x192.png",
    badge: "/pwa-64x64.png",
    data: { url: data.url || "/lobby" },
  };
  if (data.tag) opts.tag = data.tag;
  event.waitUntil(self.registration.showNotification(data.title || "Heb ab!", opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/lobby";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        // Wenn schon eine Tab auf dem Ziel ist (oder generell auf der App):
        // fokussieren, statt einen neuen Tab zu öffnen.
        if (w.url.includes(target) && "focus" in w) {
          return w.focus();
        }
      }
      if (wins.length > 0 && "focus" in wins[0]) {
        // Sonst: ersten Tab fokussieren und dort navigieren.
        return wins[0].focus().then(() => wins[0].navigate(target));
      }
      return self.clients.openWindow(target);
    })
  );
});
