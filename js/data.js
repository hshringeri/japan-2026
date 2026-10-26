import { fold } from "./util.js";

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

export async function loadData() {
  const [places, guide, taxonomy, trip] = await Promise.all([
    json("data/places.json"), json("data/guide.json"), json("data/taxonomy.json"), json("data/trip.json", true),
  ]);

  const kindName = Object.fromEntries(taxonomy.kinds.map((k) => [k.id, k.name]));
  const cityName = Object.fromEntries(taxonomy.cities.map((c) => [c.id, c.name]));
  const catOrder = Object.fromEntries(taxonomy.kinds.flatMap((k) => k.categories).map((c, i) => [c, i]));

  places.forEach((p, i) => {
    p.order = i;
    p.main = p.listings[0];
    p.area = p.area || p.hood || cityName[p.city];
    p.kind = p.kinds[0];
    p.color = KIND_COLORS[p.kind];
    p.cityName = cityName[p.city];
    p.allTags = Object.values(p.tags || {}).flat();
    p.search = fold([
      p.name, p.area, p.neighbourhood, p.cityName, p.addressJa, ...p.categories, ...p.kinds.map((k) => kindName[k]),
      ...p.allTags, ...p.listings.flatMap((l) => [l.desc, l.address, l.info]),
    ].join(" "));
    p.nameFold = fold(p.name);
  });

  const byId = Object.fromEntries(places.map((p) => [p.id, p]));
  if (trip) prepareTrip(trip, byId);
  return { places, byId, guide, taxonomy, trip, kindName, cityName, catOrder };
}

function prepareTrip(trip, byId) {
  const stays = Object.fromEntries(trip.stays.map((s) => [s.id, s]));
  for (const day of trip.days) {
    day.stayObj = stays[day.stay] || null;
    for (const it of day.items) {
      // Items that point at a guide place take its coordinates and details
      if (it.place && byId[it.place]) {
        const p = byId[it.place];
        it.placeObj = p;
        it.lat ??= p.lat;
        it.lng ??= p.lng;
        it.url ??= p.main.url;
      }
    }
  }
  trip.dayByDate = Object.fromEntries(trip.days.map((d) => [d.date, d]));
}

// Where a given trip day is centred: the stay you sleep at that night, or the
// one you leave that morning on the last day
export function dayAnchor(trip, date) {
  const day = trip?.dayByDate[date];
  if (!day) return null;
  const s = day.stayObj;
  if (s && s.lat != null) return { lat: s.lat, lng: s.lng, label: s.name, city: s.city };
  const pts = day.items.filter((i) => i.lat != null);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((a, i) => a + i.lat, 0) / pts.length,
    lng: pts.reduce((a, i) => a + i.lng, 0) / pts.length,
    label: day.title, city: day.city,
  };
}
