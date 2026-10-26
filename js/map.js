/* global L */
import { esc, formatDistance, walkMinutes, distanceKm, formatDay, mapsUrl, directionsUrl, TILES } from "./util.js";
import { matches, onFilter } from "./filter.js";
import { app, onApp, startLocation, hereInJapan, setDate } from "./state.js";
import { mountFilterBar, mountDateStrip } from "./filterbar.js";
import { dayAnchor } from "./data.js";

const JAPAN = L.latLngBounds([33.5, 129.5], [36.4, 141.2]);
let map, cluster, dayLayer, stayLayer, hereMarker, hereRing, sheet, root;
let firstFix = true, started = false;

export function mountMap(el) {
  root = el;
  root.innerHTML = `
    <div id="map" aria-label="Map of places"></div>
    <div class="mapui top"><div class="ds"></div><div class="fb"></div></div>
    <div class="mapui side">
      <button type="button" class="fab locate" aria-label="Show my location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5" fill="none"/></svg>
      </button>
    </div>
    <p class="maptoast" hidden></p>
    <section class="sheet" hidden aria-live="polite"></section>`;
  mountDateStrip(root.querySelector(".ds"));
  mountFilterBar(root.querySelector(".fb"), { compact: true });
  sheet = root.querySelector(".sheet");
  root.querySelector(".locate").addEventListener("click", locate);
  sheet.addEventListener("click", (e) => { if (e.target.closest(".close")) closeSheet(); });
}

// Leaflet needs a visible container, so the map is built the first time its tab shows
export function showMap() {
  if (!started) build();
  setTimeout(() => map.invalidateSize(), 0);
}

function build() {
  started = true;
  map = L.map("map", { zoomControl: false, attributionControl: true, maxBounds: JAPAN.pad(1.5), minZoom: 5, tap: true })
    .fitBounds(JAPAN);
  L.tileLayer(TILES, {
    maxZoom: 19, maxNativeZoom: 18, minZoom: 5,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  }).addTo(map);
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 44, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => L.divIcon({ html: `<span>${c.getChildCount()}</span>`, className: "cluster", iconSize: [34, 34] }),
  }).addTo(map);
  stayLayer = L.layerGroup().addTo(map);
  dayLayer = L.layerGroup().addTo(map);
  map.on("click", closeSheet);

  onFilter(() => drawPlaces(true));
  onApp("date", () => { drawDay(); frame(); });
  onApp("here", drawHere);
  drawStays();
  drawPlaces(false);
  drawDay();
  // The first framing must not animate, or its animation can land after a jump to a place and undo it
  frame(false);
  drawHere();
  // Ask for location when the map first opens; the browser remembers the answer
  startLocation();
}

function pin(p) {
  const m = L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: "pin" + (p.precision === "area" ? " approx" : ""), html: `<span style="--c:${p.color}"></span>`, iconSize: [22, 22] }),
    title: p.name, keyboard: true,
  });
  m.on("click", (e) => { L.DomEvent.stopPropagation(e); openPlace(p); });
  return m;
}

function drawPlaces(refit) {
  const pts = app.data.places.filter((p) => p.lat != null && matches(p));
  cluster.clearLayers();
  cluster.addLayers(pts.map(pin));
  if (refit && pts.length && !app.date) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.08), { maxZoom: 16 });
}

function drawStays() {
  stayLayer.clearLayers();
  for (const s of app.data.trip?.stays || []) {
    if (s.lat == null) continue;
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: "stay", html: `<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/></svg>`, iconSize: [30, 30] }),
      zIndexOffset: 1000, title: s.name,
    }).on("click", (e) => { L.DomEvent.stopPropagation(e); openStay(s); }).addTo(stayLayer);
  }
}

// The chosen day's plan as numbered stops
function drawDay() {
  dayLayer.clearLayers();
  const day = app.date && app.data.trip?.dayByDate[app.date];
  if (!day) return;
  let n = 0;
  for (const it of day.items) {
    if (it.lat == null) continue;
    n += 1;
    L.marker([it.lat, it.lng], {
      icon: L.divIcon({ className: "stop", html: `<span>${n}</span>`, iconSize: [26, 26] }), zIndexOffset: 900, title: it.title,
    }).on("click", (e) => { L.DomEvent.stopPropagation(e); it.placeObj ? openPlace(it.placeObj, it) : openItem(it, day); }).addTo(dayLayer);
  }
}

function frame(animate = true) {
  if (app.date) {
    const day = app.data.trip.dayByDate[app.date];
    const pts = day.items.filter((i) => i.lat != null).map((i) => [i.lat, i.lng]);
    const a = dayAnchor(app.data.trip, app.date);
    if (a) pts.push([a.lat, a.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15, animate });
    toast(`Looking ahead to ${formatDay(app.date)}${a ? ` around ${a.label}` : ""}`);
  } else if (hereInJapan()) {
    map.setView([app.here.lat, app.here.lng], 15, { animate });
  } else {
    const pts = app.data.places.filter((p) => p.lat != null && matches(p));
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.08), { maxZoom: 16, animate });
  }
}

