// App-shell cache. Fresh files are fetched whenever online; bump CACHE_VERSION on release to drop stale entries.

const CACHE_VERSION = `ct-v2`;
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

// Same-origin GETs: network first so a deploy shows up on the next open, cache as the offline fallback.
self.addEventListener(`fetch`, (evt) => {
  const url = new URL(evt.request.url);
  if (evt.request.method !== `GET` || url.origin !== self.location.origin) return;
  evt.respondWith(
    fetch(evt.request).then((res) => {
      if (res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(evt.request, res.clone()));
      return res;
    }).catch(() => caches.match(evt.request, { ignoreSearch: true })),
  );
});
