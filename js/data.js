import { fold } from "./util.js";
import { prepareTrip } from "./trip.js";

export { dayAreas, dayAnchor } from "./trip.js";

async function json(path, optional = false) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`${path}: ${res.status}`);
  }
  return res.json();
}

export const KIND_COLORS = {
  shop: "#d2381f", music: "#6b46c1", drink: "#b7791f", eat: "#2f855a",
  play: "#2b6cb0", unwind: "#0e7490", cars: "#4a5568",
};

// Emoji per category, the kind's mark as the fallback
export const KIND_EMOJI = { shop: "👕", music: "🎷", drink: "🍸", eat: "🍜", play: "🎮", unwind: "♨️", cars: "🚗" };
export const CATEGORY_EMOJI = {
  "Streetwear & Vintage": "👕", "Archive & Designer Vintage": "👗", "Watches & Vintage Hobby": "⌚",
  "Gorpcore & Snow": "🏔️", "Vintage Nintendo": "🍄",
  "Underground Music": "🎸", "Electronic & Clubs": "🎛️", "Jazz Bars": "🎷", "Vinyl Bars": "💿",
  "Beer & Whisky": "🥃", "Cool Bars": "🍸", "After Dark": "🌙",
  Izakaya: "🍺", Omakase: "🍣", Indian: "🍛", Brunch: "🥞", "Good Food": "🍜",
  "Board Game Bars": "🎲", "Pool Bars": "🎱", "Golf & Driving Range": "⛳", "Bowling Alleys": "🎳",
  "Gaming Cafes": "🎮", "Maid Cafes": "☕",
  "Onsen & Sento": "♨️", "Hidden Temples & Shrines": "⛩️",
  "JDM Culture": "🚗",
};
// A place the chat added under a category of its own brings its own emoji
export const catEmoji = (p) => p.emoji || CATEGORY_EMOJI[p.categories[0]] || KIND_EMOJI[p.kind] || "•";
export function isInstagram(url) {
  try { return !!url && /(^|\.)instagram\.com$/.test(new URL(url).hostname); } catch { return false; }
}

export async function loadData() {
  const [places, guide, taxonomy, trip, thumbs, hours, routes] = await Promise.all([
    json("data/places.json"), json("data/guide.json"), json("data/taxonomy.json"), json("data/trip.json", true),
    json("data/thumbs.json", true), json("data/hours.json", true), json("data/routes.json", true),
  ]);

  const kindName = Object.fromEntries(taxonomy.kinds.map((k) => [k.id, k.name]));
  // The chat can add places outside the three cities
  const cityName = { ...Object.fromEntries(taxonomy.cities.map((c) => [c.id, c.name])), elsewhere: "Elsewhere" };
  const catOrder = Object.fromEntries(taxonomy.kinds.flatMap((k) => k.categories).map((c, i) => [c, i]));

  const data = { places, guide, taxonomy, trip, thumbs: thumbs || {}, routes: routes || {}, kindName, cityName, catOrder };
  places.forEach((p, i) => preparePlace(data, p, i, hours?.[p.id]));
  data.byId = Object.fromEntries(places.map((p) => [p.id, p]));
  if (trip) prepareTrip(trip, data.byId, data.routes);
  return data;
}

// The fields the list, map and search read, worked out once per place
export function preparePlace({ kindName, cityName }, p, order, hours = null) {
  p.order = order;
  p.hours = hours;
  p.main = p.listings[0];
  p.area = p.area || p.hood || cityName[p.city];
  p.kind = p.kinds[0];
  p.color = KIND_COLORS[p.kind];
  p.cityName = cityName[p.city] || cityName.elsewhere;
  p.allTags = Object.values(p.tags || {}).flat();
  p.search = fold([
    p.name, p.area, p.neighbourhood, p.cityName, p.addressJa, ...p.categories, ...p.kinds.map((k) => kindName[k]),
    ...p.allTags, ...p.listings.flatMap((l) => [l.desc, l.address, l.info]),
  ].join(" "));
  p.nameFold = fold(p.name);
  return p;
}
