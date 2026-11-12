import { app, onApp } from "./state.js";
import { showTrainRoute, clearTrainRoute } from "./map.js";

const TRAIN_DAYS = ["2026-11-16", "2026-11-17"];

// The stations the plan's stops sit nearest. Coordinates are the station, not the venue.
const STATIONS = {
  shibuya: { name: "Shibuya", lat: 35.65803, lng: 139.70164 },
  harajuku: { name: "Harajuku", lat: 35.67017, lng: 139.70270 },
  shinjuku: { name: "Shinjuku", lat: 35.68963, lng: 139.70058 },
  koenji: { name: "Koenji", lat: 35.70528, lng: 139.64972 },
  nakano: { name: "Nakano", lat: 35.70565, lng: 139.66570 },
  ebisu: { name: "Ebisu", lat: 35.64669, lng: 139.71000 },
  yoyogihachiman: { name: "Yoyogi-Hachiman", lat: 35.66900, lng: 139.68600 },
  kichijoji: { name: "Kichijoji", lat: 35.70300, lng: 139.58000 },
  shimokitazawa: { name: "Shimokitazawa", lat: 35.66163, lng: 139.66804 },
  ueno: { name: "Ueno", lat: 35.71377, lng: 139.77725 },
  asakusa: { name: "Asakusa", lat: 35.71186, lng: 139.79667 },
  akihabara: { name: "Akihabara", lat: 35.69835, lng: 139.77309 },
  ginza: { name: "Ginza", lat: 35.67170, lng: 139.76500 },
  hamamatsucho: { name: "Hamamatsucho", lat: 35.65530, lng: 139.75670 },
};

// The train overlay belongs to the main map: picking 16 or 17 November draws that day's
// station-to-station route there. Any other date, or leaving the map, takes it away again.
export function mountTrainRoutes() {
  onApp("data", sync);
  onApp("plan", sync);
  onApp("places", sync);
  onApp("date", sync);
  onApp("route", sync);
  sync();
}

const mapOnScreen = () => !document.getElementById("view-map").hidden;

function sync() {
  const date = app.date;

  if (!mapOnScreen() || !TRAIN_DAYS.includes(date)) {
    clearTrainRoute();
    return;
  }
  // Frame after the map's own date handlers, which also fit the day's places.
  requestAnimationFrame(() => {
    if (!mapOnScreen() || app.date !== date) return;
    drawRoute(date);
  });
}

function drawRoute(date) {
  const trip = app.data?.trip;
  const day = trip?.dayByDate?.[date];
  if (!day) return;
  const stay = trip.stays.find((s) => s.id === day.stay);
  const start = nearestStation(stay) || STATIONS.shibuya;
  const stations = [start];
  // Times are station to station: the line runs from the home station, not the stay's door.
  const points = [start];
  for (const item of day.items) {
    const station = stationFor(item);
    if (!station) continue;
    points.push(station);
    if (!stations.includes(station)) stations.push(station);
  }
  points.push(start);
  showTrainRoute(points, stations);
}

function nearestStation(point) {
  if (!point || point.lat == null || point.lng == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const station of Object.values(STATIONS)) {
    const d = (station.lat - point.lat) ** 2 + (station.lng - point.lng) ** 2;
    if (d < bestD) { bestD = d; best = station; }
  }
  return best;
}

function stationFor(item) {
  const place = item.placeObj || (item.place && app.data.byId[item.place]) || (item.id && app.data.byId[item.id]);
  const point = item.lat != null ? item : place;
  if (point && point.lat != null && point.lng != null) {
    const nearest = nearestStation(point);
    if (nearest) return nearest;
  }
  const text = `${item.title} ${item.address || ""} ${item.area || ""} ${place?.area || ""} ${place?.neighbourhood || ""}`.toLowerCase();
  if (/nomen/.test(text)) return STATIONS.kichijoji;
  if (/koenji/.test(text)) return STATIONS.koenji;
  if (/ebisu/.test(text)) return STATIONS.ebisu;
  if (/nakano/.test(text)) return STATIONS.nakano;
  if (/shibuya/.test(text)) return STATIONS.shibuya;
  if (/harajuku/.test(text)) return STATIONS.harajuku;
  if (/shimokita/.test(text)) return STATIONS.shimokitazawa;
  if (/shinjuku/.test(text)) return STATIONS.shinjuku;
  if (/ueno/.test(text)) return STATIONS.ueno;
  if (/asakusa/.test(text)) return STATIONS.asakusa;
  if (/akihabara/.test(text)) return STATIONS.akihabara;
  if (/ginza/.test(text)) return STATIONS.ginza;
  if (/tokyo tower|shiba/.test(text)) return STATIONS.hamamatsucho;
  return null;
}
