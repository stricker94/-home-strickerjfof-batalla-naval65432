/* Batalla Naval — service worker: permite instalar el juego y jugar sin conexión.
 * Red primero: con conexión siempre se sirve la versión más reciente y se guarda
 * una copia; sin conexión se usa la copia guardada. */
var CACHE = "batalla-naval-v1";
var CORE = [
  "./",
  "index.html",
  "styles.css",
  "game.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(CORE); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;

  // Archivos del juego: se revalidan con el servidor (no-cache) para que una
  // versión nueva llegue en la siguiente carga aunque el hosting mande max-age.
  var net = sameOrigin ? fetch(req.url, { cache: "no-cache" }) : fetch(req);
  e.respondWith(
    net.then(function (res) {
      if (res && (res.ok || res.type === "opaque")) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
    })
  );
});
