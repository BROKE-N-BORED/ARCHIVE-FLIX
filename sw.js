/* ARCHIVEFLIX service worker. Caches the app shell so the app opens
   offline, and runtime caches posters with a cap. Catalog and metadata
   calls always go to the network, and video files are never cached.
   No build step, no dependencies. */

var SHELL_CACHE = "archiveflix-shell-v1";
var POSTER_CACHE = "archiveflix-posters-v1";
var SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];
var POSTER_MAX = 100;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== SHELL_CACHE && key !== POSTER_CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function trimPosterCache(cache) {
  cache.keys().then(function (keys) {
    if (keys.length > POSTER_MAX) {
      cache.delete(keys[0]).then(function () { trimPosterCache(cache); });
    }
  });
}

function cacheFirstPoster(request) {
  return caches.open(POSTER_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        /* Poster responses may be opaque (no CORS headers), which is
           fine for display; cache those too. */
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          cache.put(request, copy).then(function () { trimPosterCache(cache); });
        }
        return res;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);

  /* Archive search and metadata: always network, never cached. */
  if (url.hostname === "archive.org" &&
      (url.pathname.indexOf("/advancedsearch.php") === 0 ||
       url.pathname.indexOf("/metadata/") === 0)) {
    return;
  }

  /* Posters: cache first, capped. */
  if (url.hostname === "archive.org" && url.pathname.indexOf("/services/img/") === 0) {
    event.respondWith(cacheFirstPoster(event.request));
    return;
  }

  /* App shell and navigation: cached shell first, network next, and
     the cached home page when offline. Video files and anything else
     cross-origin fall through to the network untouched. */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(event.request).catch(function () {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("", { status: 504, statusText: "Offline" });
        });
      })
    );
  }
});
