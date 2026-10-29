/* global L */
import { esc, formatDistance, walkMinutes, distanceKm, formatDay, mapsUrl, directionsUrl, shortTags, hoursBadge, decodePolyline, formatDrive, storage } from "./util.js";
import { addBasemap } from "./basemap.js";
import { matches, onFilter } from "./filter.js";
import { app, onApp, emit, startLocation, hereInJapan, setDate } from "./state.js";
import { mountFilterBar, mountDateStrip } from "./filterbar.js";
import { dayAnchor, catEmoji, isInstagram } from "./data.js";

const JAPAN = L.latLngBounds([33.5, 129.5], [36.4, 141.2]);
let map, cluster, dayLayer, stayLayer, previewLayer, hereMarker, hereRing, sheet, root;
let firstFix = true, started = false;
const markers = new Map();
let stickyPin = null;

// The closer you zoom, the more each pin says: its name, then its name and tags, then a card
// with a photo. Sizes are screen pixels, estimated, and only used to keep labels apart.
const NAME_ZOOM = 15, TAGS_ZOOM = 17, PHOTO_ZOOM = 18, MAX_LABELS = 60;
const CARD = { w: 156, h: 154 }, FOCUS = { w: 240, h: 300 };
const previews = new Map();
let shown = [], focusId = null, revealFocus = false;

export function mountMap(el) {
  root = el;
  root.innerHTML = `
    <div id="map" aria-label="Map of places"></div>
    <div class="mapui top"><div class="ds"></div><div class="fb"></div></div>
    <div class="mapui side">
      <button type="button" class="fab route" aria-label="Show the drive" aria-pressed="true" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></svg>
      </button>
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
  root.querySelector(".route").addEventListener("click", () => {
    const on = !routeShown();
    storage.set("routeShown", on);
    drawDay();
    const r = app.data.trip.dayByDate[app.date]?.routeObj;
    if (on && r) toast(`${r.title}: ${formatDrive(r)}`);
  });
  sheet.addEventListener("click", (e) => { if (e.target.closest(".close")) closeSheet(); });
}

// Leaflet needs a visible container, so the map is built the first time its tab shows
export function showMap() {
  if (!started) build();
  setTimeout(() => {
    map.invalidateSize();
    if (frameLater) { frameLater = false; frame(false); }
  }, 0);
}

// The seam was dragged: cell sizes changed without a window resize
export function resized() {
  if (started) map.invalidateSize();
}

function build() {
  started = true;
  map = L.map("map", { zoomControl: false, attributionControl: true, maxBounds: JAPAN.pad(1.5), minZoom: 5, maxZoom: 19, tap: true })
    .fitBounds(JAPAN);
  addBasemap(map);
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 44, disableClusteringAtZoom: NAME_ZOOM, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => L.divIcon({ html: `<span>${c.getChildCount()}</span>`, className: "cluster", iconSize: [34, 34] }),
  }).addTo(map);
  stayLayer = L.layerGroup().addTo(map);
  dayLayer = L.layerGroup().addTo(map);
  // Cards sit under the pins so they never hide one; the tapped place's card sits over everything
  map.createPane("previews").style.zIndex = 590;
  map.createPane("focus").style.zIndex = 650;
  previewLayer = L.layerGroup().addTo(map);
  map.on("click", () => { closeSheet(); unfocus(); });
  map.on("moveend", () => {
    drawPreviews();
    if (revealFocus) { revealFocus = false; keepFocusInView(); }
  });

  onFilter(() => drawPlaces(true));
  onApp("date", () => { drawDay(); frame(); });
  onApp("plan", drawDay);
  onApp("places", () => { drawPlaces(false); drawDay(); });
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
    icon: L.divIcon({ className: "pin" + (p.precision === "area" ? " approx" : ""), html: `<span style="--c:${p.color}">${catEmoji(p)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    title: p.name, keyboard: true,
  });
  m.on("click", (e) => { L.DomEvent.stopPropagation(e); peek(p); });
  m.on("mouseover", () => emit("pinhover", { id: p.id, on: true }));
  m.on("mouseout", () => emit("pinhover", { id: p.id, on: false }));
  markers.set(p.id, m);
  return m;
}

