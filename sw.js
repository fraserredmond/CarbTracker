// App-shell cache. Fresh files are fetched whenever online; bump CACHE_VERSION on release to drop stale entries.

const CACHE_VERSION = `ct-v4`;
const NETWORK_TIMEOUT_MS = 3000;
const FRESH_PAGE_SUBRESOURCE_TIMEOUT_MS = 10000;
const SLOW_NETWORK_MEMORY_MS = 30000;
const SHELL_FILES = [
  `./`,
  `./index.html`,
  `./app.css`,
  `./manifest.json`,
  `./js/app.js`,
  `./js/api.js`,
  `./js/icons.js`,
  `./js/store.js`,
  `./js/sync.js`,
  `./js/theme.js`,
  `./js/util.js`,
  `./icons/icon.svg`,
  `./icons/icon-192.png`,
  `./icons/icon-512.png`,
];

self.addEventListener(`install`, (evt) => {
  // `reload` skips the browser's HTTP cache, which would otherwise hand back files up to their max-age old.
  const requestsArr = SHELL_FILES.map((path) => new Request(path, { cache: `reload` }));
  evt.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(requestsArr)).then(() => self.skipWaiting()));
});

self.addEventListener(`activate`, (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((keysArr) => Promise.all(keysArr.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs: network first so a deploy shows up on the next open. The cache answers when the network
// fails, or when it hasn't answered within the timeout (a connection that's up but passing nothing).
//
// One page load must not mix new and old files, so the page's own request decides the mode for that load:
//   - page came from the network ("fresh"): its files wait much longer for the network before falling back.
//   - page came from the cache ("cached"): its files come from the cache too, refreshed in the background.
self.addEventListener(`fetch`, (evt) => {
  const url = new URL(evt.request.url);
  if (evt.request.method !== `GET` || url.origin !== self.location.origin) return;
  evt.respondWith(networkFirst(evt));
});

const clientLoadModes = new Map(); // clientId -> `fresh` | `cached`. Lost if the worker restarts, which only costs a default race.
let slowNetworkUntil = 0; // After a timeout the next page request is answered from the cache at once.

function rememberLoadMode(evt, mode) {
  if (!evt.resultingClientId) return;
  if (clientLoadModes.size > 50) clientLoadModes.clear();
  clientLoadModes.set(evt.resultingClientId, mode);
}

async function networkFirst(evt) {
  const isNavigation = evt.request.mode === `navigate`;
  const loadMode = isNavigation ? `` : (clientLoadModes.get(evt.clientId) ?? ``);

  // `no-cache` revalidates with the server instead of trusting the browser's HTTP cache.
  const fromNetwork = fetch(evt.request, { cache: `no-cache` }).then((res) => {
    if (res.ok) {
      // Clone now: once `res` is returned its body belongs to the page and can't be cloned.
      const copy = res.clone();
      const stored = caches.open(CACHE_VERSION).then((cache) => cache.put(evt.request, copy)).catch(() => {});
      try { evt.waitUntil(stored); } catch { /* The event already settled (cache answered first). The put still runs. */ }
    }
    return res;
  });
  fromNetwork.catch(() => {}); // Handled below; this stops an unhandled rejection when the cache answers first.

  const isCacheFirst = (loadMode === `cached`) || (loadMode !== `fresh` && Date.now() < slowNetworkUntil);
  if (isCacheFirst) {
    const cachedNow = await caches.match(evt.request, { ignoreSearch: true });
    if (cachedNow) {
      if (isNavigation) rememberLoadMode(evt, `cached`);
      return cachedNow;
    }
  }

  const timeoutMs = (loadMode === `fresh`) ? FRESH_PAGE_SUBRESOURCE_TIMEOUT_MS : NETWORK_TIMEOUT_MS;
  const timedOut = new Promise((resolve) => { setTimeout(() => resolve(null), timeoutMs); });
  try {
    const res = await Promise.race([fromNetwork, timedOut]);
    if (res) {
      if (isNavigation) rememberLoadMode(evt, `fresh`);
      return res;
    }
    slowNetworkUntil = Date.now() + SLOW_NETWORK_MEMORY_MS;
  } catch {
    // Network failed outright: fall through to the cache.
  }
  const cached = await caches.match(evt.request, { ignoreSearch: true });
  if (cached && isNavigation) rememberLoadMode(evt, `cached`);
  return cached ?? fromNetwork;
}
