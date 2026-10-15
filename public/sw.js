/*
 * Up Assistant service worker.
 *  - /api/* is never cached or intercepted (always live, never stale data or double submits).
 *  - Static build assets and icons: cache-first (they are content-hashed / immutable).
 *  - Pages: network-first; the last good copy of a page is served when offline, else an offline page.
 */
const VERSION = "up-v2"; // bump to drop cached icons and pages after a rebrand
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Up Assistant</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#F0F2F4;color:#191A1B;font:15px/1.5 Inter,system-ui,sans-serif;text-align:center;padding:24px}
h1{font:700 28px/1.1 "Space Grotesk",system-ui,sans-serif;text-transform:uppercase;margin:0 0 8px}p{color:#6F7175;max-width:340px;margin:0 auto 20px}
button{height:46px;padding:0 18px;border:0;border-radius:12px;background:#191A1B;color:#fff;font:inherit;font-weight:500}</style></head>
<body><main><h1>Offline</h1><p>Up Assistant needs a connection to load fresh jobs and drafts. Pages you opened recently still work.</p><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(["/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache the API

  const isStatic = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(?:woff2?|png|svg|ico|css|js)$/.test(url.pathname);
  if (isStatic) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await caches.match(req)) || new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })),
    );
  }
});
