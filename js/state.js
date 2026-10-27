import { distanceKm, storage } from "./util.js";
import { setFilter } from "./filter.js";
import { dayAnchor, dayAreas } from "./data.js";

// App-wide state outside the filter: loaded data, the look-ahead date and your location
export const app = { data: null, date: null, here: null, locating: false, locationError: null };

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
