import { distanceKm, storage } from "./util.js";
import { setFilter } from "./filter.js";
import { dayAnchor, dayAreas, preparePlace } from "./data.js";
import { prepareTrip } from "./trip.js";
import { API } from "./config.js";
import { fetchPlan, fetchPlaces, apiReady } from "./api.js";

// App-wide state outside the filter: loaded data, the look-ahead date and your location
export const app = { data: null, date: null, here: null, locating: false, locationError: null, planVersion: null, placesVersion: null };

const listeners = {};
export const onApp = (event, fn) => (listeners[event] ||= new Set()).add(fn);
export const emit = (event, payload) => listeners[event]?.forEach((fn) => fn(payload));

export function setDate(date) {
  app.date = date;
  const day = date && app.data.trip?.dayByDate[date];
  // Looking ahead to a day jumps the list and map to that day's city and the areas its stops are in
  if (day) {
    const city = ["tokyo", "osaka", "kyoto"].includes(day.city) ? day.city : null;
    setFilter({ city, area: city ? dayAreas(app.data, date) : [] });
  }
  emit("date", date);
}

const TOKYO = { lat: 35.68, lng: 139.76 };
// GPS only counts as a sort anchor once you're actually in Japan
export const hereInJapan = () => app.here && distanceKm(app.here, TOKYO) < 1600;

// The point lists sort around: the chosen day's stay, else you
export function anchor() {
  if (app.date) {
    const a = dayAnchor(app.data.trip, app.date);
    if (a) return { ...a, kind: "day" };
  }
  if (hereInJapan()) return { ...app.here, kind: "here", label: "you" };
  return null;
}

let watchId = null;
export function startLocation() {
  if (watchId != null || !("geolocation" in navigator)) return;
  app.locating = true;
  emit("here", app.here);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      app.locating = false;
      app.locationError = null;
      app.here = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
      storage.set("locationAllowed", true);
      emit("here", app.here);
    },
    (err) => {
      app.locating = false;
      app.locationError = err.code === 1 ? "Location is off for this site" : "Can't find your location right now";
      if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      emit("here", app.here);
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
}
// Resume tracking without a prompt when permission was granted before
export const locationWasAllowed = () => storage.get("locationAllowed", false);

// Where the list was when you left it, so the place view's close button can put you back there
export const listReturn = { hash: null, top: 0 };

// The shared plan lives in the Worker; trip.json is only the starting point. Its items replace
// trip.json's day by day, and the last copy is kept so the plan still shows offline.
const PLAN_KEY = `plan:${API}`;
export function applyPlan(live, { force = false } = {}) {
  const trip = app.data?.trip;
  if (!trip || !live?.items) return;
  if (!force && app.planVersion != null && live.version <= app.planVersion) return;
  for (const d of trip.days) if (live.items[d.date]) d.items = structuredClone(live.items[d.date]);
  prepareTrip(trip, app.data.byId, app.data.routes);
  app.planVersion = live.version;
  storage.set(PLAN_KEY, { version: live.version, items: live.items });
  emit("plan");
}

export const applySavedPlan = () => applyPlan(storage.get(PLAN_KEY, null));

export async function refreshPlan() {
  if (!apiReady()) return;
  try { applyPlan(await fetchPlan()); } catch { /* offline or the server is down: keep what we have */ }
}

// Places the chat added live in the Worker too. They join the guide's places (after them, so the
// guide keeps its order) and the last copy is kept for offline, like the plan.
const PLACES_KEY = `places:${API}`;
export function applyPlaces(live, { force = false } = {}) {
  const data = app.data;
  if (!data || !Array.isArray(live?.items)) return;
  if (!force && app.placesVersion != null && live.version <= app.placesVersion) return;
  const guide = data.places.filter((p) => p.source !== "chat");
  const added = live.items.map((p, i) => preparePlace(data, structuredClone(p), guide.length + i));
  data.places = [...guide, ...added];
  data.byId = Object.fromEntries(data.places.map((p) => [p.id, p]));
  if (data.trip) prepareTrip(data.trip, data.byId, data.routes);
  app.placesVersion = live.version;
  storage.set(PLACES_KEY, { version: live.version, items: live.items });
  emit("places");
}

export const applySavedPlaces = () => applyPlaces(storage.get(PLACES_KEY, null));

export async function refreshPlaces() {
  if (!apiReady()) return;
  try { applyPlaces(await fetchPlaces()); } catch { /* offline: keep what we have */ }
}
