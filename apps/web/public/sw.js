/*
 * nonlinear service worker — a small, hand-rolled offline shell (no Workbox).
 *
 * Strategy:
 *  - API traffic (/api, /mcp, /scim, WebSocket) is never cached — always live.
 *  - Navigations are network-first with an offline fallback to the cached shell,
 *    so a fresh index.html ships as soon as it's reachable but the app still
 *    opens offline.
 *  - Hashed build assets (/assets/*, icons, manifest) are cache-first, since
 *    Vite gives every build a new filename — cached entries can never go stale.
 */
const CACHE = 'nonlinear-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/mcp' ||
    url.pathname.startsWith('/scim/') ||
    url.pathname === '/healthz'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets: cache-first, populate on miss.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
