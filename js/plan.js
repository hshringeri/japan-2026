import { esc, japanNow, toMinutes, formatDay, daysBetween, directionsUrl } from "./util.js";
import { app, onApp, setDate } from "./state.js";

const KIND_LABEL = {
  flight: "Flight", train: "Train", transfer: "Getting there", checkin: "Check in", checkout: "Check out",
  food: "Food", sight: "See", shop: "Shop", activity: "Do", golf: "Golf", night: "Night out", note: "Note",
};

let root, timer;

export function mountPlan(el) {
  root = el;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-look]");
    if (b) { setDate(b.dataset.look); location.hash = "#/map"; }
  });
  onApp("data", render);
}

export function showPlan() {
  render();
  clearInterval(timer);
  // Keep Now / Next current while the tab is open
  timer = setInterval(render, 60000);
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

  root.innerHTML = `
    <header class="viewhead"><h1>Plan</h1><p class="who">${esc(trip.people.join(" · "))}</p></header>
    ${top}
    ${days(trip, now)}
    ${trip.open?.length ? `<section class="card open"><h2>Still to sort out</h2><ul>${trip.open.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></section>` : ""}`;
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

function dayCard(d, now) {
  const cls = d.date === now.date ? " today" : d.date < now.date ? " past" : "";
  return `<li class="day${cls}" id="day-${d.date}">
    <header>
      <p class="date">${esc(formatDay(d.date))}${d.date === now.date ? " · today" : ""}</p>
      <h3>${esc(d.title)}</h3>
      <p class="where">${esc(d.cityLabel || d.city)}${d.stayObj ? ` · sleeping at ${esc(d.stayObj.name)}` : ""}</p>
      <button type="button" class="look" data-look="${d.date}">See this day on the map</button>
    </header>
    ${d.items.map((i) => item(i, d)).join("")}
  </li>`;
}
