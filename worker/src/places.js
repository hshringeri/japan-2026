// Places the chat adds to the map. The model proposes candidates, the Worker finds each one's pin
// from its address, and nothing is saved until someone confirms. Records have the same shape as
// data/places.json entries, plus source: "chat", so the app draws them like any guide place.
// Pure functions apart from geocode(), whose fetch can be swapped out, so tests run in Node.

import { distanceKm } from "../../js/geo.js";
import { fold } from "../../js/fold.js";

export const CITY = { tokyo: { lat: 35.6812, lng: 139.7671 }, osaka: { lat: 34.6937, lng: 135.5023 }, kyoto: { lat: 35.0116, lng: 135.7681 } };
export const CITY_IDS = [...Object.keys(CITY), "elsewhere"];
const CITY_KM = 50;   // further than this from all three cities counts as elsewhere
const SAME_KM = 0.2;  // a place with the same name this close is a duplicate

export class PlaceError extends Error {}

const str = (v, max, name, { optional = false } = {}) => {
  if (v == null || v === "") {
    if (optional) return null;
    throw new PlaceError(`${name} is missing`);
  }
  if (typeof v !== "string") throw new PlaceError(`${name} must be text`);
  const s = v.trim().replace(/\s+/g, " ");
  if (!s && !optional) throw new PlaceError(`${name} is missing`);
  if (s.length > max) throw new PlaceError(`${name} is longer than ${max} characters`);
  return s || null;
};

function link(v) {
  const s = str(v, 500, "url", { optional: true });
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new PlaceError("url isn't a valid link"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PlaceError("url must start with https://");
  return s;
}

const EMOJI = /^\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

// One candidate from the model, checked. Its kind and category come from the guide's taxonomy;
// a category the guide doesn't have needs its own emoji, or the kind's mark is used.
export function checkCandidate(c, taxonomy) {
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new PlaceError("Each candidate must be an object");
  const out = {
    name: str(c.name, 80, "name"),
    address: str(c.address, 200, "address"),
    addressJa: str(c.address_ja, 120, "address_ja", { optional: true }),
    area: str(c.area, 40, "area", { optional: true }),
    desc: str(c.desc, 300, "desc"),
    info: str(c.info, 120, "info", { optional: true }),
    url: link(c.url),
  };
  if (!CITY_IDS.includes(c.city)) throw new PlaceError(`city must be one of ${CITY_IDS.join(", ")}`);
  out.city = c.city;
  const category = str(c.category, 40, "category");
  const owner = taxonomy.kinds.find((k) => k.categories.includes(category));
  if (owner) {
    out.kind = owner.id;
    out.category = category;
  } else {
    if (!taxonomy.kinds.some((k) => k.id === c.kind)) throw new PlaceError(`kind must be one of ${taxonomy.kinds.map((k) => k.id).join(", ")}`);
    out.kind = c.kind;
    out.category = category;
    const e = typeof c.emoji === "string" ? c.emoji.trim() : "";
    if (EMOJI.test(e)) out.emoji = e;
  }
  return out;
}

// Which of the three cities a point is in, or elsewhere
export function cityFor(pt) {
  let best = "elsewhere", km = CITY_KM;
  for (const [id, c] of Object.entries(CITY)) {
    const d = distanceKm(pt, c);
    if (d < km) { best = id; km = d; }
  }
  return best;
}

// The guide area a point belongs to: the area its nearest guide places share, closer ones
// counting for more (the way the app picks a day's areas). Null when no guide place is close.
export function areaFor(pt, city, places) {
  const near = places.filter((p) => p.city === city && p.lat != null && p.source !== "chat")
    .map((p) => [distanceKm(pt, p), p]).filter(([d]) => d < 1).sort((a, b) => a[0] - b[0]).slice(0, 5);
  if (!near.length) return null;
  const votes = new Map();
  for (const [d, p] of near) votes.set(p.area, (votes.get(p.area) || 0) + 1 / Math.max(d, 0.05));
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

// A place already on the map under the same name, close by: { id, name } or null
export function findSame(name, pt, places) {
  const n = fold(name);
  if (!n) return null;
  for (const p of places) {
    if (p.lat == null || distanceKm(pt, p) > SAME_KM) continue;
    const m = fold(p.name);
    if (m && (m === n || (Math.min(m.length, n.length) >= 4 && (m.includes(n) || n.includes(m))))) return { id: p.id, name: p.name };
  }
  return null;
}

// GSI (Japan's national mapping agency) for a Japanese address, OpenStreetMap as the fallback.
// Returns { lat, lng, precision, via } or null.
export async function geocode(c, fetchFn = fetch) {
  const get = async (url, headers = {}) => {
    try {
      const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(6000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  for (const q of [c.addressJa, c.address].filter(Boolean)) {
    const r = await get(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
    const hit = Array.isArray(r) && r[0];
    if (!hit?.geometry?.coordinates) continue;
    const [lng, lat] = hit.geometry.coordinates;
    // A block number (番, 号 or 番地) pins the building's block; anything less is the neighbourhood
    const precision = /[番号]/.test(hit.properties?.title || "") ? "block" : "area";
    return { lat: round(lat), lng: round(lng), precision, via: "gsi" };
  }
  const ua = { "User-Agent": "japan-2026 trip app (Cloudflare Worker)" };
  for (const q of [`${c.name}, ${c.address}`, c.address]) {
    const r = await get(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&limit=1&q=${encodeURIComponent(q)}`, ua);
    const hit = Array.isArray(r) && r[0];
    if (!hit) continue;
    const rank = +hit.place_rank || 0;
    return { lat: round(+hit.lat), lng: round(+hit.lon), precision: rank >= 28 ? "building" : rank >= 26 ? "street" : "area", via: "osm" };
  }
  return null;
}

const round = (n) => Math.round(n * 1e5) / 1e5;

const slug = (s) => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "place";

// A new id that no guide or chat place has
export function newPlaceId(name, taken) {
  const base = `chat-${slug(name)}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

const CITY_NAME = { tokyo: "Tokyo", osaka: "Osaka", kyoto: "Kyoto" };

// The record saved once someone confirms. pt is the geocoded pin; places are those already on the map.
export function buildPlace(c, pt, places) {
  const city = cityFor(pt);
  const area = areaFor(pt, city, places) || c.area || CITY_NAME[city] || "Elsewhere";
  const where = [c.name, c.address, CITY_NAME[city]].filter(Boolean).join(" ");
  const place = {
    city, name: c.name,
    listings: [{
      category: c.category, url: c.url || null, desc: c.desc, address: c.address,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`, info: c.info || null,
    }],
    kinds: [c.kind], categories: [c.category], tags: {},
    lat: pt.lat, lng: pt.lng, precision: pt.precision, area,
    source: "chat",
  };
  if (c.addressJa) place.addressJa = c.addressJa;
  if (c.emoji) place.emoji = c.emoji;
  return place;
}
