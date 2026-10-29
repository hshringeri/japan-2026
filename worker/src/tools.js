import { distanceKm, nearestKm, walkMinutes } from "../../js/geo.js";
import { openState, hoursOn, toMinutes } from "../../js/hours.js";
import { dayAnchor } from "../../js/trip.js";
import { fold } from "../../js/fold.js";
import { formatDay } from "./format.js";
import { LIMITS } from "./limits.js";
import { CITY, CITY_IDS, checkCandidate, geocode, cityFor, findSame, buildPlace } from "./places.js";

const KIND_IDS = ["shop", "music", "drink", "eat", "play", "unwind", "cars"];
// Plan item kinds counted as each guide kind when nearby is filtered
const ITEM_KINDS = { eat: ["food"], drink: ["night"], music: ["night"], shop: ["shop"], play: ["activity", "golf"], unwind: ["sight"], cars: ["activity"] };
const TOKYO = CITY.tokyo;
const HHMM = /^([01]?\d|2[0-9]):[0-5]\d$/;

const WHERE = `Where: "me" (their phone's location), "place:<guide id>", "item:<plan item id>", "stay:<YYYY-MM-DD>" (that night's stay), "city:tokyo|osaka|kyoto", or "<lat>,<lng>".`;

export const TOOLS = [
  {
    name: "nearby",
    description: `Guide places and plan items near a point, ranked by distance with places already on the plan first among equals. Marks each as open or closed at the given time using the guide's hours. Use this for "I'm hungry", "a bar near us", "what's around the stay", and similar. With no "from", it ranks around the person if their phone says they're in Japan, otherwise around that day's stops.`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Trip day, YYYY-MM-DD. Defaults to the day the person is asking about." },
        from: { type: "string", description: WHERE },
        kinds: { type: "array", items: { type: "string", enum: KIND_IDS }, description: "Only these kinds. eat for food, drink for bars, music for live music and listening bars." },
        query: { type: "string", description: "Words to match in name, category, tags or description, e.g. ramen, vinyl, onsen." },
        at: { type: "string", description: "HH:MM Japan time to check opening at. Defaults to now on the current day." },
        limit: { type: "integer", description: "How many to return, up to 15. Default 8." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_day",
    description: "One trip day in full: title, city, that night's stay and every plan item with its id, time, kind, status, who and notes.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "travel_estimate",
    description: "Distance and rough travel time between two points. Walking is estimated from street distance, driving comes from a road router, and train time is a rough figure (there is no live transit data).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: WHERE },
        to: { type: "string", description: WHERE },
        mode: { type: "string", enum: ["walk", "transit", "drive"] },
      },
      required: ["from", "to", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "get_weather",
    description: "Weather forecast for a place on a date: conditions, high and low, chance of rain through the day, sunset. Only works up to about 16 days ahead.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        where: { type: "string", description: WHERE },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["where", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_plan",
    description: `Change the shared trip plan that all five phones see. Ops run in order and either all apply or none do. Each op is one of:
- {"op":"add","date":"YYYY-MM-DD","index":<position, optional, default end>,"item":{"title":..., "kind":..., "time":"HH:MM", "end":"HH:MM", "notes":..., "place":"<guide id>", "lat":..., "lng":..., "address":..., "status":"booked"|"tbd", "who":[names]}}
- {"op":"move","id":"<item id>","date":"YYYY-MM-DD","index":<position, optional>,"time":"HH:MM" or null (optional)}
- {"op":"update","id":"<item id>","fields":{<any item fields; null clears one>}}
- {"op":"remove","id":"<item id>"}
Kinds: flight, train, transfer, checkin, checkout, food, sight, shop, activity, golf, night, note. Index 0 is the top of the day. Returns what changed.`,
    input_schema: {
      type: "object",
      properties: {
        ops: { type: "array", items: { type: "object" }, description: "The changes, in order." },
      },
      required: ["ops"],
    },
  },
  {
    name: "add_place",
    description: "Put a place you proposed with propose_places on everyone's map, once they've told you which one in a message after the proposal. Never in the same message as the proposal.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { proposal: { type: "string", description: "The proposal id from propose_places" } },
      required: ["proposal"],
      additionalProperties: false,
    },
  },
  // The basic version: the dynamic-filtering ones are documented for Claude 4.6 and later models.
  // Any site, so small bars and shops with only a Tabelog or Instagram page can be found; a few
  // content farms and pin boards are left out.
  {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: LIMITS.webSearches,
    blocked_domains: ["pinterest.com", "quora.com", "medium.com"],
    user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" },
  },
];