// Light a pin from the list side (or any view that knows the place).
export function highlightPlace(id, on) {
  const m = markers.get(id);
  if (!m) return;
  const el = m.getElement();
  el?.classList.toggle("lit", on);
  m.setZIndexOffset(on ? 600 : 0);
}

// Keep one pin lit until something else takes over (the open sheet, a place page)
export function stickPin(id) {
  if (stickyPin && stickyPin !== id) highlightPlace(stickyPin, false);
  stickyPin = id;
  if (id) highlightPlace(id, true);
}

function drawPlaces(refit) {
  const pts = app.data.places.filter((p) => p.lat != null && matches(p));
  shown = pts;
  cluster.clearLayers();
  markers.clear();
  cluster.addLayers(pts.map(pin));
  if (stickyPin && markers.has(stickyPin)) highlightPlace(stickyPin, true);
  if (refit && pts.length && !app.date) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.08), { maxZoom: 16 });
  drawPreviews();
}

// Tapping a pin zooms in on it and opens its card above it, leaving room on screen for the card
function peek(p) {
  focusId = p.id;
  closeSheet();
  stickPin(p.id);
  const z = Math.max(map.getZoom(), TAGS_ZOOM);
  const lift = Math.min(110, map.getSize().y * 0.15);
  revealFocus = true;
  map.flyTo(map.unproject(map.project([p.lat, p.lng], z).subtract([0, lift]), z), z, { duration: 0.6 });
  drawPreviews();
}

// Once the map settles, the tapped card can sit under the search and filter rows: nudge it clear
function keepFocusInView() {
  const card = previews.get(focusId)?.getElement()?.querySelector(".pv");
  if (!card) return;
  const dy = root.querySelector(".mapui.top").getBoundingClientRect().bottom + 8 - card.getBoundingClientRect().top;
  if (dy > 0) map.panBy([0, -dy]);
}

function unfocus() {
  if (!focusId) return;
  focusId = null;
  stickPin(null);
  drawPreviews();
}

