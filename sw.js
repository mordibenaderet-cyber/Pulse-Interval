/* Pulse Interval 3: offline app shell; network-first HTML updates, cached assets. */
const CACHE = 'pulse-interval-v3.2026-11-05b';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pulse-interval-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok) { const copy=response.clone(); caches.open(CACHE).then(cache => cache.put(event.request,copy)); }
      return response;
    }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