// propose_places lists the guide's categories, so it's built from the taxonomy (once per isolate:
// the tools sit in front of the cached system prompt and must not change between calls)
let built = null;
export function tools(taxonomy) {
  const key = JSON.stringify(taxonomy.kinds);
  if (built?.key === key) return built.tools;
  const cats = taxonomy.kinds.map((k) => `${k.id}: ${k.categories.join(", ")}`).join("\n");
  const propose = {
    name: "propose_places",
    description: `Show up to ${LIMITS.candidates} places you found with web_search as cards on their phone, each with an Add button. Nothing is added to the map until someone taps Add or confirms in their next message (then use add_place). The pin is found from the address, and a candidate is skipped if its address can't be found, lands in a different city, or is already on the map.

The guide's categories, by kind:
${cats}`,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          description: `1 to ${LIMITS.candidates} places`,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name as the venue writes it in English or romaji" },
              address: { type: "string", description: "Street address in English, as written on the page" },
              address_ja: { type: "string", description: "The address in Japanese with prefecture, ward and block numbers, e.g. 東京都杉並区高円寺南3-55-2" },
              city: { type: "string", enum: CITY_IDS, description: "elsewhere for anywhere outside Tokyo, Osaka and Kyoto" },
              area: { type: "string", description: "The neighbourhood, e.g. Koenji. The guide's area name is used instead when the pin is near guide places." },
              kind: { type: "string", enum: taxonomy.kinds.map((k) => k.id) },
              category: { type: "string", description: "One of the guide's categories for that kind, or a short one of your own when none fits" },
              emoji: { type: "string", description: "One emoji, only for a category of your own" },
              desc: { type: "string", description: "One sentence on why it's worth going, from what you read" },
              info: { type: "string", description: "Opening hours as the page writes them" },
              url: { type: "string", description: "Its own site, Instagram or Tabelog page" },
            },
            required: ["name", "address", "address_ja", "city", "kind", "category", "desc"],
            additionalProperties: false,
          },
        },
      },
      required: ["candidates"],
      additionalProperties: false,
    },
  };
  const all = [...TOOLS];
  all.splice(all.findIndex((t) => t.name === "add_place"), 0, propose);
  built = { key, tools: all };
  return all;
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const inJapan = (pt) => pt && distanceKm(pt, TOKYO) < 1600;
const brief = (s, n = 160) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);

// ctx: { data, trip (live, prepared), here, date, now, stub, events }
function resolve(where, ctx) {
  const w = String(where ?? "").trim();
  if (w === "me") {
    if (!ctx.here) throw new Error("Their location is off, so 'me' isn't available. Ask them to turn on location in the app, or use the day's stay.");
    if (!inJapan(ctx.here)) throw new Error("Their phone isn't in Japan yet, so 'me' isn't useful. Use the day's stops or stay.");
    return { lat: ctx.here.lat, lng: ctx.here.lng, label: "their location" };
  }
  let m;
  if ((m = w.match(/^place:(.+)$/))) {
    const p = ctx.data.byId[m[1]];
    if (!p) throw new Error(`No guide place ${m[1]}`);
    if (p.lat == null) throw new Error(`${p.name} has no pin`);
    return { lat: p.lat, lng: p.lng, label: p.name, ref: `place:${p.id}` };
  }
  if ((m = w.match(/^item:(.+)$/))) {
    const it = ctx.trip.days.flatMap((d) => d.items).find((i) => i.id === m[1]);
    if (!it) throw new Error(`No plan item ${m[1]}`);
    if (it.lat == null) throw new Error(`"${it.title}" has no location on the plan`);
    return { lat: it.lat, lng: it.lng, label: it.title, ref: `item:${it.id}` };
  }
  if ((m = w.match(/^stay:(\d{4}-\d\d-\d\d)$/))) {
    const s = ctx.trip.dayByDate[m[1]]?.stayObj;
    if (!s) throw new Error(`No stay on ${m[1]}`);
    if (s.lat == null) throw new Error(`${s.name} has no address yet`);
    return { lat: s.lat, lng: s.lng, label: s.name };
  }
  if ((m = w.match(/^city:(tokyo|osaka|kyoto)$/))) return { ...CITY[m[1]], label: m[1] };
  if ((m = w.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/))) return { lat: +m[1], lng: +m[2], label: "that point" };
  throw new Error(`Can't place "${w}". ${WHERE}`);
}

