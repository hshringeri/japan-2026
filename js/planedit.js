/* global Sortable */
import { esc, fold, formatDay, japanNow } from "./util.js";
import { app, applyPlan, emit } from "./state.js";
import { sendOps, passcode, apiReady, ApiError } from "./api.js";
import { openSheet, toast, askPasscode, ensurePasscode } from "./sheet.js";
import { catEmoji } from "./data.js";

// Editing the shared plan by hand: drag to reorder or move between days, tap to edit, add from the
// guide or as your own, remove with undo. Every change goes through the Worker, so all phones agree.

export const KIND_LABEL = {
  flight: "Flight", train: "Train", transfer: "Getting there", checkin: "Check in", checkout: "Check out",
  food: "Food", sight: "See", shop: "Shop", activity: "Do", golf: "Golf", night: "Night out", note: "Note",
};
// The plan kind a guide place most likely is
const PLACE_KIND = { eat: "food", drink: "night", music: "night", shop: "shop", play: "activity", unwind: "sight", cars: "activity" };

let sortables = [];
let dragging = false;
export const isDragging = () => dragging;

const findItem = (id) => {
  for (const d of app.data.trip.days) {
    const it = d.items.find((i) => i.id === id);
    if (it) return { day: d, item: it };
  }
  return null;
};

// Sends ops and applies the plan the server returns. Offers Undo unless this was an undo.
export async function runOps(ops, { undo = true, retried = false } = {}) {
  if (!apiReady()) { toast("Shared editing isn't set up yet (js/config.js)."); emit("plan"); return false; }
  if (!(await ensurePasscode())) { emit("plan"); return false; }
  try {
    const r = await sendOps(ops);
    applyPlan({ version: r.version, items: r.items }, { force: true });
    const text = !undo ? "Undone" : r.changes.length === 1 ? r.changes[0].text : `${r.changes.length} changes saved`;
    toast(text, undo ? { label: "Undo", run: () => runOps(r.inverse, { undo: false }) } : null);
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !retried) {
      passcode.clear();
      if (await askPasscode(true)) return runOps(ops, { undo, retried: true });
    }
    toast(e.message);
    // Put the screen back to the plan as it is
    emit("plan");
    return false;
  }
}

export function attachSortables(root) {
  sortables.forEach((s) => s.destroy());
  sortables = [];
  if (typeof Sortable === "undefined") return;
  for (const el of root.querySelectorAll(".items[data-date]")) {
    sortables.push(Sortable.create(el, {
      group: "plan",
      handle: ".grip",
      draggable: ".item[data-id]",
      animation: 150,
      delay: 120,
      delayOnTouchOnly: true,
      ghostClass: "ghost",
      chosenClass: "chosen",
      scroll: true,
      bubbleScroll: true,
      onStart: () => { dragging = true; },
      onEnd: (e) => {
        dragging = false;
        const id = e.item.dataset.id, date = e.to.dataset.date;
        if (e.from === e.to && e.oldIndex === e.newIndex) return;
        runOps([{ op: "move", id, date, index: e.newIndex }]);
      },
    }));
  }
}

const TIME = (v) => (v ? v.slice(0, 5) : "");

// "35.66, 139.70", a Google Maps link with @lat,lng or !3d…!4d…, or nothing
export function parseLatLng(s) {
  const t = String(s || "");
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    t.match(/[?&](?:q|query|destination|ll)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i) || t.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return lat >= 24 && lat <= 46 && lng >= 122 && lng <= 154 ? { lat, lng } : null;
}

