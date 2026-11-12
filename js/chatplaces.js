import { applyPlaces } from "./state.js";
import { removePlace, passcode, apiReady, ApiError } from "./api.js";
import { toast, askPasscode, ensurePasscode } from "./sheet.js";

// Taking a place the trip API added off everyone's map, or putting it back. Both go through
// the Worker, which keeps the list all the phones share.

async function send(call, retried = false) {
  if (!apiReady()) { toast("The trip server isn't set up yet (js/config.js)."); return null; }
  if (!(await ensurePasscode())) return null;
  try {
    const r = await call();
    applyPlaces(r, { force: true });
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !retried) {
      passcode.clear();
      if (await askPasscode(true)) return send(call, true);
    }
    toast(e.message);
    return null;
  }
}

export async function removeChatPlace(id, { undo = true } = {}) {
  const r = await send(() => removePlace(id, !undo));
  if (!r) return false;
  toast(undo ? `Took ${r.place.name} off the map` : `Put ${r.place.name} back`,
    undo ? { label: "Undo", run: () => removeChatPlace(id, { undo: false }) } : null);
  return true;
}