function planIndex(trip) {
  const byPlace = {};
  for (const d of trip.days) for (const i of d.items) if (i.place) (byPlace[i.place] ||= []).push({ date: d.date, id: i.id, time: i.time });
  return byPlace;
}

function nearby(input, ctx) {
  const date = input.date || ctx.date;
  const day = ctx.trip.dayByDate[date];
  if (!day) throw new Error(`${date} isn't a trip day`);
  const limit = Math.min(Math.max(Number.isInteger(input.limit) ? input.limit : 8, 1), 15);
  if (input.at && !HHMM.test(input.at)) throw new Error("at must look like 19:30");

  // Where to rank from
  let anchor, origin;
  if (input.from) {
    const pt = resolve(input.from, ctx);
    anchor = pt;
    origin = pt.label;
  } else if (inJapan(ctx.here) && date === ctx.now.date) {
    anchor = ctx.here;
    origin = "their location";
  } else {
    anchor = dayAnchor(ctx.trip, date);
    origin = anchor ? `that day's stops (${formatDay(date)})` : null;
  }
  if (!anchor) throw new Error("No location to rank from: that day has no stops with a location. Give 'from'.");

  // When to check opening
  const when = input.at ? { date, minutes: toMinutes(input.at) } : date === ctx.now.date ? ctx.now : null;
  const kinds = input.kinds?.length ? input.kinds : null;
  const q = input.query ? fold(input.query) : null;
  const onPlan = planIndex(ctx.trip);

  const results = [];
  for (const p of ctx.data.places) {
    if (p.lat == null) continue;
    if (kinds && !p.kinds.some((k) => kinds.includes(k))) continue;
    if (q && !fold([p.name, p.area, ...p.categories, ...Object.values(p.tags || {}).flat(), p.main.desc].join(" ")).includes(q)) continue;
    const km = nearestKm(anchor, p);
    if (km > 30) continue;
    const open = when ? openState(p, when) : null;
    const planned = onPlan[p.id] || [];
    results.push({
      ref: `place:${p.id}`, name: p.name, area: p.area, category: p.categories.join(", "),
      km: round(km, 2), walk_min: walkMinutes(km),
      open: open?.label || (p.hours ? `${formatDay(date).slice(0, 3)}: ${hoursOn(p, date) || "hours vary"}` : "hours unknown"),
      closed: open ? ["shut", "gone"].includes(open.cls) : p.hours?.kind === "closed",
      on_plan: planned.length ? planned.map((x) => `${formatDay(x.date)}${x.time ? ` ${x.time}` : ""}`).join(", ") : null,
      about: brief(p.main.desc),
      ...(p.source === "chat" ? { added_by_chat: true } : {}),
      score: km - (planned.length ? 0.4 : 0) + (open && ["shut", "gone"].includes(open.cls) ? 3 : 0),
    });
  }
  // That day's plan items that aren't guide places
  for (const i of day.items) {
    if (i.lat == null || i.place) continue;
    if (kinds && !kinds.some((k) => ITEM_KINDS[k]?.includes(i.kind))) continue;
    if (q && !fold(`${i.title} ${i.notes || ""}`).includes(q)) continue;
    const km = nearestKm(anchor, i);
    results.push({
      ref: `item:${i.id}`, name: i.title, area: day.cityLabel || day.city, category: i.kind, km: round(km, 2), walk_min: walkMinutes(km),
      open: "not in the guide's hours", closed: false, on_plan: `${formatDay(date)}${i.time ? ` ${i.time}` : ""}`,
      about: brief(i.notes), score: km - 0.4,
    });
  }
  results.sort((a, b) => a.score - b.score);
  return {
    ranked_from: origin,
    open_checked_at: when ? `${formatDay(when.date)} ${String(Math.floor(when.minutes / 60)).padStart(2, "0")}:${String(when.minutes % 60).padStart(2, "0")}` : "not checked (another day; showing that day's hours)",
    results: results.slice(0, limit).map(({ score, ...r }) => r),
  };
}

