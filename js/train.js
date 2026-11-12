import { esc, formatDay, directionsUrl } from "./util.js";
import { app, onApp } from "./state.js";
import { showTrainRoute, clearTrainRoute } from "./map.js";

const TRAIN_DAYS = ["2026-11-16", "2026-11-17"];

let root;

export function mountTrain(el) {
  root = el;
  onApp("data", render);
  onApp("plan", render);
}

export function showTrain() {
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
      <p>Train routes from the Shibuya Airbnb. Open a route in Google Maps for the lines and platforms.</p>
      ${stay ? `<p class="stayline">Starting from <a href="${esc(stay.url || directionsUrl(stay))}" target="_blank" rel="noopener">${esc(stay.name)} ↗</a></p>` : ""}
    </section>
    ${days.map((day) => dayCard(day)).join("")}
  `;
  if (document.body.dataset.view === "train") drawRoute();
}

function drawRoute() {
  const trip = app.data?.trip;
  const day = trip?.dayByDate?.[TRAIN_DAYS[0]];
  const stay = trip?.stays.find((s) => s.id === "tokyo-1");
  const points = [stay, ...(day?.items || []).filter((item) => item.lat != null)];
  showTrainRoute(points);
}

function dayCard(day) {
  const stops = day.items.filter((item) => item.lat != null);
  return `<section class="card train-day" id="train-${day.date}">
    <header>
      <p class="date">${esc(formatDay(day.date))}</p>
      <h3>${esc(day.title)}</h3>
      <p class="where">${esc(day.cityLabel || day.city)}</p>
    </header>
    <ol class="train-stops">
      ${stops.map((stop) => `<li>
        <a href="${esc(directionsUrl(stop))}" target="_blank" rel="noopener">${esc(stop.title)} ↗</a>
        ${stop.notes ? `<small>${esc(stop.notes)}</small>` : ""}
      </li>`).join("")}
    </ol>
  </section>`;
}