function drawHere() {
  const btn = root.querySelector(".locate");
  btn.classList.toggle("busy", app.locating);
  if (!app.here) {
    if (app.locationError) toast(app.locationError);
    return;
  }
  const ll = [app.here.lat, app.here.lng];
  if (!hereMarker) {
    hereRing = L.circle(ll, { radius: app.here.accuracy, className: "here-ring", interactive: false }).addTo(map);
    hereMarker = L.marker(ll, { icon: L.divIcon({ className: "here", iconSize: [18, 18] }), interactive: false, zIndexOffset: 2000 }).addTo(map);
  } else {
    hereMarker.setLatLng(ll);
    hereRing.setLatLng(ll).setRadius(app.here.accuracy);
  }
  btn.classList.add("live");
  if (firstFix && !app.date && hereInJapan()) map.setView(ll, 15);
  firstFix = false;
}

function locate() {
  if (app.date) setDate(null);
  if (!app.here) { startLocation(); toast("Finding you…"); return; }
  if (!hereInJapan()) { toast("You're not in Japan yet. The map will follow you once you land."); return; }
  map.setView([app.here.lat, app.here.lng], Math.max(map.getZoom(), 15));
}

let toastTimer;
function toast(msg) {
  const t = root.querySelector(".maptoast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function distLine(p) {
  if (!hereInJapan() || app.date) return "";
  const km = distanceKm(app.here, p);
  return `<span class="dist">${formatDistance(km)} away${km < 2.5 ? ` · ${walkMinutes(km)} min walk` : ""}</span>`;
}

export function openPlace(p, item, pan = true) {
  const l = p.main;
  sheet.innerHTML = `
    <button type="button" class="close" aria-label="Close">×</button>
    <p class="kicker"><span class="dot" style="--c:${p.color}"></span>${esc(p.area)} · ${esc(p.categories.join(", "))}</p>
    <h2>${esc(p.name)}</h2>
    ${item ? `<p class="planned">On the plan${item.time ? ` at ${esc(item.time)}` : ""}${item.notes ? ` · ${esc(item.notes)}` : ""}</p>` : ""}
    <p class="desc">${esc(l.desc)}</p>
    <p class="meta">${esc(l.address)}${l.info ? ` · ${esc(l.info)}` : ""}</p>
    ${p.geoNote ? `<p class="meta geonote">${esc(p.geoNote)}</p>` : ""}
    ${p.precision === "area" ? `<p class="meta warn">Pin shows the area only; check the address before you go.</p>` : ""}
    ${distLine(p)}
    <div class="actions">
      <a class="btn primary" href="#/place/${p.id}">Details</a>
      ${l.url ? `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
      <a class="btn" href="${esc(directionsUrl(p) || l.mapUrl)}" target="_blank" rel="noopener">Directions ↗</a>
    </div>`;
  sheet.hidden = false;
  if (pan) map.panTo([p.lat, p.lng], { animate: true });
}

function openStay(s) {
  sheet.innerHTML = `
    <button type="button" class="close" aria-label="Close">×</button>
    <p class="kicker">Where we're staying · ${esc(formatDay(s.from))} to ${esc(formatDay(s.to))}</p>
    <h2>${esc(s.name)}</h2>
    ${s.address ? `<p class="meta">${esc(s.address)}</p>` : ""}
    ${s.precision && s.precision !== "exact" ? `<p class="meta warn">${esc(s.precisionNote || "Approximate location")}</p>` : ""}
    ${s.notes ? `<p class="desc">${esc(s.notes)}</p>` : ""}
    <div class="actions">
      ${s.url ? `<a class="btn primary" href="${esc(s.url)}" target="_blank" rel="noopener">Booking ↗</a>` : ""}
      <a class="btn" href="${esc(directionsUrl(s))}" target="_blank" rel="noopener">Directions ↗</a>
    </div>`;
  sheet.hidden = false;
}

function openItem(it, day) {
  sheet.innerHTML = `
    <button type="button" class="close" aria-label="Close">×</button>
    <p class="kicker">${esc(formatDay(day.date))}${it.time ? ` · ${esc(it.time)}` : ""}</p>
    <h2>${esc(it.title)}</h2>
    ${it.address ? `<p class="meta">${esc(it.address)}</p>` : ""}
    ${it.notes ? `<p class="desc">${esc(it.notes)}</p>` : ""}
    <div class="actions">
      ${it.url ? `<a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener">Link ↗</a>` : ""}
      <a class="btn" href="${esc(directionsUrl(it) || mapsUrl(it))}" target="_blank" rel="noopener">Directions ↗</a>
    </div>`;
  sheet.hidden = false;
}

function closeSheet() { sheet.hidden = true; }

export function focusPlace(p) {
  showMap();
  // Jump without animating: a long animated zoom can be cut short by the map's first layout
  map.setView([p.lat, p.lng], 16, { animate: false });
  openPlace(p, null, false);
}