function getDay({ date }, ctx) {
  const d = ctx.trip.dayByDate[date];
  if (!d) throw new Error(`${date} isn't a trip day (15 to 29 Nov 2026)`);
  return {
    date, day: formatDay(date), title: d.title, city: d.cityLabel || d.city,
    stay: d.stayObj ? { name: d.stayObj.name, address: d.stayObj.address || null } : null,
    route: d.route?.title || null,
    items: d.items.map((i) => ({
      id: i.id, time: i.time || null, end: i.end || null, kind: i.kind, title: i.title, status: i.status || null,
      who: i.who || null, notes: i.notes || null, place: i.place || null, has_location: i.lat != null,
    })),
  };
}

async function travelEstimate({ from, to, mode }, ctx) {
  const a = resolve(from, ctx), b = resolve(to, ctx);
  const km = distanceKm(a, b);
  const out = { from: a.label, to: b.label, to_ref: b.ref || null, straight_km: round(km, 2) };
  if (mode === "walk") return { ...out, walk_min: walkMinutes(km), note: km > 3 ? "That's a long walk; a train or taxi is probably better." : null };
  if (mode === "transit") {
    if (km < 1.2) return { ...out, walk_min: walkMinutes(km), note: "Close enough to walk." };
    // Rough door to door: walking to and from stations, waiting, ~30 km/h on the train
    return { ...out, transit_min_rough: Math.round(12 + km * 2), note: "Rough guess only; the directions card has the real route and fare." };
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const res = await fetch(url, { headers: { "User-Agent": "japan-2026 trip app (worker)" }, signal: AbortSignal.timeout(5000) });
    const r = await res.json();
    if (r.code !== "Ok") throw new Error(r.code);
    return { ...out, drive_km: round(r.routes[0].distance / 1000), drive_min: Math.round(r.routes[0].duration / 60), note: "Before traffic and tolls." };
  } catch {
    return { ...out, drive_min_rough: Math.round(km * 1.4 / 35 * 60), note: "Road router didn't answer; rough guess from distance." };
  }
}

const WMO = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers",
  95: "thunderstorms", 96: "thunderstorms with hail", 99: "thunderstorms with hail",
};

