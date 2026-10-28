import { esc, formatDay, distanceKm, formatDistance, walkMinutes, directionsUrl, hoursBadge, storage } from "./util.js";
import { app, onApp, startLocation, hereInJapan, refreshPlan } from "./state.js";
import { sendChat, apiReady, passcode } from "./api.js";
import { askPasscode, ensurePasscode } from "./sheet.js";
import { runOps, defaultDay } from "./planedit.js";

// The Ask tab: a chat with Claude about the trip. The Worker holds the key, checks every limit
// and runs the tools; this side sends one message at a time and draws the streamed reply.

const MAX_CHARS = 500;     // the Worker enforces the same number
const MAX_TURNS = 12;
const KEY = "chat";
const SUGGEST = ["I'm hungry", "What's near us tomorrow?", "Weather this week", "Fit in an onsen on the 19th"];
const TOOL_STATUS = {
  nearby: "Looking for places nearby…", get_weather: "Checking the weather…", travel_estimate: "Working out travel time…",
  edit_plan: "Updating the plan…", get_day: "Reading the plan…",
};

let root, thread, form, input, daySel, locBtn, counter, sendBtn;
let state = storage.get(KEY, null) || fresh();
let busy = false, frame = 0;

function fresh() {
  return { id: crypto.randomUUID(), messages: [], turns: 0, full: false };
}
const save = () => storage.set(KEY, state);

export function mountChat(el) {
  root = el;
  root.innerHTML = `
    <header class="viewhead"><h1>Ask</h1><p class="who turns"></p><button type="button" class="iconbtn" data-new>New chat</button></header>
    <div class="thread" aria-live="polite"></div>
    <form class="composer" autocomplete="off">
      <div class="ctxrow">
        <label class="daypick"><span class="sr">Day</span><select name="date"></select></label>
        <button type="button" class="locbtn"></button>
      </div>
      <div class="inputrow">
        <textarea name="text" rows="1" placeholder="Ask about the trip…" enterkeyhint="send"></textarea>
        <button class="send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
      </div>
      <p class="counter" aria-live="polite"></p>
    </form>`;
  thread = root.querySelector(".thread");
  form = root.querySelector(".composer");
  input = form.querySelector("textarea");
  daySel = form.querySelector("select");
  locBtn = form.querySelector(".locbtn");
  counter = form.querySelector(".counter");
  sendBtn = form.querySelector(".send");

  root.querySelector("[data-new]").addEventListener("click", () => {
    if (busy) return;
    state = fresh();
    save();
    render();
    input.focus();
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("input", syncInput);
  // Enter sends on a keyboard; Shift+Enter is a new line
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover)").matches) { e.preventDefault(); send(input.value); }
  });
  // Tapping Send mustn't take focus from the text box: the keyboard would drop, the layout would
  // shift, and the tap would land somewhere else
  sendBtn.addEventListener("pointerdown", (e) => e.preventDefault());
  input.addEventListener("focus", () => document.body.classList.add("typing"));
  input.addEventListener("blur", () => document.body.classList.remove("typing"));
  locBtn.addEventListener("click", () => { if (!app.here) startLocation(); });
  thread.addEventListener("click", (e) => {
    const s = e.target.closest("[data-suggest]");
    if (s) { send(s.dataset.suggest); return; }
    const u = e.target.closest("[data-undo]");
    if (u) undo(+u.dataset.msg, +u.dataset.undo);
    const n = e.target.closest("[data-new]");
    if (n) root.querySelector(".viewhead [data-new]").click();
  });

  // The keyboard covers the bottom of the screen; keep the composer above it
  const vv = window.visualViewport;
  vv?.addEventListener("resize", () => {
    document.documentElement.style.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  });

  onApp("here", syncLocation);
  onApp("date", () => { if (app.date) daySel.value = app.date; });
  onApp("plan", () => render());
  render();
}

export function showChat() {
  fillDays();
  syncLocation();
  render();
}

