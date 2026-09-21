// App-shell cache. Fresh files are fetched whenever online; bump CACHE_VERSION on release to drop stale entries.

const CACHE_VERSION = `ct-v3`;
const NETWORK_TIMEOUT_MS = 3000;
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
  evt.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener(`activate`, (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((keysArr) => Promise.all(keysArr.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Same-origin GETs: network first so a deploy shows up on the next open. The cache answers when the network
// fails, or when it hasn't answered within NETWORK_TIMEOUT_MS (a connection that's up but passing nothing).
self.addEventListener(`fetch`, (evt) => {
  const url = new URL(evt.request.url);
  if (evt.request.method !== `GET` || url.origin !== self.location.origin) return;
  evt.respondWith(networkFirst(evt));
});

// After one timeout the network is treated as slow for a while, and cached files are served at once. Without
// this, each level of the load (page, app.js, its imports) would wait out its own timeout in turn.
const SLOW_NETWORK_MEMORY_MS = 30000;
let slowNetworkUntil = 0;

async function networkFirst(evt) {
  const fromNetwork = fetch(evt.request).then((res) => {
    if (res.ok) {
      // Clone now: once `res` is returned its body belongs to the page and can't be cloned.
      const copy = res.clone();
      const stored = caches.open(CACHE_VERSION).then((cache) => cache.put(evt.request, copy)).catch(() => {});
      try { evt.waitUntil(stored); } catch { /* The event already settled (cache answered first). The put still runs. */ }
    }
    return res;
  });
  fromNetwork.catch(() => {}); // Handled below; this stops an unhandled rejection when the cache answers first.

  if (Date.now() < slowNetworkUntil) {
    const cachedNow = await caches.match(evt.request, { ignoreSearch: true });
    if (cachedNow) return cachedNow;
  }

  const timedOut = new Promise((resolve) => { setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
  try {
    const res = await Promise.race([fromNetwork, timedOut]);
    if (res) return res;
    slowNetworkUntil = Date.now() + SLOW_NETWORK_MEMORY_MS;
  } catch {
    // Network failed outright: fall through to the cache.
  }
  const cached = await caches.match(evt.request, { ignoreSearch: true });
  return cached ?? fromNetwork;
}
