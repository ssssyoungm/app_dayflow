// DayFlow Web Push & Notification Click Handler (imported by Workbox Service Worker)

self.addEventListener("push", (event) => {
  let payload = {
    title: "데이플로우 일정 알림",
    body: "예정된 일정이 곧 시작됩니다.",
    tag: "dayflow-reminder",
    url: "/",
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          title: typeof parsed.title === "string" ? parsed.title : payload.title,
          body: typeof parsed.body === "string" ? parsed.body : payload.body,
          tag: typeof parsed.tag === "string" ? parsed.tag : payload.tag,
          url: typeof parsed.url === "string" ? parsed.url : payload.url,
        };
      }
    }
  } catch {
    try {
      const text = event.data ? event.data.text() : "";
      if (text) payload.body = text;
    } catch {
      // ignore
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: payload.tag,
      renotify: false,
      silent: false,
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