function fillDays() {
  const want = daySel.value || defaultDay();
  daySel.innerHTML = app.data.trip.days.map((d) => `<option value="${d.date}">${esc(formatDay(d.date))} · ${esc(d.short || d.city)}</option>`).join("");
  daySel.value = want;
}

function syncLocation() {
  if (!locBtn) return;
  let label, on = false;
  if (app.here && hereInJapan()) { label = "Near you"; on = true; }
  else if (app.here) label = "Not in Japan yet";
  else if (app.locating) label = "Finding you…";
  else label = app.locationError ? "Location off" : "Use my location";
  locBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>${esc(label)}`;
  locBtn.classList.toggle("on", on);
  locBtn.title = on ? "Suggestions are ranked from where you are" : "Without your location, suggestions are ranked from the day's stops";
}

function syncInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  const n = [...input.value].length;
  counter.textContent = n > MAX_CHARS - 100 ? `${n} / ${MAX_CHARS}` : "";
  counter.classList.toggle("over", n > MAX_CHARS);
  sendBtn.disabled = busy || !input.value.trim() || n > MAX_CHARS || state.full;
}

async function send(raw) {
  const text = String(raw || "").trim();
  if (!text || busy || state.full || [...text].length > MAX_CHARS) return;
  if (!apiReady()) return;
  if (!(await ensurePasscode())) return;
  busy = true;
  input.value = "";
  syncInput();
  const date = daySel.value;
  state.messages.push({ role: "user", text, date });
  const reply = { role: "assistant", text: "", plan: [], status: "Thinking…" };
  state.messages.push(reply);
  render();
  const here = app.here ? { lat: app.here.lat, lng: app.here.lng, accuracy: app.here.accuracy } : null;
  try {
    await sendChat({ chatId: state.id, text, date, here }, (event, d) => {
      if (event === "text") { reply.text += d.t; reply.status = null; }
      else if (event === "tool") reply.status = d.names.map((n) => TOOL_STATUS[n]).find(Boolean) || "Working…";
      else if (event === "plan") { reply.plan.push({ changes: d.changes, inverse: d.inverse }); refreshPlan(); }
      else if (event === "done") { state.turns = d.turns; state.full = d.full; if (d.offTopic) reply.offTopic = true; }
      else if (event === "error") { reply.error = d.message; if (d.code === "chat_full") state.full = true; }
      paint();
    });
  } catch (e) {
    if (e.status === 401) {
      // Wrong passcode: forget it, take the message back and try again once a new one is in
      state.messages.splice(-2);
      passcode.clear();
      busy = false;
      render();
      if (await askPasscode(true)) send(text);
      return;
    }
    reply.error = e.message;
    if (e.code === "chat_full") state.full = true;
  } finally {
    busy = false;
    reply.status = null;
    save();
    render();
  }
}

async function undo(msgIndex, planIndex) {
  const p = state.messages[msgIndex]?.plan?.[planIndex];
  if (!p || p.undone) return;
  if (await runOps(p.inverse, { undo: false })) {
    p.undone = true;
    save();
    render();
  }
}

// Draw at most once a frame while text streams in
function paint() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
}

function render() {
  if (!thread) return;
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  root.querySelector(".turns").textContent = state.turns ? `${state.turns} of ${MAX_TURNS} messages` : "";
  if (!apiReady()) {
    thread.innerHTML = `<div class="hello"><p>The Ask tab needs the trip server. Once it's deployed, its address goes in <code>js/config.js</code>.</p></div>`;
    form.hidden = true;
    return;
  }
  thread.innerHTML = state.messages.length ? state.messages.map(bubble).join("") : `
    <div class="hello">
      <p>Ask anything about the trip. Answers use our plan and our guide, your location if it's on, and the day picked below. It can also move things around in the plan.</p>
      <div class="suggest">${SUGGEST.map((s) => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <p class="fine">Up to ${MAX_TURNS} messages per chat and ${MAX_CHARS} characters per message. It only answers questions about the trip.</p>
    </div>`;
  if (state.full) thread.insertAdjacentHTML("beforeend", `<div class="full"><p>This chat is full.</p><button type="button" class="btn primary" data-new>Start a new chat</button></div>`);
  form.hidden = state.full;
  syncInput();
  if (nearBottom || busy) thread.scrollTop = thread.scrollHeight;
}

