import { esc } from "./util.js";
import { passcode } from "./api.js";

// A bottom sheet for forms on a phone (a centred dialog on wide screens). Resolves when closed.
export function openSheet(html, mount) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `<form method="dialog" class="sheetbody">${html}</form>`;
  document.body.append(dlg);
  const done = new Promise((resolve) => dlg.addEventListener("close", () => { resolve(dlg.returnValue); dlg.remove(); }));
  // Tapping the dimmed backdrop closes it
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });
  mount?.(dlg);
  dlg.showModal();
  return { el: dlg, done, close: (v) => dlg.close(v) };
}

let toastTimer;
// A note above the tab bar, with one optional action such as Undo
export function toast(text, action) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  el.hidden = false;
  if (action) el.querySelector("button").addEventListener("click", () => { el.hidden = true; action.run(); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 7000 : 3500);
}

// Asks for the trip passcode once per phone. Resolves true when one was entered.
export async function askPasscode(wrong = false) {
  const s = openSheet(`
    <h2>Trip passcode</h2>
    <p class="hint">${wrong ? "That passcode didn't work. " : ""}Editing the plan and the Ask tab need the passcode the group shares. It's saved on this phone only.</p>
    <input name="pass" type="password" autocomplete="current-password" required placeholder="Passcode" value="">
    <div class="sheetacts"><button value="cancel" formnovalidate class="btn">Cancel</button><button value="ok" class="btn primary">Save</button></div>`);
  const input = s.el.querySelector("input");
  setTimeout(() => input.focus(), 50);
  const v = await s.done;
  if (v !== "ok" || !input.value.trim()) return false;
  passcode.set(input.value.trim());
  return true;
}

export async function ensurePasscode() {
  return passcode.get() ? true : askPasscode();
}
