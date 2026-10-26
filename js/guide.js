import { esc } from "./util.js";
import { app } from "./state.js";

// The original magazine, rebuilt from the data with the original markup so guide.css styles it unchanged.
// In-page links become #/guide/<anchor> routes so they don't fight the app router.
let built = false;

export function renderGuide(root, anchor) {
  if (!built) {
    root.innerHTML = `<div class="guide-wrap"><a class="guide-close" href="#/list">‹ Back to the app</a><div class="guide">${magazine()}</div></div>`;
    root.querySelector("#t-viewtoggle")?.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const bycat = b.dataset.view === "bycat";
      root.querySelector("#t-byhood").hidden = bycat;
      root.querySelector("#t-bycat").hidden = !bycat;
      root.querySelectorAll("#t-viewtoggle button").forEach((k) => k.classList.toggle("on", k === b));
    });
    built = true;
  }
  const target = anchor && root.querySelector(`#${CSS.escape(anchor)}`);
  if (target) {
    if (target.closest("[hidden]")) root.querySelector('#t-viewtoggle [data-view="bycat"]')?.click();
    requestAnimationFrame(() => target.scrollIntoView());
  } else if (!anchor) root.scrollTop = 0;
}

const link = (href) => (href.startsWith("#") ? `#/guide/${href.slice(1)}` : href);
const relink = (html) => html.replace(/href="#([^"/][^"]*)"/g, 'href="#/guide/$1"');

function figure(f, cls) {
  return `<figure class="${cls}"><img src="${f.img}" alt="${esc(f.alt)}" loading="lazy" decoding="async">${f.caption != null ? `<figcaption>${f.caption}</figcaption>` : ""}</figure>`;
}

function entry(p, category) {
  const l = p.listings.find((x) => x.category === category);
  const h4 = l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(p.name)} <span class="arr">↗</span></a>` : esc(p.name);
  return `<article class="e"><h4>${h4}</h4><p class="d">${esc(l.desc)}</p><p class="m"><a class="map" href="${esc(l.mapUrl)}" target="_blank" rel="noopener">⌖ ${esc(l.address)}</a>${l.info != null ? ` · ${esc(l.info)}` : ""} · <a class="map" href="#/place/${p.id}">details</a></p></article>`;
}

function category(b, extra = "") {
  return `<div class="cat"${b.id ? ` id="${b.id}"` : ""}><h3>${esc(b.name)}</h3><div class="grid">${b.places.map((id) => entry(app.data.byId[id], b.name)).join("")}</div>${extra}</div>`;
}

const slug = (s) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function city(c) {
  const head = `<div class="cityhead">${figure(c.hero, "hero")}<div class="cityttl"><span class="num">${c.num}</span><h2>${c.name}</h2><span class="jp">${c.jp}</span></div></div><p class="dek">${c.dek}</p>`;
  const cats = c.blocks.filter((b) => b.type === "category");
  let body = "";
  if (c.id === "tokyo") {
    const hoods = c.blocks.filter((b) => b.type === "hood");
    const count = (h) => { const i = c.blocks.indexOf(h); const end = c.blocks.findIndex((b, j) => j > i && b.type === "hood"); return new Set(c.blocks.slice(i, end < 0 ? undefined : end).filter((b) => b.type === "category").flatMap((b) => b.places)).size; };
    body += `<div class="tview" id="t-viewtoggle"><button type="button" data-view="byhood" class="on">By neighbourhood</button><button type="button" data-view="bycat">By category</button></div>`;
    body += `<div id="t-byhood"><nav class="hoodnav">${hoods.map((h) => `<a href="${link("#" + h.id)}">${esc(h.name)}<span>${count(h)}</span></a>`).join("")}</nav>`;
    let open = false;
    for (const b of c.blocks) {
      if (b.type === "hood") { if (open) body += "</div>"; body += `<div class="hood" id="${b.id}"><h3 class="hoodttl">${esc(b.name)}</h3><p class="hooddek">${b.dek}</p>`; open = true; }
      else if (b.type === "category") body += category(b);
      else if (b.type === "band") { if (open) { body += "</div>"; open = false; } body += figure(b, "band"); }
      else body += `<aside class="${b.type}">${relink(b.html)}</aside>`;
    }
    if (open) body += "</div>";
    body += "</div>";
    // By category: the same entries regrouped, in the guide's category order
    const order = app.data.taxonomy.kinds.flatMap((k) => k.categories);
    const byCat = new Map();
    for (const b of cats) for (const id of b.places) { if (!byCat.has(b.name)) byCat.set(b.name, []); byCat.get(b.name).push(id); }
    const names = [...byCat.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    body += `<div id="t-bycat" hidden><nav class="hoodnav">${names.map((n) => `<a href="${link("#t-" + slug(n))}">${esc(n)}<span>${byCat.get(n).length}</span></a>`).join("")}</nav>`;
    body += names.map((n) => `<div class="hood" id="t-${slug(n)}">${category({ name: n, places: byCat.get(n) })}</div>`).join("");
    body += "</div>";
  } else {
    body += `<nav class="catindex">${cats.map((b) => `<a href="${link("#" + b.id)}">${esc(b.name)}<span>${b.places.length}</span></a>`).join("")}</nav>`;
    for (let i = 0; i < c.blocks.length; i++) {
      const b = c.blocks[i];
      if (b.type === "category") {
        const tip = c.blocks[i + 1]?.type === "tip" ? `<aside class="tip">${relink(c.blocks[++i].html)}</aside>` : "";
        body += category(b, tip);
      } else if (b.type === "band") body += figure(b, "band");
      else body += `<aside class="${b.type}">${relink(b.html)}</aside>`;
    }
  }
  return `<section class="city" id="${c.id}">${head}${body}</section>`;
}

function magazine() {
  const g = app.data.guide, c = g.cover;
  return `
    <header class="cover meme"><img src="${c.img}" alt="${esc(c.alt)}">
      <div class="t"><div class="issue">${c.issue.map((s) => `<span>${esc(s)}</span>`).join("")}</div>
      <div><p class="lede">${c.lede}</p><ul class="chips">${c.chips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h1 class="mast">${c.mast}</h1></div></div>
      <figcaption>${c.caption}</figcaption></header>
    <aside class="manifesto">${g.manifesto}</aside><p class="cornersrc">${g.discovery}</p>
    <section class="inside"><div><h2>In this issue</h2><nav class="toc">${g.toc.map((t) => `<a${t.href.startsWith("#t-") ? ' class="sub"' : ""} href="${link(t.href)}">${t.html}</a>`).join("")}</nav>
      <p style="margin-top:18px;color:var(--mute);font-size:14px">${g.tocNote}</p></div>
      <div class="rules"><h3>${g.rules.title}</h3><ul>${g.rules.items.map((li) => `<li>${li}</li>`).join("")}</ul></div></section>
    ${g.cities.map(city).join("")}
    <footer>${g.footer}</footer>`;
}
