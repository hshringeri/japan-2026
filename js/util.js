export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

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

// The tags worth showing at a glance: up to three of cuisine, genre or style, then up to three practical flags
export function shortTags(p) {
  const flags = (p.tags?.flags || []).filter((f) => f !== "Walk-in").slice(0, 3);
  return [...(p.tags?.cuisine || []), ...(p.tags?.genre || []), ...(p.tags?.style || [])].slice(0, 3).concat(flags);
}

export const mapsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;
export const directionsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit` : null;

// Japan's national mapping agency (GSI) standard colour basemap: free, no key, detailed to the block
export const TILES = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
