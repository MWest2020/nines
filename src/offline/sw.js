// The service worker: it keeps the built game so it runs with the network off once loaded
// (ARCHITECTURE.md, Loading content offline; docs/how-to/verify-offline.md).
//
// Hand-written, no dependency. tools/vite-plugin-sw.ts prepends two constants at build time:
// VERSION, a hash of every built file, and FILES, the list of them. A new build is a new
// VERSION: the worker installs, keeps the new files in a new cache and drops the old one.
//
// It only ever answers GET requests for its own origin and scope. Files come from the cache
// first; the page itself (a navigation) is asked of the same origin first, so a new deploy's
// index.html is never shadowed by an old one, and comes from the cache when that fails
// (offline). A file missing from the cache is asked of the same origin. Requests for any other
// origin are not touched at all, and the page's CSP refuses them anyway.
/* global VERSION, FILES */

// Caches are per origin, and a GitHub Pages user site shares its origin with every project
// (and fork or preview) on it: the scope is part of the name, so we only ever drop our own.
const PREFIX = `nines:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache, so the copies match this build
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // drop older builds of this scope only
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (!request.url.startsWith(self.registration.scope)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit && request.mode !== 'navigate') return hit;
      try {
        return await fetch(request);
      } catch (err) {
        if (hit) return hit; // offline: the page from the cache
        throw err;
      }
    }),
  );
});
