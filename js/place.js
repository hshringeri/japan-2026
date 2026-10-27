/* global L */
import { esc, distanceKm, formatDistance, walkMinutes, directionsUrl, formatDay } from "./util.js";
import { addBasemap } from "./basemap.js";
import { setFilter } from "./filter.js";
import { app, hereInJapan } from "./state.js";
import { KIND_EMOJI, isInstagram } from "./data.js";
import { placeIcon } from "./icons.js";

let mini;

export function renderPlace(root, id) {
  const { byId, places, kindName, trip } = app.data;
  const p = byId[id];
  if (!p) {
    root.innerHTML = `<header class="viewhead"><a class="back" href="#/list">‹ List</a></header><p class="empty">That place isn't in the guide.</p>`;
    return;
  }
  const near = places.filter((q) => q !== p && q.lat != null && p.lat != null)
    .map((q) => ({ q, km: distanceKm(p, q) })).sort((a, b) => a.km - b.km).slice(0, 6);
  const planned = trip ? trip.days.flatMap((d) => d.items.filter((i) => i.place === p.id).map((i) => ({ d, i }))) : [];
  const here = hereInJapan() && p.lat != null ? distanceKm(app.here, p) : null;
  const tagLinks = Object.entries(p.tags || {}).flatMap(([facet, vals]) =>
    vals.map((v) => `<button type="button" class="chip" data-tag="${esc(facet)}:${esc(v)}">${esc(v)}</button>`)).join("");

  root.innerHTML = `
    <header class="viewhead"><button type="button" class="back">‹ Back</button></header>
    <article class="place">
      <p class="crumbs">
        <button type="button" data-set='{"city":"${p.city}"}'>${esc(p.cityName)}</button> ›
        <button type="button" data-set='${esc(JSON.stringify({ city: p.city, area: p.area }))}'>${esc(p.area)}</button>
        ${p.neighbourhood && p.neighbourhood !== p.area ? ` › <span>${esc(p.neighbourhood)}</span>` : ""}
      </p>
      <h1>${esc(p.name)}</h1>
      <p class="kinds">${p.kinds.map((k) => `<button type="button" class="kind" style="--c:${esc(KIND_VAR(k))}" data-set='{"city":"${p.city}","kind":"${k}"}'>${KIND_EMOJI[k] || ""} ${esc(kindName[k])}</button>`).join("")}</p>
      ${planned.map(({ d, i }) => `<p class="planned">On the plan: ${esc(formatDay(d.date))}${i.time ? ` at ${esc(i.time)}` : ""}${i.notes ? ` · ${esc(i.notes)}` : ""}</p>`).join("")}
      ${p.listings.map((l) => `
        <section class="listing">
          ${p.listings.length > 1 ? `<h2>${esc(l.category)}</h2>` : `<h2 class="cat">${esc(l.category)}</h2>`}
          <p class="desc">${esc(l.desc)}</p>
          <p class="meta"><a href="${esc(l.mapUrl)}" target="_blank" rel="noopener">⌖ ${esc(l.address)}</a>${l.info ? ` · ${esc(l.info)}` : ""}</p>
        </section>`).join("")}
      ${p.addressJa ? `<p class="ja" lang="ja">${esc(p.addressJa)} <button type="button" class="copy" data-copy="${esc(p.addressJa)}">Copy</button></p>` : ""}
      ${p.geoNote ? `<p class="geonote">${esc(p.geoNote)}</p>` : ""}
      ${p.precision === "area" ? `<p class="warn">The pin shows the area only; check the address before you go.</p>` : ""}
      ${here != null ? `<p class="fromyou">${formatDistance(here)} from you${here < 2.5 ? ` · about ${walkMinutes(here)} min walk` : ""}</p>` : ""}
      <div class="actions">
        ${p.main.url ? `<a class="btn primary" href="${esc(p.main.url)}" target="_blank" rel="noopener">${isInstagram(p.main.url) ? "Instagram" : "Website"} ↗</a>` : `<a class="btn primary" href="${esc(p.main.mapUrl)}" target="_blank" rel="noopener">Maps ↗</a>`}
        <a class="btn" href="${esc(directionsUrl(p) || p.main.mapUrl)}" target="_blank" rel="noopener">Directions ↗</a>
        ${p.lat != null ? `<a class="btn" href="#/map/${p.id}">Show on map</a>` : ""}
      </div>
      ${tagLinks ? `<div class="taglist"><h3>Tags</h3>${tagLinks}</div>` : ""}
      ${p.lat != null ? `<div class="minimap" aria-hidden="true"></div>` : ""}
      ${near.length ? `<section class="nearby"><h3>Nearby</h3><ol>${near.map(({ q, km }) => `
        <li><a href="#/place/${q.id}"><span class="dot" style="--c:${q.color}"></span><span>${esc(q.name)}<small>${esc(q.categories[0])}</small></span><em>${formatDistance(km)}</em></a></li>`).join("")}</ol></section>` : ""}
    </article>`;

  root.querySelector(".back").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/list")));
  root.querySelector(".place").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.set) { setFilter({ area: null, kind: null, category: null, tags: [], q: "", ...JSON.parse(b.dataset.set) }); location.hash = "#/list"; }
    if (b.dataset.tag) {
      const kind = Object.entries({ cuisine: "eat", genre: "music", style: "shop" }).find(([f]) => b.dataset.tag.startsWith(f + ":"));
      setFilter({ city: p.city, area: null, kind: kind ? kind[1] : null, category: null, q: "", tags: [b.dataset.tag] });
      location.hash = "#/list";
    }
    if (b.dataset.copy) navigator.clipboard?.writeText(b.dataset.copy).then(() => (b.textContent = "Copied"));
  });

  if (p.lat != null) {
    const el = root.querySelector(".minimap");
    mini?.remove();
    mini = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, maxZoom: 19 })
      .setView([p.lat, p.lng], 16);
    addBasemap(mini, { interactive: false });
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "pin big", html: `<span style="--c:${p.color}">${placeIcon(p)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(mini);
    el.addEventListener("click", () => (location.hash = `#/map/${p.id}`));
  }
  root.scrollTop = 0;
}

const KIND_VAR = (k) => `var(--k-${k})`;