// Which pins get a label: the tapped one first, then those nearest the middle of the screen.
// Each takes the most detailed label the zoom allows that doesn't cover another label or pin,
// stepping down to a smaller one when it would; with no room even for its name it goes bare.
function drawPreviews() {
  if (!map) return;
  const z = map.getZoom(), photos = app.data.thumbs, want = new Map();
  if (z >= NAME_ZOOM) {
    const size = map.getSize(), mid = size.divideBy(2), taken = [];
    const cands = shown.map((p) => ({ p, pt: map.latLngToContainerPoint([p.lat, p.lng]) }))
      .filter(({ pt }) => pt.x > -FOCUS.w && pt.x < size.x + FOCUS.w && pt.y > -40 && pt.y < size.y + FOCUS.h)
      .sort((a, b) => (b.p.id === focusId) - (a.p.id === focusId) || a.pt.distanceTo(mid) - b.pt.distanceTo(mid));
    const hits = (box, o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t;
    const pins = cands.map(({ pt }) => ({ l: pt.x - 13, r: pt.x + 13, t: pt.y - 13, b: pt.y + 13, pt }));
    for (const { p, pt } of cands) {
      const tiers = p.id === focusId ? ["focus"] :
        ["photo", "tags", "name"].filter((t) => (t !== "photo" || (z >= PHOTO_ZOOM && photos[p.id])) && (t !== "tags" || z >= TAGS_ZOOM));
      for (const tier of tiers) {
        const box = labelBox(p, pt, tier);
        if (tier !== "focus" && (taken.some((o) => hits(box, o)) || pins.some((o) => o.pt !== pt && hits(box, o)))) continue;
        taken.push(box);
        want.set(p.id, tier);
        break;
      }
      if (want.size >= MAX_LABELS) break;
    }
  }
  for (const [id, m] of previews) {
    if (want.get(id) !== m.tier) { previewLayer.removeLayer(m); previews.delete(id); }
  }
  for (const [id, tier] of want) {
    if (!previews.has(id)) { const m = previewMarker(app.data.byId[id], tier); previews.set(id, m); previewLayer.addLayer(m); }
  }
}

// Where a label would sit on screen. Name and tag labels hang under the pin, cards stand above it.
function labelBox(p, pt, tier) {
  if (tier === "focus" || tier === "photo") {
    const { w, h } = tier === "focus" ? FOCUS : CARD;
    return { l: pt.x - w / 2, r: pt.x + w / 2, t: pt.y - 16 - h, b: pt.y - 10 };
  }
  const chars = tier === "tags" ? Math.max(p.name.length, labelTags(p).join(" · ").length * 0.85) : p.name.length;
  const w = Math.min(tier === "tags" ? 180 : 150, chars * 7 + 18), h = tier === "tags" ? 38 : 22;
  return { l: pt.x - w / 2, r: pt.x + w / 2, t: pt.y + 12, b: pt.y + 14 + h };
}

const labelTags = (p) => [p.categories[0], ...shortTags(p).slice(0, 1)];

function previewMarker(p, tier) {
  const focus = tier === "focus", card = focus || tier === "photo";
  const photo = card && app.data.thumbs[p.id];
  const l = p.main;
  let html;
  if (!card) {
    html = `<div class="pl" style="--c:${p.color}"><b>${esc(p.name)}</b>${tier === "tags" ? `<small>${esc(labelTags(p).join(" · "))}</small>` : ""}</div>`;
  } else {
    const tags = focus ? [p.categories[0], ...shortTags(p)].slice(0, 4) : labelTags(p).slice(0, 1);
    const day = app.date && app.data.trip?.dayByDate[app.date];
    const item = focus && day?.items.find((i) => i.place === p.id);
    html = `<div class="pv${focus ? " on" : ""}" style="--c:${p.color}">
    ${photo ? `<img src="${esc(photo.src)}" alt="" onerror="this.remove()">` : ""}
    ${focus ? `<p class="kicker">${esc(p.area)}${p.source === "chat" ? " · added by chat" : ""}</p>` : ""}
    <b>${esc(p.name)}</b>
    ${item ? `<p class="planned">On the plan${item.time ? ` at ${esc(item.time)}` : ""}${item.notes ? ` · ${esc(item.notes)}` : ""}</p>` : ""}
    <span class="tags">${tags.map((t) => `<i>${esc(t)}</i>`).join("")}</span>
    ${focus ? `${hoursBadge(p, app.date)}
      <p class="desc">${esc(l.desc)}</p>
      ${p.precision === "area" ? `<p class="meta warn">Pin shows the area only; check the address before you go.</p>` : ""}
      ${distLine(p)}
      ${photo?.credit ? `<p class="credit">Photo: ${esc(photo.credit)}</p>` : ""}
      <div class="actions">
        <a class="btn primary" href="#/place/${p.id}">Details</a>
        <a class="btn" href="${esc(directionsUrl(p) || l.mapUrl)}" target="_blank" rel="noopener">Directions ↗</a>
        ${l.url ? `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${isInstagram(l.url) ? "Instagram" : "Website"} ↗</a>` : ""}
      </div>` : ""}
  </div>`;
  }
  const m = L.marker([p.lat, p.lng], {
    pane: focus ? "focus" : "previews", keyboard: false,
    icon: L.divIcon({ className: "preview", html, iconSize: [0, 0], iconAnchor: [0, 0] }),
  });
  m.tier = tier;
  m.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    if (e.originalEvent.target.closest("a")) return;
    if (focus) location.hash = `#/place/${p.id}`;
    else peek(p);
  });
  return m;
}

const STAY_ICON = {
  airbnb: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/></svg>`,
  hotel: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 19V6h2v8h7V9h8a3 3 0 0 1 3 3v7h-2v-3H4v3z"/><circle cx="7.5" cy="11" r="2"/></svg>`,
};

