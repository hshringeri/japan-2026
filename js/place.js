/* global L */
import { esc, distanceKm, formatDistance, walkMinutes, directionsUrl, formatDay, hoursBadge, weekRows, japanNow } from "./util.js";
import { addBasemap } from "./basemap.js";
import { setFilter } from "./filter.js";
import { app, hereInJapan, listReturn } from "./state.js";
import { KIND_EMOJI, catEmoji, isInstagram } from "./data.js";
import { apiReady } from "./api.js";
import { addItem } from "./planedit.js";

let mini;

// Close: put you back on the list you came from, not on whatever page preceded it
function close(root) {
  root.querySelector(".back").addEventListener("click", () => {
    location.hash = (listReturn.hash && listReturn.hash.startsWith("#/list")) ? listReturn.hash : "#/list";
  });
}
const X = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export function renderPlace(root, id) {
  const { byId, places, kindName, trip } = app.data;
  const p = byId[id];
  if (!p) {
    root.innerHTML = `<header class="viewhead"><button type="button" class="back" aria-label="Close">${X}</button></header><p class="empty">That place isn't in the guide.</p>`;
    close(root);
    return;
  }
  const photo = app.data.thumbs[p.id];
  const near = places.filter((q) => q !== p && q.lat != null && p.lat != null)
    .map((q) => ({ q, km: distanceKm(p, q) })).sort((a, b) => a.km - b.km).slice(0, 6);
  const planned = trip ? trip.days.flatMap((d) => d.items.filter((i) => i.place === p.id).map((i) => ({ d, i }))) : [];
  const here = hereInJapan() && p.lat != null ? distanceKm(app.here, p) : null;
  const tagLinks = Object.entries(p.tags || {}).flatMap(([facet, vals]) =>
    vals.map((v) => `<button type="button" class="chip" data-tag="${esc(facet)}:${esc(v)}">${esc(v)}</button>`)).join("");

  root.innerHTML = `
    <header class="viewhead"><button type="button" class="back" aria-label="Close">${X}</button></header>
    <article class="place">
      <p class="crumbs">
        <button type="button" data-set='{"city":"${p.city}"}'>${esc(p.cityName)}</button> ›
        <button type="button" data-set='${esc(JSON.stringify({ city: p.city, area: p.area }))}'>${esc(p.area)}</button>
        ${p.neighbourhood && p.neighbourhood !== p.area ? ` › <span>${esc(p.neighbourhood)}</span>` : ""}
      </p>
      <h1>${esc(p.name)}</h1>
      ${photo ? `<figure class="photo"><img src="${esc(photo.src)}" alt="" decoding="async" onerror="this.closest('figure').remove()">${photo.credit ? `<figcaption>Photo: ${esc(photo.credit)}</figcaption>` : ""}</figure>` : ""}
      <p class="kinds">${p.kinds.map((k) => `<button type="button" class="kind" style="--c:${esc(KIND_VAR(k))}" data-set='{"city":"${p.city}","kind":"${k}"}'>${KIND_EMOJI[k] || ""} ${esc(kindName[k])}</button>`).join("")}</p>
      ${planned.map(({ d, i }) => `<p class="planned">On the plan: ${esc(formatDay(d.date))}${i.time ? ` at ${esc(i.time)}` : ""}${i.notes ? ` · ${esc(i.notes)}` : ""}</p>`).join("")}
      ${p.listings.map((l) => `
        <section class="listing">
          ${p.listings.length > 1 ? `<h2>${esc(l.category)}</h2>` : `<h2 class="cat">${esc(l.category)}</h2>`}
          <p class="desc">${esc(l.desc)}</p>
          <p class="meta"><a href="${esc(l.mapUrl)}" target="_blank" rel="noopener">⌖ ${esc(l.address)}</a>${l.info ? ` · ${esc(l.info)}` : ""}</p>
        </section>`).join("")}
      ${hoursBlock(p)}
      ${p.addressJa ? `<p class="ja" lang="ja">${esc(p.addressJa)} <button type="button" class="copy" data-copy="${esc(p.addressJa)}">Copy</button></p>` : ""}
      ${p.geoNote ? `<p class="geonote">${esc(p.geoNote)}</p>` : ""}
      ${p.precision === "area" ? `<p class="warn">The pin shows the area only; check the address before you go.</p>` : ""}
      ${here != null ? `<p class="fromyou">${formatDistance(here)} from you${here < 2.5 ? ` · about ${walkMinutes(here)} min walk` : ""}</p>` : ""}
      <div class="actions">
        ${p.main.url ? `<a class="btn primary" href="${esc(p.main.url)}" target="_blank" rel="noopener">${isInstagram(p.main.url) ? "Instagram" : "Website"} ↗</a>` : `<a class="btn primary" href="${esc(p.main.mapUrl)}" target="_blank" rel="noopener">Maps ↗</a>`}
        <a class="btn" href="${esc(directionsUrl(p) || p.main.mapUrl)}" target="_blank" rel="noopener">Directions ↗</a>
        ${p.lat != null ? `<a class="btn" href="#/map/${p.id}">Show on map</a>` : ""}
        ${apiReady() ? `<button type="button" class="btn" data-addplan>Add to plan</button>` : ""}
      </div>
      ${tagLinks ? `<div class="taglist"><h3>Tags</h3>${tagLinks}</div>` : ""}
      ${p.lat != null ? `<div class="minimap" aria-hidden="true"></div>` : ""}
      ${near.length ? `<section class="nearby"><h3>Nearby</h3><ol>${near.map(({ q, km }) => `
        <li><a href="#/place/${q.id}"><span class="dot" style="--c:${q.color}"></span><span>${esc(q.name)}<small>${esc(q.categories[0])}</small></span><em>${formatDistance(km)}</em></a></li>`).join("")}</ol></section>` : ""}
    </article>`;

  close(root);
  root.querySelector(".place").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.set) { setFilter({ area: null, kind: null, category: null, tags: [], q: "", ...JSON.parse(b.dataset.set) }); location.hash = "#/list"; }
    if (b.dataset.tag) {
      const kind = Object.entries({ cuisine: "eat", genre: "music", style: "shop" }).find(([f]) => b.dataset.tag.startsWith(f + ":"));
      setFilter({ city: p.city, area: null, kind: kind ? kind[1] : null, category: null, q: "", tags: [b.dataset.tag] });
      location.hash = "#/list";
    }
    if (b.dataset.addplan != null) addItem(undefined, p.id);
    if (b.dataset.copy) navigator.clipboard?.writeText(b.dataset.copy).then(() => (b.textContent = "Copied"));
  });

  if (p.lat != null) {
    const el = root.querySelector(".minimap");
    mini?.remove();
    mini = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, maxZoom: 19 })
      .setView([p.lat, p.lng], 16);
    addBasemap(mini, { interactive: false });
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "pin big", html: `<span style="--c:${p.color}">${catEmoji(p)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(mini);
    el.addEventListener("click", () => (location.hash = `#/map/${p.id}`));
  }
  root.scrollTop = 0;
}

const KIND_VAR = (k) => `var(--k-${k})`;

// Today's state, the hours as written, and the week with today picked out
function hoursBlock(p) {
  if (!p.hours) return "";
  const rows = weekRows(p, japanNow().date);
  return `<section class="hours"><h3>Hours</h3>
    ${hoursBadge(p)}
    <p class="meta">${esc(p.hours.text)}${p.hours.source ? ` · <a href="${esc(p.hours.source)}" target="_blank" rel="noopener">source</a>` : ""}</p>
    ${rows.length ? `<table>${rows.map((r) => `<tr${r.today ? ` class="today"` : ""}><th>${r.day}</th><td>${esc(r.hours)}</td></tr>`).join("")}</table>
      <p class="note">Holidays and one-off closures aren't shown; check before a special trip.</p>` : ""}
  </section>`;
}
