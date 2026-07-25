/* Minimal, safe service worker for the storefront PWA.
 * Goals: make the app installable + give an offline fallback — WITHOUT caching
 * dynamic HTML, API responses, or auth (which would show stale data or break
 * sign-in on this server-rendered app).
 *  - Immutable static assets (/_next/static, /icons): cache-first.
 *  - Navigations: network-first, fall back to /offline.html when truly offline.
 *  - Everything else (API/data): straight to the network, never cached.
 */
const CACHE = "skh-store-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin (Cloudinary, etc.) alone

  // Cache-first for immutable, hashed assets.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first for page navigations; offline fallback only when the network fails.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response("Offline", { status: 503 }))),
    );
    return;
  }
  // API / data / everything else: do nothing (default network fetch, never cached).
});
