import { japanTime, openState as openAt, hoursOn, WEEK, WEEK_NAME, weekdayOf } from "./hours.js";

export { distanceKm, nearestKm, formatDistance, walkMinutes, mapsUrl, directionsUrl } from "./geo.js";
export { hoursOn, weekRows, toMinutes } from "./hours.js";
export { fold } from "./fold.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// ?now=2026-11-20T22:30 pretends it's that moment in Japan, for checking the plan ahead of time
const NOW = new URLSearchParams(location.search).get("now");
export const japanNow = (date = NOW ? new Date(NOW + "+09:00") : new Date()) => japanTime(date);

// Open or closed right now, Japan time: { label, cls } or null when there's nothing to say
export const openState = (p, now = japanNow()) => openAt(p, now);

// The hours chip: open or closed now, or that day's hours when looking ahead to another trip day
export function hoursBadge(p, date) {
  const now = japanNow();
  if (date && date !== now.date && p.hours?.week) {
    return `<span class="hrs ahead">${esc(WEEK_NAME[WEEK[weekdayOf(date)]])}: ${esc(hoursOn(p, date))}</span>`;
  }
  const s = openState(p, now);
  return s ? `<span class="hrs ${s.cls}">${esc(s.label)}</span>` : "";
}

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

// A Google-encoded polyline (precision 5), as tools/route.py stores it, to [lat, lng] pairs
export function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) { lat += next(); lng += next(); pts.push([lat / 1e5, lng / 1e5]); }
  return pts;
}

export const formatDrive = (r) => `${r.km} km · about ${Math.floor(r.minutes / 60)} h${r.minutes % 60 ? ` ${r.minutes % 60} min` : ""} at the wheel`;

// Japan's national mapping agency (GSI) standard colour basemap: free, no key, detailed to the block
export const TILES = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
