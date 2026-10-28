import { esc, japanNow, toMinutes, formatDay, daysBetween, directionsUrl, formatDrive, storage } from "./util.js";
import { app, onApp, setDate, refreshPlan } from "./state.js";
import { KIND_LABEL, attachSortables, isDragging, editItem, removeItem, addItem } from "./planedit.js";
import { apiReady } from "./api.js";

let root, timer, editing = false;

export function mountPlan(el) {
  root = el;
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-edit-toggle]")) { editing = !editing; render(); return; }
    const add = e.target.closest("[data-add]");
    if (add) { addItem(add.dataset.add); return; }
    const rm = e.target.closest("[data-remove]");
    if (rm) { removeItem(rm.dataset.remove); return; }
    // Editing: tapping an item (not its handle) opens it
    const it = editing && !e.target.closest(".grip") && e.target.closest(".item[data-id]");
    if (it) { editItem(it.dataset.id); return; }
    const b = e.target.closest("[data-look]");
    if (!b) return;
    if (b.dataset.route) storage.set("routeShown", true);
    setDate(b.dataset.look);
    location.hash = "#/map";
  });
  onApp("data", render);
  onApp("plan", render);
}

export function showPlan() {
  render();
  refreshPlan();
  clearInterval(timer);
  // Keep Now / Next current and pick up the others' edits while the tab is open
  timer = setInterval(() => { render(); refreshPlan(); }, 60000);
}

// During the trip, today and what's ahead come first; earlier days fold away
function days(trip, now) {
  const past = trip.days.filter((d) => d.date < now.date);
  const ahead = trip.days.filter((d) => d.date >= now.date);
  if (!past.length || !ahead.length) return `<ol class="days">${trip.days.map((d) => dayCard(d, now)).join("")}</ol>`;
  return `<ol class="days">${ahead.map((d) => dayCard(d, now)).join("")}</ol>
    <details class="earlier"><summary>Earlier days (${past.length})</summary><ol class="days">${past.map((d) => dayCard(d, now)).join("")}</ol></details>`;
}
export const hidePlan = () => clearInterval(timer);

function render() {
  // A re-render mid-drag would drop the item being dragged
  if (isDragging()) return;
  const trip = app.data?.trip;
  if (!trip) {
    root.innerHTML = `<header class="viewhead"><h1>Plan</h1></header><p class="empty">The trip plan hasn't been added yet.</p>`;
    return;
  }
  const now = japanNow();
  const first = trip.days[0].date, last = trip.days.at(-1).date;
  let top;
  if (now.date < first) top = before(trip, now);
  else if (now.date > last) top = `<section class="card hero"><h2>That's a wrap</h2><p>The trip ended ${esc(formatDay(last))}. Everything is still below.</p></section>`;
  else top = during(trip, now);

  const scroll = root.scrollTop;
  root.innerHTML = `
    <header class="viewhead"><h1>Plan</h1>
      <p class="who">${esc(trip.people.join(" · "))}</p>
      ${apiReady() ? `<button type="button" class="iconbtn${editing ? " on" : ""}" data-edit-toggle aria-pressed="${editing}">${editing ? "Done" : "Edit"}</button>` : ""}
    </header>
    ${editing ? `<p class="edithint">Drag <span class="grip-ico" aria-hidden="true">⠿</span> to reorder or move to another day. Tap an item to change it. Everyone sees your changes.</p>` : top}
    ${days(trip, now)}
    ${trip.open?.length ? `<section class="card open"><h2>Still to sort out</h2><ul>${trip.open.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></section>` : ""}`;
  root.classList.toggle("editing", editing);
  root.scrollTop = scroll;
  if (editing) attachSortables(root);
}

function before(trip, now) {
  const n = daysBetween(now.date, trip.days[0].date);
  const d1 = trip.days[0];
  const rules = app.data.guide.rules.items;
  return `
    <section class="card hero">
      <p class="kicker">${n === 1 ? "Tomorrow" : `${n} days to go`}</p>
      <h2>${esc(formatDay(d1.date))}: ${esc(d1.title)}</h2>
      ${d1.items.slice(0, 3).map((i) => `<p>${i.time ? `<b>${esc(i.time)}</b> ` : ""}${esc(i.title)}</p>`).join("")}
    </section>
    <section class="card checklist">
      <h2>Before you go</h2>
      <ul>${(trip.checklist || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <details><summary>${app.data.guide.rules.title}</summary><ul>${rules.map((r) => `<li>${r}</li>`).join("")}</ul></details>
    </section>`;
}

// Now and Next, by Japan time
function during(trip, now) {
  const idx = trip.days.findIndex((d) => d.date === now.date);
  const today = trip.days[idx];
  const timed = today.items.filter((i) => i.time);
  const current = [...timed].reverse().find((i) => toMinutes(i.time) <= now.minutes &&
    (i.end ? toMinutes(i.end) > now.minutes : true));
  let next = timed.find((i) => toMinutes(i.time) > now.minutes);
  let nextDay = today;
  if (!next) {
    nextDay = trip.days[idx + 1];
    next = nextDay?.items.find((i) => i.time) || nextDay?.items[0];
  }
  const until = next?.time && nextDay === today ? toMinutes(next.time) - now.minutes : null;
  return `
    <section class="card hero now">
      <p class="kicker">Day ${idx + 1} of ${trip.days.length} · ${esc(formatDay(today.date))} · ${esc(now.time)} in Japan</p>
      <h2>${esc(today.title)}</h2>
      ${current ? `<div class="nowitem"><span class="tag">Now</span>${item(current, today, true)}</div>` : ""}
      ${next ? `<div class="nowitem next"><span class="tag">${nextDay === today ? (until != null ? `In ${fmtUntil(until)}` : "Next") : `Tomorrow`}</span>${item(next, nextDay, true)}</div>` : `<p>Nothing else planned. ${today.stayObj ? `Home tonight is ${esc(today.stayObj.name)}.` : ""}</p>`}
      ${today.stayObj ? `<p class="stayline">Tonight: <a href="${esc(directionsUrl(today.stayObj) || today.stayObj.url)}" target="_blank" rel="noopener">${esc(today.stayObj.name)} ↗</a></p>` : ""}
    </section>`;
}

const fmtUntil = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());

