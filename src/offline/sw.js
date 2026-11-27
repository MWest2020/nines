// The service worker: it keeps the built game so it runs with the network off once loaded
// (ARCHITECTURE.md, Loading content offline; docs/how-to/verify-offline.md).
//
// Hand-written, no dependency. tools/vite-plugin-sw.ts prepends two constants at build time:
// VERSION, a hash of every built file, and FILES, the list of them. A new build is a new
// VERSION: the worker installs, keeps the new files in a new cache and drops the old one.
//
// It only ever answers GET requests for its own origin, from its cache first. A file that is
// not in the cache (there is none in a complete build) is asked of the same origin; requests
// for any other origin are not touched at all, and the page's CSP refuses them anyway.
/* global VERSION, FILES */

const CACHE = `nines-${VERSION}`;

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
  // Other sites on the same host (a GitHub Pages user site) have caches too: drop only ours.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('nines-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request, { ignoreSearch: true });
      return hit ?? fetch(request);
    }),
  );
});