function form(v, { title = true, dayPick = true } = {}) {
  const { trip } = app.data;
  const p = v.place && app.data.byId[v.place];
  return `
    ${title ? `<label class="f">Title<input name="title" required maxlength="120" value="${esc(v.title || "")}"></label>` : ""}
    <div class="frow">
      ${dayPick ? `<label class="f">Day<select name="date">${trip.days.map((d) => `<option value="${d.date}"${d.date === v.date ? " selected" : ""}>${esc(formatDay(d.date))} · ${esc(d.short || d.city)}</option>`).join("")}</select></label>` : ""}
      <label class="f">Kind<select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}"${k === (v.kind || "activity") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <div class="frow">
      <label class="f">Time<input name="time" type="time" value="${esc(TIME(v.time))}"></label>
      <label class="f">Ends<input name="end" type="time" value="${esc(TIME(v.end))}"></label>
      <label class="f">Status<select name="status"><option value="">—</option><option value="booked"${v.status === "booked" ? " selected" : ""}>Booked</option><option value="tbd"${v.status === "tbd" ? " selected" : ""}>TBD</option></select></label>
    </div>
    <fieldset class="f who"><legend>Who</legend>${trip.people.map((n) => `<label class="chip"><input type="checkbox" name="who" value="${esc(n)}"${v.who?.includes(n) ? " checked" : ""}>${esc(n)}</label>`).join("")}</fieldset>
    <label class="f">Notes<textarea name="notes" rows="2" maxlength="500">${esc(v.notes || "")}</textarea></label>
    ${p ? `<p class="hint">Linked to ${esc(p.name)} in the guide, so it uses the guide's location.</p>` : `
    <label class="f">Location<input name="where" placeholder="Paste a Google Maps link or 35.66, 139.70" value="${v.lat != null ? `${v.lat}, ${v.lng}` : ""}"></label>`}
    <label class="f">Link<input name="url" type="url" maxlength="500" placeholder="https://" value="${esc(v.url || "")}"></label>`;
}

// The form's values as item fields; null for a field that was emptied
function read(el, before = {}) {
  const f = new FormData(el.querySelector("form"));
  const out = {};
  const s = (k) => (f.get(k) ?? "").toString().trim();
  if (f.has("title")) out.title = s("title");
  out.kind = s("kind");
  out.time = s("time") || null;
  out.end = s("end") || null;
  out.status = s("status") || null;
  const who = f.getAll("who").map(String);
  out.who = who.length ? who : null;
  out.notes = s("notes") || null;
  let url = s("url") || null;
  if (f.has("where")) {
    const raw = s("where");
    const ll = parseLatLng(raw);
    if (ll) Object.assign(out, ll);
    else if (!raw) Object.assign(out, { lat: null, lng: null });
    else if (/^https?:\/\//.test(raw)) {
      // A short maps.app.goo.gl link can't be read from here: keep it as the item's link
      url ||= raw;
      if (before.lat != null) Object.assign(out, { lat: before.lat, lng: before.lng });
    } else throw new Error("Couldn't read that location. Paste a Google Maps link or coordinates like 35.66, 139.70.");
  }
  out.url = url;
  return out;
}

// Only what changed, as an update op's fields
function diff(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after)) {
    const was = before[k] ?? null;
    if (JSON.stringify(was) !== JSON.stringify(v)) out[k] = v;
  }
  // The guide supplies a linked place's coordinates; they aren't the item's own
  if (before.placeObj) { delete out.lat; delete out.lng; }
  return out;
}

export async function editItem(id) {
  const found = findItem(id);
  if (!found) return;
  const { day, item } = found;
  const s = openSheet(`
    <h2>Edit</h2>
    ${form({ ...item, date: day.date })}
    <p class="err" hidden></p>
    <div class="sheetacts">
      <button type="button" class="btn danger" data-remove>Remove</button>
      <button value="cancel" formnovalidate class="btn">Cancel</button>
      <button value="save" class="btn primary">Save</button>
    </div>`);
  s.el.querySelector("[data-remove]").addEventListener("click", () => { s.close("remove"); });
  // Validate before the sheet closes
  let fields, date;
  s.el.querySelector("form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "save") return;
    try {
      fields = diff(item, read(s.el, item));
      date = new FormData(s.el.querySelector("form")).get("date");
    } catch (err) {
      e.preventDefault();
      const p = s.el.querySelector(".err");
      p.textContent = err.message;
      p.hidden = false;
    }
  });
  const v = await s.done;
  if (v === "remove") return runOps([{ op: "remove", id }]);
  if (v !== "save") return;
  const ops = [];
  if (Object.keys(fields).length) ops.push({ op: "update", id, fields });
  if (date && date !== day.date) ops.push({ op: "move", id, date });
  if (ops.length) runOps(ops);
}

