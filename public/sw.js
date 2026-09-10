const CACHE = "nb-offline-v5";
const SHELL = ["/", "/index.html", "/favicon.svg", "/icon-180.png", "/intro-poster.jpg", "/manifest.webmanifest", "/studios.json"];
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
  const asset = same && /favicon|og\.jpg|icon-180|poster|manifest|studios\.json|mark\.(png|jpg)/.test(u.pathname + u.search);
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
          return (await caches.match(e.request)) || (await caches.match("/")) || (await caches.match("/index.html"));
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