function item(i, day, big = false) {
  if (editing && !big) return editRow(i);
  const href = i.placeObj ? `#/place/${i.placeObj.id}` : i.url;
  const ext = !i.placeObj && i.url;
  const title = href ? `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(i.title)}${ext ? " ↗" : ""}</a>` : esc(i.title);
  return `<div class="item${big ? " big" : ""}${i.status === "tbd" ? " tbd" : ""}">
      <span class="time">${i.time ? esc(i.time) + (i.end ? `<small>–${esc(i.end)}</small>` : "") : ""}</span>
      <span class="what">
        <span class="k">${esc(KIND_LABEL[i.kind] || "")}${i.status === "booked" ? " · booked" : i.status === "tbd" ? " · TBD" : ""}${i.who?.length ? ` · ${esc(i.who.join(", "))}` : ""}</span>
        <span class="t">${title}</span>
        ${i.notes ? `<span class="n">${esc(i.notes)}</span>` : ""}
        ${i.lat != null ? `<a class="dir" href="${esc(directionsUrl(i))}" target="_blank" rel="noopener">Directions ↗</a>` : ""}
      </span></div>`;
}

// An item while editing: a handle to drag, the item, and a remove button
function editRow(i) {
  return `<div class="item edit${i.status === "tbd" ? " tbd" : ""}" data-id="${esc(i.id)}">
      <span class="grip" aria-label="Drag to move">⠿</span>
      <span class="what">
        <span class="k">${i.time ? `${esc(i.time)}${i.end ? `–${esc(i.end)}` : ""} · ` : ""}${esc(KIND_LABEL[i.kind] || "")}${i.status === "booked" ? " · booked" : i.status === "tbd" ? " · TBD" : ""}</span>
        <span class="t">${esc(i.title)}</span>
      </span>
      <button type="button" class="rm" data-remove="${esc(i.id)}" aria-label="Remove ${esc(i.title)}">×</button>
    </div>`;
}

// A driving day: the whole drive in one row, with the line on the map and the route in Google Maps
function route(d) {
  const r = d.routeObj;
  const stops = d.items.filter((i) => i.lat != null).length;
  return `<div class="item drive">
      <span class="time"></span>
      <span class="what">
        <span class="k">Drive · ${stops} stops</span>
        <span class="t">${esc(r.title)}</span>
        <span class="n">${esc(formatDrive(r))}, not counting the stops.</span>
        <span class="acts">
          <button type="button" class="look" data-look="${d.date}" data-route="1">Show the route on the map</button>
          <a class="dir" href="${esc(r.url)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>
        </span>
      </span></div>`;
}

function dayCard(d, now) {
  const cls = d.date === now.date ? " today" : d.date < now.date ? " past" : "";
  return `<li class="day${cls}" id="day-${d.date}">
    <header>
      <p class="date">${esc(formatDay(d.date))}${d.date === now.date ? " · today" : ""}</p>
      <h3>${esc(d.title)}</h3>
      <p class="where">${esc(d.cityLabel || d.city)}${d.stayObj ? ` · sleeping at ${esc(d.stayObj.name)}` : ""}</p>
      <button type="button" class="look" data-look="${d.date}">See this day on the map</button>
    </header>
    ${d.routeObj && !editing ? route(d) : ""}
    <div class="items" data-date="${d.date}">${d.items.map((i) => item(i, d)).join("")}</div>
    ${editing ? `<button type="button" class="additem" data-add="${d.date}">+ Add to ${esc(formatDay(d.date))}</button>` : ""}
  </li>`;
}