function bubble(m, i) {
  if (m.role === "user") return `<div class="msg me"><p>${esc(m.text)}</p><small>${esc(formatDay(m.date))}</small></div>`;
  const streaming = busy && i === state.messages.length - 1;
  // Hide a half-written [[place:…]] marker until it's complete
  const text = streaming ? m.text.replace(/\[\[[^\]]*\]?$/, "") : m.text;
  const date = state.messages[i - 1]?.date;
  return `<div class="msg ai${m.offTopic ? " off" : ""}">
    ${text ? md(text, date) : ""}
    ${m.status ? `<p class="status">${esc(m.status)}</p>` : ""}
    ${m.plan.map((p, j) => `<div class="changes${p.undone ? " undone" : ""}">
        <b>${p.undone ? "Undone" : "Plan updated"}</b>
        <ul>${p.changes.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>
        ${p.undone ? "" : `<button type="button" class="chip" data-msg="${i}" data-undo="${j}">Undo</button>`}
      </div>`).join("")}
    ${m.error ? `<p class="err">${esc(m.error)}</p>` : ""}
  </div>`;
}

// Just enough Markdown for chat: paragraphs, lists, bold, and the [[place:id]] / [[item:id]] cards.
// Everything is escaped first, so the reply can't inject markup.
function md(src, date) {
  const out = [];
  let list = null;
  for (const line of esc(src).split("\n")) {
    const li = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (li) {
      const kind = li[1] ? "ol" : "ul";
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2], date)}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(`<p><b>${inline(h[1], date)}</b></p>`);
    else if (line.trim()) out.push(`<p>${inline(line, date)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}

const inline = (s, date) => s
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/\[\[(place|item):([a-z0-9-]+)\]\]/g, (m, kind, id) => (kind === "place" ? placeCard(id, date) : itemCard(id)) || m);

function away(pt) {
  if (!hereInJapan() || pt.lat == null) return "";
  const km = distanceKm(app.here, pt);
  return `${formatDistance(km)}${km < 2.5 ? ` · ${walkMinutes(km)} min walk` : ""}`;
}

function placeCard(id, date) {
  const p = app.data.byId[id];
  if (!p) return null;
  const dist = away(p);
  return `<span class="pcard">
    <a href="#/place/${esc(p.id)}"><span class="dot" style="--c:${p.color}"></span><b>${esc(p.name)}</b><small>${esc(p.area)} · ${esc(p.categories[0])}${dist ? ` · ${dist}` : ""}</small></a>
    ${hoursBadge(p, date)}
    ${p.lat != null ? `<a class="dir" href="${esc(directionsUrl(p))}" target="_blank" rel="noopener">Directions ↗</a>` : ""}
  </span>`;
}

function itemCard(id) {
  for (const d of app.data.trip.days) {
    const it = d.items.find((i) => i.id === id);
    if (!it) continue;
    const dist = away(it);
    return `<span class="pcard">
      <a href="#/plan" data-day="${d.date}"><span class="dot" style="--c:var(--ink)"></span><b>${esc(it.title)}</b><small>${esc(formatDay(d.date))}${it.time ? ` · ${esc(it.time)}` : ""}${dist ? ` · ${dist}` : ""}</small></a>
      ${it.lat != null ? `<a class="dir" href="${esc(directionsUrl(it))}" target="_blank" rel="noopener">Directions ↗</a>` : ""}
    </span>`;
  }
  return null;
}