async function getWeather({ where, date }, ctx) {
  const pt = resolve(where, ctx);
  const ahead = Math.round((new Date(date + "T00:00:00Z") - new Date(ctx.now.date + "T00:00:00Z")) / 864e5);
  if (!(ahead >= 0)) throw new Error("date must be today or later, as YYYY-MM-DD");
  if (ahead > 15) return { place: pt.label, date, forecast: null, note: `That's ${ahead} days away; forecasts only reach about 16 days. Use typical late November weather.` };
  const params = new URLSearchParams({
    latitude: pt.lat, longitude: pt.lng, timezone: "Asia/Tokyo", start_date: date, end_date: date,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunset",
    hourly: "precipitation_probability,temperature_2m",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Weather service said ${res.status}`);
  const w = await res.json();
  const d = w.daily;
  const hours = [9, 12, 15, 18, 21].map((h) => `${h}:00 ${Math.round(w.hourly.temperature_2m[h])}°C, ${w.hourly.precipitation_probability[h]}% rain`);
  return {
    place: pt.label, date: formatDay(date),
    conditions: WMO[d.weather_code[0]] || `code ${d.weather_code[0]}`,
    high_c: Math.round(d.temperature_2m_max[0]), low_c: Math.round(d.temperature_2m_min[0]),
    rain_chance: `${d.precipitation_probability_max[0]}%`, rain_mm: d.precipitation_sum[0],
    wind_max_kmh: Math.round(d.wind_speed_10m_max[0]), sunset: d.sunset[0].slice(11),
    through_the_day: hours,
  };
}

async function editPlan({ ops }, ctx) {
  const r = await ctx.stub.edit(ops, "assistant");
  if (r.error) throw new Error(r.error);
  ctx.events.push({ type: "plan", version: r.plan.version, changes: r.changes, inverse: r.inverse });
  ctx.applyPlan(r.plan.items);
  return { ok: true, plan_version: r.plan.version, changes: r.changes.map((c) => c.text) };
}

// Checks and pins each candidate, keeps the good ones as proposals and sends them to the phone as cards
async function proposePlaces({ candidates }, ctx) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("Give at least one candidate");
  if (candidates.length > LIMITS.candidates) throw new Error(`${LIMITS.candidates} candidates at most`);
  const report = [], found = [];
  for (const raw of candidates) {
    const name = typeof raw?.name === "string" ? raw.name : null;
    let c;
    try { c = checkCandidate(raw, ctx.data.taxonomy); } catch (e) { report.push({ name, skipped: e.message }); continue; }
    const pt = await geocode(c);
    if (!pt) { report.push({ name, skipped: "Couldn't find that address on a map. Check address_ja against the venue's own page." }); continue; }
    const city = cityFor(pt);
    if (city !== c.city) {
      report.push({ name, skipped: `The address maps to ${city === "elsewhere" ? "somewhere outside Tokyo, Osaka and Kyoto" : CITY_LABEL[city]}, not ${CITY_LABEL[c.city] || c.city}. Check the address.` });
      continue;
    }
    const same = findSame(c.name, pt, ctx.data.places);
    if (same) { report.push({ name, already_on_map: `place:${same.id}` }); continue; }
    found.push(buildPlace(c, pt, ctx.data.places));
  }
  const ids = found.length ? await ctx.stub.propose(found.map((place) => ({ place })), ctx.chatId) : [];
  if (found.length) ctx.events.push({ type: "candidates", items: found.map((place, i) => ({ proposal: ids[i], place })) });
  return {
    shown_as_cards: found.map((p, i) => ({
      proposal: ids[i], name: p.name, area: p.area, category: p.categories[0],
      pin: p.precision === "area" ? "neighbourhood only (approximate)" : "on the block",
    })),
    not_shown: report,
    next: found.length ? "Ask which one to add, or whether this is the one. Call add_place only after they answer, in a later message." : "Nothing to show. Tell them, or try again with a corrected address.",
  };
}

const CITY_LABEL = { tokyo: "Tokyo", osaka: "Osaka", kyoto: "Kyoto" };

async function addPlace({ proposal }, ctx) {
  const r = await ctx.stub.addProposal(String(proposal || ""), { chatId: ctx.chatId, before: ctx.turnStart });
  if (r.error) throw new Error(r.same ? `${r.error} Refer to it as [[place:${r.same.id}]].` : r.error);
  ctx.addPlace(r.place);
  ctx.events.push({ type: "places", proposal, id: r.place.id, name: r.place.name, version: r.version });
  return { ok: true, ref: `place:${r.place.id}`, note: r.already ? "It was already added (someone tapped Add)." : "Added to everyone's map." };
}

const HANDLERS = { nearby, get_day: getDay, travel_estimate: travelEstimate, get_weather: getWeather, edit_plan: editPlan, propose_places: proposePlaces, add_place: addPlace };

// Runs one tool call. Returns the tool_result block; failures go back to the model as is_error.
export async function runTool(block, ctx) {
  const fn = HANDLERS[block.name];
  try {
    if (!fn) throw new Error(`Unknown tool ${block.name}`);
    if (!block.input || typeof block.input !== "object") throw new Error("Tool input must be an object");
    const result = await fn(block.input, ctx);
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
  } catch (e) {
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: e.message || String(e) };
  }
}

