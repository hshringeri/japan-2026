import { $, $$ } from "./util.js";
import { loadData } from "./data.js";
import { app, emit, startLocation, locationWasAllowed, setDate } from "./state.js";
import { mountList } from "./list.js";
import { mountMap, showMap, focusPlace, revealPlace } from "./map.js";
import { mountSplit, syncSplit } from "./split.js";
import { mountPlan, showPlan, hidePlan } from "./plan.js";
import { renderPlace } from "./place.js";
import { renderGuide } from "./guide.js";

const wide = matchMedia("(min-width: 960px)");

// Routes: #/list, #/map, #/map/<place>, #/plan, #/place/<id>, #/guide, #/guide/<anchor>
function route() {
  const [, view = "map", arg] = location.hash.match(/^#\/([^/]+)\/?(.*)$/) || [];
  let name = ["list", "map", "plan", "place", "guide"].includes(view) ? view : "map";
  // Wide screens have no map tab: the map is always beside the list
  if (wide.matches && name === "map" && !arg) name = "list";
  document.body.dataset.view = name;
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$(".tabbar a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === (name === "place" ? lastTab : name) ? "page" : "false"));
  if (name !== "plan") hidePlan();

  // On wide screens the map stays beside every panel
  if (wide.matches && name !== "guide") $("#view-map").hidden = false;
  if (name === "map" || (wide.matches && name !== "guide")) showMap();
  syncSplit(name);
  if (view === "map" && arg && app.data.byId[arg]) {
    if (wide.matches) { $("#view-place").hidden = false; renderPlace($("#view-place"), arg); }
    focusPlace(app.data.byId[arg]);
  }
  if (name === "plan") showPlan();
  if (name === "place") {
    renderPlace($("#view-place"), arg);
    if (wide.matches && app.data.byId[arg]?.lat != null) revealPlace(app.data.byId[arg]);
  }
  if (name !== "place" && view !== "map") revealPlace(null);
  if (name === "guide") renderGuide($("#view-guide"), arg);
  if (["list", "map", "plan"].includes(name)) lastTab = name;
  emit("route", name);
}
let lastTab = "map";

async function start() {
  try {
    app.data = await loadData();
  } catch (err) {
    $("#boot").innerHTML = `<p>Couldn't load the guide (${err.message}). Check your connection and reload.</p>`;
    return;
  }
  $("#boot").remove();
  mountList($("#view-list"));
  mountMap($("#view-map"));
  mountPlan($("#view-plan"));
  mountSplit();
  emit("data");
  // ?day=2026-11-24 opens straight onto that trip day
  const day = new URLSearchParams(location.search).get("day");
  if (day && app.data.trip?.dayByDate[day]) setDate(day);
  if (locationWasAllowed()) startLocation();
  if (!location.hash) history.replaceState(null, "", wide.matches ? "#/list" : "#/map");
  addEventListener("hashchange", route);
  wide.addEventListener("change", route);
  route();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
