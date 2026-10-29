import { applyPlaces } from "./state.js";
import { addPlace, removePlace, passcode, apiReady, ApiError } from "./api.js";
import { toast, askPasscode, ensurePasscode } from "./sheet.js";

// Putting a place the chat suggested on everyone's map, and taking one off again. Both go through
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

// Resolves to the added place, or null
export async function addProposed(proposal) {
  const r = await send(() => addPlace(proposal));
  if (!r) return null;
  toast(r.already ? `${r.place.name} is already on the map` : `Added ${r.place.name} to the map`,
    { label: "Show", run: () => (location.hash = `#/map/${r.place.id}`) });
  return r.place;
}

export async function removeChatPlace(id, { undo = true } = {}) {
  const r = await send(() => removePlace(id, !undo));
  if (!r) return false;
  toast(undo ? `Took ${r.place.name} off the map` : `Put ${r.place.name} back`,
    undo ? { label: "Undo", run: () => removeChatPlace(id, { undo: false }) } : null);
  return true;
}
