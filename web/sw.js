// Retires the old app service worker that used to live on niubision.com.
// The app now lives at niubision.app; this SW wipes caches and unregisters itself.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} });
  })());
});
self.addEventListener("fetch", () => {}); // never intercept
