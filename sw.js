/* =========================================================================
 * sw.js — Permite abrir la app sin conexión.
 * Archivos de la app: primero la RED (siempre la versión publicada, todos los
 * archivos de la misma versión) y, si no hay conexión o tarda más de 4 s, la
 * copia guardada. Antes se servía primero la copia y se actualizaba archivo por
 * archivo en segundo plano: tras varias publicaciones seguidas podían mezclarse
 * archivos de versiones distintas y la app quedaba en blanco.
 * Precios, tasas y la nube van siempre a la red: nunca se guardan aquí.
 * ========================================================================= */
var CACHE = 'mis-finanzas-v9';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/config.js', 'js/calc.js', 'js/store.js', 'js/prices.js', 'js/charts.js', 'js/advisor.js', 'js/backups.js', 'js/sync.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
var TIMEOUT = 4000;

self.addEventListener('install', function (e) {
  // cache: 'reload' = pedir al servidor, no a la caché HTTP del navegador (que podía tener archivos viejos)
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
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
    var fromCache = function () {
      return cache.match(e.request, { ignoreSearch: true }).then(function (c) {
        return c || (e.request.mode === 'navigate' ? cache.match('index.html') : undefined);
      });
    };
    var net = fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    });
    // Red primero; si falla o tarda demasiado, la copia guardada (y si no hay copia, se espera a la red)
    var timer = new Promise(function (res) { setTimeout(res, TIMEOUT); }).then(fromCache);
    return Promise.race([net.catch(fromCache), timer.then(function (c) { return c || net; })])
      .then(function (r) { return r || net; });
  }));
});
