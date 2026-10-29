import { esc, formatDay, weekday, dayNumber, japanNow, storage } from "./util.js";
import { KIND_EMOJI, CATEGORY_EMOJI } from "./data.js";
import { filter, setFilter, suggestions, picked, applyChip, removePicked, onFilter } from "./filter.js";
import { app, setDate, onApp, emit } from "./state.js";

// Chips carry the same marks as the list, where the value has one
function chipEmoji(c) {
  const e = c.key === "kind" ? KIND_EMOJI[c.value] : c.key === "category" ? CATEGORY_EMOJI[c.label] : "";
  return e ? `${e} ` : "";
}

// Search box + picked chips + next-step chips. One instance per view, all kept in sync.
export function mountFilterBar(root, { compact = false } = {}) {
  root.classList.add("filterbar");
  root.innerHTML = `
    <div class="searchrow">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input type="search" placeholder="Search places, food, areas…" autocomplete="off" enterkeyhint="search">
        <button type="button" class="clear" aria-label="Clear search" hidden>×</button>
      </label>
      <button type="button" class="datetoggle" aria-label="Trip dates" title="Show or hide the trip dates">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      </button>
    </div>
    <div class="chiprow" role="toolbar" aria-label="Filters"></div>
    <div class="chiprow types" role="toolbar" aria-label="Types" hidden></div>`;
  const input = root.querySelector("input"), clearBtn = root.querySelector(".clear");
  const [row, typeRow] = root.querySelectorAll(".chiprow");
  input.value = filter.q;

  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => setFilter({ q: input.value.trim() }), 120);
  });
  clearBtn.addEventListener("click", () => { input.value = ""; setFilter({ q: "" }); input.focus(); });
  const dateBtn = root.querySelector(".datetoggle");
  dateBtn.addEventListener("click", () => setDatesShown(!datesShown()));
  const syncDateBtn = () => {
    dateBtn.setAttribute("aria-pressed", datesShown());
    // Marked while a day is picked, so a hidden date row still says you're looking ahead
    dateBtn.classList.toggle("ahead", !!app.date);
  };
  onApp("dates", syncDateBtn);
  onApp("date", syncDateBtn);
  syncDateBtn();

  root.addEventListener("click", (e) => {
    const b = e.target.closest(".chiprow button");
    if (!b) return;
    if (b.dataset.remove != null) removePicked(JSON.parse(b.dataset.remove));
    else if (b.dataset.reset != null) setFilter({ city: null, area: null, kind: null, category: null, tags: [], q: "" });
    else applyChip(b.dataset.key, b.dataset.value);
    row.scrollTo({ left: 0, behavior: "smooth" });
    typeRow.scrollTo({ left: 0, behavior: "smooth" });
  });

  function render() {
    if (document.activeElement !== input && input.value !== filter.q) input.value = filter.q;
    clearBtn.hidden = !filter.q;
    const { groups } = suggestions(app.data.places, app.data);
    const sel = picked(app.data);
    const chip = (c) => `<button type="button" class="chip" data-key="${esc(c.key)}" data-value="${esc(c.value)}">${esc(chipEmoji(c))}${esc(c.label)}<small>${c.count}</small></button>`;
    let html = sel.map((s) => `<button type="button" class="chip on" data-remove='${esc(JSON.stringify(s))}'>${esc(chipEmoji(s))}${esc(s.label)}<span aria-hidden="true">×</span></button>`).join("");
    if (sel.length > 1) html += `<button type="button" class="chip reset" data-reset>Clear</button>`;
    for (const g of groups.filter((g) => g.row === 1)) {
      if (html) html += `<span class="sep" aria-hidden="true"></span>`;
      html += g.chips.map(chip).join("");
    }
    row.innerHTML = html;
    // Every type (Gorpcore, Vinyl Bars, Gaming Cafes…) on a row of its own until you drill in
    const types = groups.filter((g) => g.row === 2).flatMap((g) => g.chips);
    typeRow.hidden = !types.length;
    typeRow.innerHTML = types.map(chip).join("");
  }
  onFilter(render);
  onApp("data", render);
  onApp("places", render);
  render();
  if (compact) root.classList.add("compact");
  return { render };
}

// The date rows show unless you've hidden them; every view's toggle and strip follow one setting
const datesShown = () => storage.get("datesShown", true);
function setDatesShown(on) {
  storage.set("datesShown", on);
  document.body.classList.toggle("dates-off", !on);
  emit("dates", on);
}
document.body.classList.toggle("dates-off", !datesShown());

// "Now" plus one chip per trip day. Picking a day looks ahead to it on the map and list.
export function mountDateStrip(root) {
  root.classList.add("datestrip");
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setDate(b.dataset.date || null);
  });
  function render() {
    const trip = app.data?.trip;
    if (!trip) { root.hidden = true; return; }
    root.hidden = false;
    const today = japanNow().date;
    root.innerHTML = `<button type="button" class="${app.date ? "" : "on"}" data-date="">
        <b>Now</b><small>${trip.dayByDate[today] ? "today" : "live"}</small></button>` +
      trip.days.map((d) => `<button type="button" class="${app.date === d.date ? "on" : ""}${d.date === today ? " today" : ""}" data-date="${d.date}" title="${esc(formatDay(d.date))}">
        <small>${weekday(d.date)}</small><b>${dayNumber(d.date)}</b><small class="c">${esc(d.short || d.city)}</small></button>`).join("");
    centre();
  }
  // Scroll the strip itself (not the page) so the picked day sits in the middle
  function centre() {
    const on = root.querySelector(".on");
    if (on) root.scrollLeft = on.offsetLeft - root.clientWidth / 2 + on.clientWidth / 2;
  }
  onApp("route", () => requestAnimationFrame(centre));
  onApp("date", render);
  onApp("data", render);
  render();
}
