export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// A place's photo. Ones from Wikimedia found by location show the street, not the place itself.
export function photoImg(p, cls = "") {
  if (!p.photo) return "";
  return `<img class="${cls}" src="${esc(p.photo.src)}" alt="" title="Photo: ${esc(p.photo.credit)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
export function photoFigure(p) {
  if (!p.photo) return "";
  const { link, credit, source } = p.photo;
  const note = source === "site" ? "Photo from" : source === "commons-name" ? "Photo:" : "Nearby, not the place itself ·";
  return `<figure class="photo">${photoImg(p)}<figcaption>${note} <a href="${esc(link)}" target="_blank" rel="noopener">${esc(credit)}</a></figcaption></figure>`;
}

// Lowercase, strip accents and punctuation so "Shimo-kita" finds "Shimokitazawa"
export const fold = (s) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, "");

export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Distance from a place to an anchor that may be several points (a day's stops)
export const nearestKm = (anchor, p) =>
  anchor?.points ? Math.min(...anchor.points.map((q) => distanceKm(q, p))) : distanceKm(anchor, p);

export function formatDistance(km) {
  if (km == null) return "";
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Walking at ~4.5 km/h along streets that run ~1.3x the straight line
export const walkMinutes = (km) => Math.round((km * 1.3) / 4.5 * 60);

// The trip runs on Japan time whatever the phone is set to
const JP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
// ?now=2026-11-20T22:30 pretends it's that moment in Japan, for checking the plan ahead of time
const NOW = new URLSearchParams(location.search).get("now");
export function japanNow(date = NOW ? new Date(NOW + "+09:00") : new Date()) {
  const p = Object.fromEntries(JP.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, time: `${p.hour}:${p.minute}` };
}

export const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
export const formatDay = (iso) => DAY.format(new Date(iso + "T00:00:00Z"));
export const weekday = (iso) => WEEKDAY.format(new Date(iso + "T00:00:00Z"));
export const dayNumber = (iso) => +iso.slice(8, 10);
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or blocked storage */ }
  },
};

export const mapsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;
export const directionsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit` : null;

// Japan's national mapping agency (GSI) pale basemap: free, no key, detailed to the block
export const TILES = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
