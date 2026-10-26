import { resized } from "./map.js";

// Draggable seam between the left panel (list / plan / place) and the map.
// Wide screens only; the map tab and the guide take the whole width, and
// narrow screens keep the CSS default of a full-width panel.
const MIN = 320, MAX_RIGHT = 360, DEFAULT = 440, KEY = "panel-w";
const wide = matchMedia("(min-width: 960px)");
let handle, want = null;

const clamp = (w) => Math.min(Math.max(w, MIN), Math.max(MIN, innerWidth - MAX_RIGHT));

// Paint the stored width, but only where the split exists: on a phone an
// inline pixel width would shrink the full-bleed panel.
function paint() {
  const root = document.documentElement;
  if (wide.matches && want != null) {
    const px = clamp(want);
    root.style.setProperty("--panel-w", px + "px");
    handle?.setAttribute("aria-valuenow", Math.round(px));
  } else {
    root.style.removeProperty("--panel-w");
    handle?.setAttribute("aria-valuenow", "");
  }
  resized();
}

function apply(w) {
  want = clamp(w);
  paint();
}

export function mountSplit() {
  handle = document.createElement("div");
  handle.className = "split";
  handle.id = "split";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize panel");
  handle.setAttribute("aria-valuemin", MIN);
  handle.setAttribute("aria-valuemax", MAX_RIGHT);
  handle.tabIndex = 0;
  handle.title = "Drag to resize · double-click to reset";
  document.body.appendChild(handle);

  const move = (e) => apply(e.clientX);
  const end = () => {
    handle.classList.remove("dragging");
    document.body.classList.remove("resizing");
    handle.removeEventListener("pointermove", move);
    if (want != null) localStorage.setItem(KEY, String(Math.round(want)));
  };
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end, { once: true });
    handle.addEventListener("pointercancel", end, { once: true });
  });

  // Double-click resets; arrows nudge for keyboard users
  handle.addEventListener("dblclick", () => apply(DEFAULT));
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16;
    const now = clamp(want ?? DEFAULT);
    if (e.key === "ArrowLeft") apply(now - step);
    else if (e.key === "ArrowRight") apply(now + step);
    else if (e.key === "Home") apply(DEFAULT);
    else return;
    e.preventDefault();
    localStorage.setItem(KEY, String(Math.round(want)));
  });

  const stored = parseInt(localStorage.getItem(KEY), 10);
  if (stored) want = stored;
  paint();

  // A window resize can push the panel outside the clamp, or cross the
  // breakpoint in either direction
  addEventListener("resize", paint);
  wide.addEventListener("change", paint);
}

// Hidden where a single view owns the screen
export function syncSplit(view) {
  if (!handle) return;
  handle.hidden = !wide.matches || view === "guide";
}