function drawStays() {
  stayLayer.clearLayers();
  for (const s of app.data.trip?.stays || []) {
    if (s.lat == null) continue;
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: `stay ${s.type || ""}`, html: `${STAY_ICON[s.type] || STAY_ICON.airbnb}<b>${esc(s.name)}</b>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      zIndexOffset: 1000, title: s.name, keyboard: true,
    }).on("click", (e) => { L.DomEvent.stopPropagation(e); openStay(s); }).addTo(stayLayer);
  }
}

// A driving day's road line and its stops come and go together with the route button
export const routeShown = () => storage.get("routeShown", true);

// The chosen day's plan as numbered stops, joined by the road on a driving day
function drawDay() {
  dayLayer.clearLayers();
  const day = app.date && app.data.trip?.dayByDate[app.date];
  const btn = root.querySelector(".route");
  btn.hidden = !day?.routeObj;
  btn.setAttribute("aria-pressed", String(routeShown()));
  if (!day) return;
  if (day.routeObj) {
    if (!routeShown()) return;
    const line = decodePolyline(day.routeObj.path);
    L.polyline(line, { className: "route-casing", interactive: false }).addTo(dayLayer);
    L.polyline(line, { className: "route-line", interactive: false }).addTo(dayLayer);
  }
  let n = 0;
  for (const it of day.items) {
    if (it.lat == null) continue;
    n += 1;
    L.marker([it.lat, it.lng], {
      icon: L.divIcon({ className: "stop", html: `<span>${n}</span>`, iconSize: [26, 26] }), zIndexOffset: 900, title: it.title,
    }).on("click", (e) => { L.DomEvent.stopPropagation(e); it.placeObj ? peek(it.placeObj) : openItem(it, day); }).addTo(dayLayer);
  }
}

// A hidden map has no size to fit a day into, so a day picked from the plan is framed on arrival
let frameLater = false;
function frame(animate = true) {
  if (!map.getContainer().offsetHeight) { frameLater = true; return; }
  if (app.date) {
    const day = app.data.trip.dayByDate[app.date];
    const pts = day.items.filter((i) => i.lat != null).map((i) => [i.lat, i.lng]);
    const a = dayAnchor(app.data.trip, app.date);
    if (a) pts.push([a.lat, a.lng]);
    if (day.routeObj && routeShown()) {
      // A long drive fills the screen: fit the road itself, clear of the controls on top and side
      const top = root.querySelector(".mapui.top").offsetHeight;
      // Whole zoom steps would leave it at half the screen, so this one fit snaps to quarter steps
      map.options.zoomSnap = 0.25;
      map.fitBounds(L.latLngBounds(decodePolyline(day.routeObj.path)), { paddingTopLeft: [44, top + 8], paddingBottomRight: [64, 16], animate });
      map.options.zoomSnap = 1;
    } else if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15, animate });
    const r = day.routeObj && routeShown() ? day.routeObj : null;
    toast(r ? `${formatDay(app.date)}: ${r.title}, ${formatDrive(r)}` : `Looking ahead to ${formatDay(app.date)}${a ? ` around ${a.label}` : ""}`);
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

function closeSheet() {
  sheet.hidden = true;
  stickPin(null);
}

export function focusPlace(p) {
  showMap();
  // Jump without animating: a long animated zoom can be cut short by the map's first layout
  focusId = p.id;
  closeSheet();
  stickPin(p.id);
  revealFocus = true;
  map.setView([p.lat, p.lng], TAGS_ZOOM, { animate: false });
  drawPreviews();
}

// The place page is up on the left: bring its pin into view without opening the sheet
export function revealPlace(p) {
  if (!started || !map) return;
  if (!p) { if (sheet.hidden && !focusId) stickPin(null); return; }
  // Far out, the pin is buried in a cluster: zoom to it. Nearby, just nudge the view.
  const z = Math.max(map.getZoom(), 13);
  map.setView([p.lat, p.lng], z, { animate: true });
  stickPin(p.id);
}
