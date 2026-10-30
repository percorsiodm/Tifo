// Service worker: app installabile e utilizzabile anche offline (ultimi dati visti)
const CACHE = "tifo-v23";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Rete prima, cache come riserva
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          const key = e.request.url.split("?")[0];
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request.url.split("?")[0]))
  );
});

// ===== Notifiche push (gol, risultati) inviate dal servizio Cloudflare =====
self.addEventListener("push", (e) => {
  let d = { title: "Tifo", body: "" };
  try { d = e.data ? e.data.json() : d; } catch { try { d.body = e.data.text(); } catch {} }
  e.waitUntil(self.registration.showNotification(d.title || "Tifo", {
    body: d.body || "", icon: "icon-192.png", vibrate: [200, 100, 200],
    tag: "tifo-" + Date.now(), renotify: true, data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.includes("/Tifo/"));
    return open ? open.focus() : clients.openWindow(e.notification.data?.url || "./");
  }));
});
