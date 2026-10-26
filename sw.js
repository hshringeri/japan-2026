// Offline support. The app's own files go network first so updates land straight away,
// with the cache as a fallback underground. Map tiles and CDN libraries go cache first.
const APP = "app-v3";
const TILES = "tiles-v1";
const MAX_TILES = 1500;

const SHELL = [
  "./", "index.html", "app.css", "guide.css", "manifest.webmanifest",
  "js/app.js", "js/data.js", "js/filter.js", "js/filterbar.js", "js/guide.js", "js/list.js",
  "js/map.js", "js/basemap.js", "js/place.js", "js/plan.js", "js/state.js", "js/util.js", "js/split.js",
  "data/places.json", "data/guide.json", "data/taxonomy.json", "data/trip.json",
  "img/icon.svg", "img/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (["tiles.openfreemap.org", "cyberjapandata.gsi.go.jp", "cdnjs.cloudflare.com", "unpkg.com"].includes(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") { c.put(e.request, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }

  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
  }
});
