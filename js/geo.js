// Distances and map links. No DOM or location access, so the Worker imports this too.

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

export const mapsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;
export const directionsUrl = (p) =>
  p.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit` : null;
