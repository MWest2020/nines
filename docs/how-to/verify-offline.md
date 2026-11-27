# Verify that Nines runs offline and makes no outside requests

Two promises from AGENTS.md: `npm ci && npm run build` gives a static site that keeps working
with the network off once loaded, and the game makes no request outside its own origin.
`tests/e2e/smoke.py` checks both on every pull request (below). This page is the same check by
hand, in a browser's devtools, for a release or after a change to how files are loaded.

## How offline works

`dist/sw.js` is a small hand-written service worker (`src/offline/sw.js`; the build adds the
list of built files and a version that is a hash of all of them). On the first visit it stores
every file of the build in the cache `nines:<scope>:<version>`. After that the game's files are
answered from that cache; the page itself is asked of the server first and taken from the cache
when that fails, so a reload with the network off still works. A new deploy has a new version:
the next online visit gets the new page and files, and the new worker replaces the cache. The worker only answers requests for its own origin and never touches others; the
page's Content Security Policy refuses those anyway. The Android app does not register it: its
files are inside the APK.

## By hand, in Chrome or Edge

1. Build and serve `dist/` over HTTP, from a sub-path like GitHub Pages:

   ```sh
   npm ci && npm run build
   mkdir -p /tmp/site && rm -rf /tmp/site/nines && cp -r dist /tmp/site/nines
   python3 -m http.server 8000 --bind 127.0.0.1 --directory /tmp/site
   ```

   Open `http://127.0.0.1:8000/nines/` (service workers need https or localhost). Or use the
   deployed site, https://mwest2020.github.io/nines/.
2. Open devtools (F12), tab **Network**. Tick **Preserve log**. In **Application** > **Service
   workers**, leave **Bypass for network** unticked. Reload.
3. **No outside requests.** In the Network filter box type `-domain:127.0.0.1` (or
   `-domain:mwest2020.github.io` on the deployed site). The list must be empty: no fonts, no
   analytics, no CDN. Without the filter, every row's domain is the game's own (and `data:` or
   `blob:` URLs, which Phaser makes in memory).
4. **The service worker.** Tab **Application** > **Service workers**: `sw.js` is *activated and
   running* for the `/nines/` scope. **Application** > **Cache storage** has one
   `nines:<scope>:<hash>` cache with `./`, `index.html`, the files in `assets/` and the licence
   file.
5. **Offline.** Tab **Network**, throttling menu (it says *No throttling*) > **Offline**. Reload
   (Ctrl+R). The game boots; the Network rows say *(ServiceWorker)* in the Size column and none
   is red. Walk into the server room and open a terminal: it all works.
6. Set throttling back to *No throttling*.

Firefox: the same steps; service workers are under `about:debugging#/runtime/this-firefox`, and
offline is **File > Work Offline**.

## Automatically

```sh
npm run build
timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \
  uv run -q --with-requirements tests/e2e/requirements.txt python -u tests/e2e/smoke.py --only desktop
```

It loads the game once, waits until the service worker controls the page and checks that it
keeps every built file, switches the browser context offline (`context.set_offline(True)`),
reloads, and plays the three quests, the shop, the Career Trail and the sample cameo with the
network off; its test server counts requests and none may arrive while offline. It listens to every request of the context (the service
worker's included) and fails on any outside the origin, on any failed request and on any page
error. CI runs the whole smoke test on every pull request and on main.

The mechanical guards: `tests/guards.test.ts` (no network API or remote URL in `src/`, the
service worker's single same-origin `fetch` after its origin check, the CSP) and
`npm run check:dist` (the same over everything that ships, Phaser included).
