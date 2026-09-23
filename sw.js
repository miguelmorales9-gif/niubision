const CACHE = "nb-offline-v37";
const SHELL = [
  "/",
  "/index.html",
  "/app/styles.css?v=37",
  "/app/app.js?v=37",
  "/favicon.svg",
  "/logo.png",
  "/icon-48.png",
  "/icon-72.png",
  "/icon-96.png",
  "/icon-144.png",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-192-maskable.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/intro-poster.jpg",
  "/intro.mp4",
  "/manifest.webmanifest"
];
const DB_NAME = "nb-sync";
const DB_STORE = "queue";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function queueAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function queueDel(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function queuePut(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(item, item.id || "state");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushQueue() {
  const items = await queueAll().catch(() => []);
  for (const item of items) {
    if (!item || !item.url) continue;
    try {
      const res = await fetch(item.url, {
        method: item.method || "PUT",
        headers: item.headers || { "Content-Type": "application/json" },
        body: item.body || null,
      });
      if (res && res.ok) await queueDel(item.id || "state");
    } catch (err) {
      /* keep queued */
    }
  }
}

self.addEventListener("sync", (e) => {
  if (e.tag === "nb-sync" || e.tag === "nb-cloud") e.waitUntil(flushQueue());
});
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "nb-sync") e.waitUntil(flushQueue());
});
self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "nb-queue" && data.item) {
    e.waitUntil(queuePut(data.item).then(() => flushQueue()));
  }
  if (data.type === "nb-flush") e.waitUntil(flushQueue());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (/\/api\//.test(u.pathname)) return;
  const same = u.origin === self.location.origin;
  const nav = e.request.mode === "navigate" || (same && (u.pathname === "/" || /index\.html|niubision\.html/.test(u.pathname)));
  const asset = same && /favicon|og\.jpg|icon-|poster|manifest|intro|logo\.png|\/app\//.test(u.pathname + u.search);
  const img = /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(u.pathname);
  if (!nav && !asset && !img) return;
  e.respondWith(
    (async () => {
      if (nav || asset) {
        try {
          const res = await fetch(e.request);
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        } catch (err) {
          return (await caches.match(e.request)) || (await caches.match("/")) || (await caches.match("/index.html")) || Response.error();
        }
      }
      const hit = await caches.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })()
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? (e.data.json ? e.data.json() : JSON.parse(e.data.text())) : {};
  } catch (err) {
    try { data = { body: e.data && e.data.text ? e.data.text() : "NiuBision" }; } catch (e2) { data = {}; }
  }
  const title = String(data.title || "NiuBision");
  const body = String(data.body || data.message || "Hay algo nuevo en el estudio.");
  const url = String(data.url || data.click || "/");
  const tag = String(data.tag || "nb-push");
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-96.png",
      tag,
      data: { url },
      renotify: true
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.url) || "/";
  let target = "/";
  try {
    if (/^https?:/i.test(raw)) target = raw;
    else if (raw.charAt(0) === "/" || raw.charAt(0) === "?") target = raw;
    else if (raw === "bandeja" || raw === "inbox") target = "/?view=inbox";
    else if (raw === "hoy" || raw === "work") target = "/?view=work";
    else target = "/" + String(raw).replace(/^\//, "");
  } catch (err) { target = "/"; }
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && "focus" in c) {
          try {
            if (c.navigate) c.navigate(target);
          } catch (err) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
