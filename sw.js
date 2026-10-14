/* =========================================================================
 * sw.js — Permite abrir la app sin conexión.
 * Archivos de la app: se sirven desde la caché y se actualizan en segundo plano
 * (la versión nueva se ve en la siguiente apertura). Precios, tasas y la nube
 * van siempre a la red: nunca se guardan aquí.
 * ========================================================================= */
var CACHE = 'mis-finanzas-v7';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/config.js', 'js/calc.js', 'js/store.js', 'js/prices.js', 'js/charts.js', 'js/advisor.js', 'js/backups.js', 'js/sync.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // Solo archivos propios de la app; lo externo (Binance, Supabase…) va directo a la red
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(e.request, { ignoreSearch: true }).then(function (cached) {
      var fresh = fetch(e.request).then(function (res) {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || fresh;
    });
  }));
});
