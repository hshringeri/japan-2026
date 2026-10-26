import { esc, distanceKm, formatDistance, walkMinutes, formatDay } from "./util.js";
import { filter, matches, onFilter } from "./filter.js";
import { app, onApp, anchor } from "./state.js";
import { mountFilterBar, mountDateStrip } from "./filterbar.js";

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
    results.forEach((p) => (p.dist = a ? distanceKm(a, p) : null));
    if (a) results.sort((x, y) => (x.dist ?? 1e9) - (y.dist ?? 1e9));
    else if (filter.q) {
      const q = filter.q.toLowerCase();
      results.sort((x, y) => (y.name.toLowerCase().startsWith(q) - x.name.toLowerCase().startsWith(q)) || x.order - y.order);
    } else results.sort((x, y) => x.order - y.order || catOrder[x.main.category] - catOrder[y.main.category]);

    ctx.innerHTML = contextCards(results, guide);
    const where = a ? (a.kind === "here" ? "nearest to you" : `nearest to ${esc(a.label)} · ${formatDay(app.date)}`) : "";
    count.innerHTML = `${results.length} place${results.length === 1 ? "" : "s"}${where ? ` <span>${where}</span>` : ""}`;
    rows.innerHTML = results.length ? results.map(row).join("") :
      `<li class="empty">Nothing matches. Try removing a filter.</li>`;
    after.innerHTML = goneNotes(guide);
  }

  onFilter(render);
  onApp("date", render);
  onApp("here", () => { if (!app.date) render(); });
  render();
}

function row(p) {
  const flags = (p.tags?.flags || []).filter((f) => f !== "Walk-in").slice(0, 3);
  const detail = [...(p.tags?.cuisine || []), ...(p.tags?.genre || []), ...(p.tags?.style || [])].slice(0, 3);
  const dist = p.dist != null ? `<span class="dist">${formatDistance(p.dist)}${p.dist < 2.5 ? `<small>${walkMinutes(p.dist)} min walk</small>` : ""}</span>` : "";
  return `<li><a class="row" href="#/place/${p.id}">
    <span class="dot" style="--c:${p.color}"></span>
    <span class="body">
      <span class="name">${esc(p.name)}</span>
      <span class="sub">${esc(p.area)} · ${esc(p.categories.join(", "))}${p.precision === "area" ? " · approx. location" : ""}</span>
      <span class="desc">${esc(p.main.desc)}</span>
      ${detail.length || flags.length ? `<span class="tags">${[...detail, ...flags].map((t) => `<i>${esc(t)}</i>`).join("")}</span>` : ""}
    </span>${dist}</a></li>`;
}

// The guide's own words for wherever the filter has narrowed to
function contextCards(results, guide) {
  const out = [];
  const city = filter.city && guide.cities.find((c) => c.id === filter.city);
  const hoods = new Set(results.map((p) => p.hood).filter(Boolean));
  if (city && hoods.size === 1 && (filter.area || results.length < 40)) {
    const hood = city.blocks.find((b) => b.type === "hood" && b.name === [...hoods][0]);
    if (hood) out.push(`<aside class="card intro"><h2>${esc(hood.name)}</h2><p>${hood.dek}</p></aside>`);
  } else if (city && !filter.area && !filter.kind && !filter.q) {
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
