import { distanceKm } from "./geo.js";

// The trip plan's shape and the questions asked of it. No DOM or location access, so the Worker imports this too.

export function prepareTrip(trip, byId, routes) {
  const stays = Object.fromEntries(trip.stays.map((s) => [s.id, s]));
  for (const day of trip.days) {
    day.stayObj = stays[day.stay] || null;
    // A driving day's road line, built by tools/route.py
    day.routeObj = day.route && routes[day.date] ? { ...day.route, ...routes[day.date] } : null;
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

// Everywhere you'll be on a trip day: that night's stay plus the day's stops.
// Places are ranked by distance to the nearest of these points.
// The guide areas a day's stops fall in, in the order you reach them. Each stop takes the area
// its nearest guide places point to, closer ones counting for more; stops with no guide place
// close by add none.
export function dayAreas(data, date) {
  const day = data.trip?.dayByDate[date];
  if (!day) return [];
  const inCity = data.places.filter((p) => p.city === day.city && p.lat != null);
  const stops = day.items.filter((i) => i.lat != null);
  if (day.stayObj?.lat != null) stops.unshift(day.stayObj);
  const out = [];
  for (const s of stops) {
    const near = inCity.map((p) => [distanceKm(s, p), p]).filter(([d]) => d < 1.5).sort((a, b) => a[0] - b[0]).slice(0, 5);
    if (!near.length) continue;
    const votes = new Map();
    for (const [d, p] of near) votes.set(p.area, (votes.get(p.area) || 0) + 1 / Math.max(d, 0.05));
    const area = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    if (!out.includes(area)) out.push(area);
  }
  return out;
}

export function dayAnchor(trip, date) {
  const day = trip?.dayByDate[date];
  if (!day) return null;
  const s = day.stayObj;
  const points = day.items.filter((i) => i.lat != null).map((i) => ({ lat: i.lat, lng: i.lng }));
  if (s && s.lat != null) points.unshift({ lat: s.lat, lng: s.lng });
  if (!points.length) return null;
  return {
    points, lat: points[0].lat, lng: points[0].lng, city: day.city,
    label: s && s.lat != null && points.length === 1 ? s.name : "that day's stops",
  };
}