export const removeItem = (id) => runOps([{ op: "remove", id }]);

// The day someone most likely means: the one picked on the list or map, else today, else day one
export function defaultDay() {
  const days = app.data.trip.days.map((d) => d.date);
  const today = japanNow().date;
  return days.includes(app.date) ? app.date : days.includes(today) ? today : days[0];
}

// Add: search the guide or type your own, then the details
export async function addItem(date = defaultDay(), placeId = null) {
  let preset = placeId ? fromPlace(app.data.byId[placeId], date) : null;
  if (!preset) {
    const pick = await choose(date);
    if (!pick) return;
    preset = pick;
  }
  const s = openSheet(`
    <h2>Add to the plan</h2>
    ${preset.place ? `<p class="picked">${catEmoji(app.data.byId[preset.place])} ${esc(preset.title)}</p>` : ""}
    ${form(preset, { title: !preset.place })}
    <p class="err" hidden></p>
    <div class="sheetacts"><button value="cancel" formnovalidate class="btn">Cancel</button><button value="save" class="btn primary">Add</button></div>`);
  let item, day;
  s.el.querySelector("form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "save") return;
    try {
      const v = read(s.el);
      day = new FormData(s.el.querySelector("form")).get("date");
      item = Object.fromEntries(Object.entries({ ...v, title: v.title ?? preset.title, place: preset.place || null }).filter(([, x]) => x != null));
    } catch (err) {
      e.preventDefault();
      const p = s.el.querySelector(".err");
      p.textContent = err.message;
      p.hidden = false;
    }
  });
  if ((await s.done) !== "save") return;
  runOps([{ op: "add", date: day, item }]);
}

function fromPlace(p, date) {
  if (!p) return null;
  return { title: p.name, kind: PLACE_KIND[p.kind] || "activity", place: p.id, date, url: p.main.url || null };
}

// Step one of adding: a search over the guide, or a new place of your own
async function choose(date) {
  const s = openSheet(`
    <h2>Add to ${esc(formatDay(date))}</h2>
    <label class="search"><input name="q" type="search" placeholder="Search the guide, or name a new place" autocomplete="off" enterkeyhint="search"></label>
    <ol class="picks"></ol>
    <button type="button" class="btn own" hidden></button>
    <div class="sheetacts"><button value="cancel" formnovalidate class="btn">Cancel</button></div>`);
  const input = s.el.querySelector("input"), list = s.el.querySelector(".picks"), own = s.el.querySelector(".own");
  let result = null;
  const day = app.data.trip.dayByDate[date];
  const render = () => {
    const q = fold(input.value);
    const hits = q ? app.data.places.filter((p) => p.search.includes(q))
      .sort((a, b) => (b.nameFold.startsWith(q) - a.nameFold.startsWith(q)) || ((b.city === day?.city) - (a.city === day?.city)) || a.order - b.order).slice(0, 12) : [];
    list.innerHTML = hits.map((p) => `<li><button type="button" data-pid="${p.id}"><span>${catEmoji(p)}</span><span><b>${esc(p.name)}</b><small>${esc(p.area)} · ${esc(p.categories[0])}</small></span></button></li>`).join("");
    own.hidden = !input.value.trim();
    own.textContent = `+ Add “${input.value.trim()}” as a new place`;
  };
  input.addEventListener("input", render);
  // Enter shouldn't close the sheet
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pid]");
    if (!b) return;
    result = fromPlace(app.data.byId[b.dataset.pid], date);
    s.close("pick");
  });
  own.addEventListener("click", () => { result = { title: input.value.trim(), kind: "sight", date }; s.close("pick"); });
  setTimeout(() => input.focus(), 50);
  await s.done;
  return result;
}
