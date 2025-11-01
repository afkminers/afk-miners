const CACHE_VERSION = 'afk-miners-mobile-v1';
const CACHE_NAME = CACHE_VERSION;
const CORE_ASSETS = [
  '/',
  '/app.html',
  '/offline.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/play.js',
  '/js/combat/actions.js',
  '/js/engine/runtime-flags.js',
  '/js/ui/mobile-hud.js',
  '/img/ui/pixel-noise.png',
  '/img/ui/dither-bg.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match('/offline.html'));
    })
  );
});
