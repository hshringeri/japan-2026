import { esc, nearestKm, formatDistance, walkMinutes, formatDay, shortTags } from "./util.js";
import { filter, matches, onFilter } from "./filter.js";
import { app, onApp, anchor, listReturn } from "./state.js";
import { mountFilterBar, mountDateStrip } from "./filterbar.js";
import { catEmoji } from "./data.js";
import { highlightPlace } from "./map.js";

export function mountList(root) {
  root.innerHTML = `
    <header class="viewhead">
      <h1>Japan <em>2026</em></h1>
      <a class="iconbtn" href="#/guide" aria-label="Read the full guide">Guide</a>
    </header>
    <div class="stick"><div class="ds"></div><div class="fb"></div></div>
    <div class="context"></div>
    <p class="count" aria-live="polite"></p>
    <ol class="rows"></ol>
    <div class="after"></div>`;
  mountDateStrip(root.querySelector(".ds"));
  mountFilterBar(root.querySelector(".fb"));
  const ctx = root.querySelector(".context"), count = root.querySelector(".count"),
    rows = root.querySelector(".rows"), after = root.querySelector(".after");

  function render() {
    const { places, guide, catOrder } = app.data;
    const a = anchor();
    let results = places.filter((p) => matches(p));
    results.forEach((p) => (p.dist = a ? nearestKm(a, p) : null));
    if (a) results.sort((x, y) => (x.dist ?? 1e9) - (y.dist ?? 1e9));
    else if (filter.q) {
      const q = filter.q.toLowerCase();
      results.sort((x, y) => (y.name.toLowerCase().startsWith(q) - x.name.toLowerCase().startsWith(q)) || x.order - y.order);
    } else results.sort((x, y) => x.order - y.order || catOrder[x.main.category] - catOrder[y.main.category]);

    ctx.innerHTML = contextCards(results, guide);
    const where = a ? (a.kind === "here" ? "nearest to you" : `nearest to ${esc(a.label)} on ${formatDay(app.date)}`) : "";
    count.innerHTML = `${results.length} place${results.length === 1 ? "" : "s"}${where ? ` <span>${where}</span>` : ""}`;
    rows.innerHTML = results.length ? results.map(row).join("") :
      `<li class="empty">Nothing matches. Try removing a filter.</li>`;
    after.innerHTML = goneNotes(guide);
  }

  onFilter(render);
  onApp("date", render);
  onApp("here", () => { if (!app.date) render(); });
  // Coming back from a place: put the list back where it was
  onApp("route", (name) => {
    if (name !== "list" || !listReturn.top) return;
    root.scrollTop = listReturn.top;
    listReturn.top = 0;
  });

  // The map and the list light each other up on hover
  rows.addEventListener("mouseover", (e) => {
    const row = e.target.closest(".row");
    if (row) highlightPlace(row.dataset.pid, true);
  });
  rows.addEventListener("mouseout", (e) => {
    const row = e.target.closest(".row");
    if (row) highlightPlace(row.dataset.pid, false);
  });
  onApp("pinhover", ({ id, on }) => {
    const row = rows.querySelector(`[data-pid="${CSS.escape(id)}"]`);
    if (!row) return;
    row.classList.toggle("lit", on);
    if (on) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  render();
}

function row(p) {
  const tags = shortTags(p);
  const dist = p.dist != null ? `<span class="dist">${formatDistance(p.dist)}${p.dist < 2.5 ? `<small>${walkMinutes(p.dist)} min walk</small>` : ""}</span>` : "";
  // Same photo as the map card; the distance tucks under it
  const photo = app.data.thumbs[p.id];
  const side = photo ? `<span class="side"><img src="${esc(photo.src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">${dist}</span>` : dist;
  return `<li><a class="row" data-pid="${p.id}" href="#/place/${p.id}">
    <span class="dot" style="--c:${p.color}"></span>
    <span class="body">
      <span class="name">${esc(p.name)}</span>
      <span class="sub">${catEmoji(p)} ${esc(p.area)} · ${esc(p.categories.join(", "))}${p.precision === "area" ? " · approx. location" : ""}</span>
      <span class="desc">${esc(p.main.desc)}</span>
      ${tags.length ? `<span class="tags">${tags.map((t) => `<i>${esc(t)}</i>`).join("")}</span>` : ""}
    </span>${side}</a></li>`;
}

// The guide's own words for wherever the filter has narrowed to
function contextCards(results, guide) {
  const out = [];
  const city = filter.city && guide.cities.find((c) => c.id === filter.city);
  const hoods = new Set(results.map((p) => p.hood).filter(Boolean));
  if (city && hoods.size === 1 && (filter.area.length || results.length < 40)) {
    const hood = city.blocks.find((b) => b.type === "hood" && b.name === [...hoods][0]);
    if (hood) out.push(`<aside class="card intro"><h2>${esc(hood.name)}</h2><p>${hood.dek}</p></aside>`);
  } else if (city && !filter.area.length && !filter.kind && !filter.q) {
    out.push(`<aside class="card intro"><h2>${esc(city.name)} <span lang="ja">${esc(city.jp)}</span></h2><p>${city.dek}</p></aside>`);
  }
  const musicish = filter.category === "Underground Music" || (filter.kind === "music" && !filter.category);
  if (musicish) {
    for (const c of guide.cities) {
      if (filter.city && c.id !== filter.city) continue;
      for (const b of c.blocks) if (b.type === "tip") out.push(`<aside class="card tip">${b.html}</aside>`);
    }
  }
  return out.join("");
}

function goneNotes(guide) {
  if (!filter.city) return "";
  const c = guide.cities.find((x) => x.id === filter.city);
  return c.blocks.filter((b) => b.type === "gone").map((b) => `<aside class="card gone">${b.html}</aside>`).join("");
}
