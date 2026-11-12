import { esc, formatDay, directionsUrl, distanceKm, formatDistance } from "./util.js";
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

let root;
let selectedDay = TRAIN_DAYS[0];

export function mountTrain(el) {
  root = el;
  root.addEventListener("click", (event) => {
    const card = event.target.closest("[data-day]");
    if (!card) return;
    selectedDay = card.dataset.day;
    render();
    drawRoute();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-day]");
    if (!card) return;
    event.preventDefault();
    selectedDay = card.dataset.day;
    render();
    drawRoute();
  });
  onApp("data", render);
  onApp("plan", render);
}

export function showTrain() {
  selectedDay = TRAIN_DAYS[0];
  render();
  drawRoute();
}

export function hideTrain() {
  clearTrainRoute();
}

function render() {
  const trip = app.data?.trip;
  if (!trip) {
    root.innerHTML = `<header class="viewhead"><h1>Train map</h1></header><p class="empty">The trip plan hasn't been added yet.</p>`;
    return;
  }

  const stay = trip.stays.find((s) => s.id === "tokyo-1");
  const days = TRAIN_DAYS.map((date) => trip.dayByDate?.[date]).filter(Boolean);

  root.innerHTML = `
    <header class="viewhead"><h1>Train map</h1><p class="who">11/16–11/17</p></header>
    <section class="card train-intro">
      <h2>Tokyo by train</h2>
      <p>Pick a day to draw its stations on the map. Open a stop in Google Maps for the lines and platforms.</p>
      ${stay ? `<p class="stayline">Starting from <a href="${esc(stay.url || directionsUrl(stay))}" target="_blank" rel="noopener">${esc(stay.name)} ↗</a></p>` : ""}
    </section>
    ${days.map((day) => dayCard(day, day.date === selectedDay)).join("")}
  `;
  if (document.body.dataset.view === "train") drawRoute();
}

function drawRoute() {
  const trip = app.data?.trip;
  const day = trip?.dayByDate?.[selectedDay];
  if (!day) return;
  const stay = trip.stays.find((s) => s.id === day.stay);
  const start = nearestStation(stay) || STATIONS.shibuya;
  const stations = [start];
  const points = [stay, start];
  for (const item of day.items) {
    const station = stationFor(item);
    if (!station) continue;
    points.push(station);
    if (!stations.includes(station)) stations.push(station);
  }
  points.push(stay);
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

// Rough door-to-door train time, same figure the worker's travel_estimate uses.
const legMinutes = (km) => Math.round(12 + km * 2);
const legText = (km) => `${legMinutes(km)} min · ${formatDistance(km)}`;

function dayCard(day, on) {
  const stops = day.items.filter((item) => item.lat != null);
  const stay = app.data?.trip?.stays?.find((s) => s.id === day.stay);
  const home = nearestStation(stay);
  let prev = home;
  const legs = stops.map((stop) => {
    const station = stationFor(stop);
    const leg = prev && station && prev !== station ? legText(distanceKm(prev, station)) : "";
    prev = station || prev;
    return `<li>
        <a href="${esc(directionsUrl(stop))}" target="_blank" rel="noopener">${esc(stop.title)} ↗</a>
        ${leg ? `<em class="leg">${esc(leg)}</em>` : ""}
        ${stop.notes ? `<small>${esc(stop.notes)}</small>` : ""}
      </li>`;
  });
  const back = prev && home && prev !== home ? `<li class="back"><span>Back to ${esc(stay?.name || "the stay")}</span><em class="leg">${esc(legText(distanceKm(prev, home)))}</em></li>` : "";
  return `<section class="card train-day${on ? " on" : ""}" id="train-${day.date}" data-day="${day.date}" role="button" tabindex="0" aria-pressed="${on}">
    <header>
      <p class="date">${esc(formatDay(day.date))}</p>
      <h3>${esc(day.title)}</h3>
      <p class="where">${esc(day.cityLabel || day.city)}</p>
    </header>
    <ol class="train-stops">
      ${legs.join("")}
      ${back}
    </ol>
  </section>`;
}
