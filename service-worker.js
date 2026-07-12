const CACHE_VERSION = "aitor-soluciones-v5";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/assets/styles.css?v=5",
  "/assets/script.js?v=5",
  "/assets/img/logo-aitor-soluciones.webp",
  "/assets/img/favicon.png",
  "/assets/img/apple-touch-icon.png",
  "/assets/img/pwa-192.png",
  "/assets/img/pwa-512.png",
  "/assets/img/pwa-maskable-192.png",
  "/assets/img/pwa-maskable-512.png",
  "/assets/img/hero-before.webp",
  "/assets/img/hero-after.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Do not interfere with external services such as WhatsApp, Google Maps or email.
  if (url.origin !== self.location.origin) return;

  // HTML navigation: network first, offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline.html");
        })
    );
    return;
  }

  // Static assets: cache first, update in background.
  if (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request)
          .then(response => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else: network first.
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
