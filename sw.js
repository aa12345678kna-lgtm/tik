const CACHE_NAME = "ibrahim-studio-shell-v16";
const APP_SHELL = [
  "./",
  "./docs/",
  "./tiktok/",
  "./support/",
  "./assets/css/site.css",
  "./assets/js/runtime-capabilities.js",
  "./assets/js/engine-loader.js",
  "./assets/js/wudooh-engine.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./assets/ibrahim-al-faris-logo.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Always revalidate navigations so updated COOP/COEP response headers and
  // current HTML are not hidden behind an older Cache Storage entry.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(request).then(cached => cached || caches.match("./"))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match("./")))
  );
});
