// The editable part of the plan: each day's items, keyed by date. Everything else about a day
// (title, city, stay, route) still comes from data/trip.json. Pure functions, so tests run in Node.

import { formatDay as dayLabel } from "./format.js";

export const KINDS = ["flight", "train", "transfer", "checkin", "checkout", "food", "sight", "shop", "activity", "golf", "night", "note"];
const FIELDS = ["kind", "title", "time", "end", "status", "who", "notes", "url", "lat", "lng", "address", "place"];
// Times past midnight run on, as in hours.json ("25:00" is 1 a.m.)
const TIME = /^([01]?\d|2[0-9]):[0-5]\d$/;

export class PlanError extends Error {}


// The base plan from trip.json, with ids for any item that lacks one (tools/item_ids.py's scheme)
export function seedItems(trip) {
  const taken = new Set(trip.days.flatMap((d) => d.items.map((i) => i.id).filter(Boolean)));
  const items = {};
  for (const d of trip.days) {
    let n = 1;
    items[d.date] = d.items.map((it) => {
      if (it.id) return { ...it };
      while (taken.has(`${d.date}-${n}`)) n++;
      taken.add(`${d.date}-${n}`);
      return { id: `${d.date}-${n}`, ...it };
    });
  }
  return items;
}

function find(items, id) {
  for (const [date, list] of Object.entries(items)) {
    const index = list.findIndex((i) => i.id === id);
    if (index >= 0) return { date, index, item: list[index] };
  }
  throw new PlanError(`No plan item with id "${id}"`);
}

function newId(items, date) {
  const taken = new Set(Object.values(items).flat().map((i) => i.id));
  let n = items[date].length + 1;
  while (taken.has(`${date}-${n}`)) n++;
  return `${date}-${n}`;
}

const str = (v, max, name) => {
  if (typeof v !== "string") throw new PlanError(`${name} must be text`);
  const s = v.trim();
  if (!s) throw new PlanError(`${name} can't be empty`);
  if (s.length > max) throw new PlanError(`${name} is longer than ${max} characters`);
  return s;
};

// Checks one field and returns its clean value. null clears an optional field.
function clean(field, v, ctx) {
  if (v === null && field !== "title" && field !== "kind") return null;
  switch (field) {
    case "title": return str(v, 120, "Title");
    case "kind":
      if (!KINDS.includes(v)) throw new PlanError(`Kind must be one of ${KINDS.join(", ")}`);
      return v;
    case "time": case "end":
      if (typeof v !== "string" || !TIME.test(v)) throw new PlanError(`${field} must look like 14:30`);
      return v.padStart(5, "0");
    case "status":
      if (v !== "booked" && v !== "tbd") throw new PlanError(`status must be "booked" or "tbd"`);
      return v;
    case "who":
      if (!Array.isArray(v) || v.some((p) => !ctx.people.includes(p))) throw new PlanError(`who must list people from: ${ctx.people.join(", ")}`);
      return v.length ? [...new Set(v)] : null;
    case "notes": return str(v, 500, "Notes");
    case "address": return str(v, 200, "Address");
    case "url": {
      const s = str(v, 500, "Link");
      let u;
      try { u = new URL(s); } catch { throw new PlanError("Link isn't a valid URL"); }
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new PlanError("Link must start with https://");
      return s;
    }
    case "lat": case "lng": {
      const [lo, hi] = field === "lat" ? [24, 46] : [122, 154];
      if (typeof v !== "number" || !(v >= lo && v <= hi)) throw new PlanError(`${field} must be inside Japan`);
      return Math.round(v * 1e6) / 1e6;
    }
    case "place":
      if (typeof v !== "string" || (ctx.placeIds && !ctx.placeIds.has(v))) throw new PlanError(`No guide place with id "${v}"`);
      return v;
    default: throw new PlanError(`Unknown field ${field}`);
  }
}

function cleanFields(fields, ctx) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new PlanError("Fields must be an object");
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!FIELDS.includes(k)) throw new PlanError(`Unknown field ${k}`);
    out[k] = clean(k, v, ctx);
  }
  if (("lat" in out || "lng" in out) && (out.lat == null) !== (out.lng == null)) throw new PlanError("lat and lng go together");
  return out;
}

function setFields(item, fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) delete item[k];
    else item[k] = v;
  }
  return item;
}

const clampIndex = (i, len) => (Number.isInteger(i) ? Math.max(0, Math.min(i, len)) : len);

// Applies ops in order to a copy of items. Returns the new items, a sentence per change, and the
// ops that undo the whole batch (newest first). Throws PlanError and changes nothing if any op fails.
// ctx: { people, dates, placeIds?, placeName? }
export function applyOps(items, ops, ctx) {
  if (!Array.isArray(ops) || !ops.length) throw new PlanError("No changes given");
  if (ops.length > 20) throw new PlanError("Too many changes at once (20 at most)");
  const next = structuredClone(items);
  const changes = [], inverse = [];
  const name = (it) => it.title;

  for (const op of ops) {
    switch (op?.op) {
      case "add": {
        if (!ctx.dates.includes(op.date)) throw new PlanError(`${op.date} isn't a trip day`);
        const f = cleanFields(op.item, ctx);
        if (!f.title) throw new PlanError("A new item needs a title");
        if (!f.kind) f.kind = "activity";
        if (f.place && f.lat == null && ctx.placeCoords?.[f.place]) Object.assign(f, ctx.placeCoords[f.place]);
        const item = setFields({ id: newId(next, op.date) }, f);
        const list = next[op.date];
        const index = clampIndex(op.index, list.length);
        list.splice(index, 0, item);
        changes.push({ id: item.id, text: `Added ${name(item)} to ${dayLabel(op.date)}${item.time ? ` at ${item.time}` : ""}` });
        inverse.unshift({ op: "remove", id: item.id });
        break;
      }
      case "remove": {
        const { date, index, item } = find(next, op.id);
        next[date].splice(index, 1);
        changes.push({ id: item.id, text: `Removed ${name(item)} from ${dayLabel(date)}` });
        inverse.unshift({ op: "restore", date, index, item: structuredClone(item) });
        break;
      }
      // Only produced by undo: puts a removed item back exactly as it was, id included
      case "restore": {
        if (!ctx.dates.includes(op.date)) throw new PlanError(`${op.date} isn't a trip day`);
        if (Object.values(next).flat().some((i) => i.id === op.item?.id)) throw new PlanError("That item is already back");
        const item = { id: str(op.item.id, 40, "id"), ...cleanFields(Object.fromEntries(Object.entries(op.item).filter(([k]) => k !== "id")), ctx) };
        next[op.date].splice(clampIndex(op.index, next[op.date].length), 0, item);
        changes.push({ id: item.id, text: `Put ${name(item)} back on ${dayLabel(op.date)}` });
        inverse.unshift({ op: "remove", id: item.id });
        break;
      }
      case "move": {
        const to = op.date;
        if (!ctx.dates.includes(to)) throw new PlanError(`${to} isn't a trip day`);
        const from = find(next, op.id);
        next[from.date].splice(from.index, 1);
        const index = clampIndex(op.index, next[to].length);
        next[to].splice(index, 0, from.item);
        let text = from.date === to ? `Moved ${name(from.item)} within ${dayLabel(to)}` : `Moved ${name(from.item)} from ${dayLabel(from.date)} to ${dayLabel(to)}`;
        const undo = [{ op: "move", id: op.id, date: from.date, index: from.index }];
        if (op.time !== undefined) {
          const before = from.item.time ?? null;
          setFields(from.item, cleanFields({ time: op.time }, ctx));
          if (op.time) text += ` at ${from.item.time}`;
          undo.push({ op: "update", id: op.id, fields: { time: before } });
        }
        changes.push({ id: op.id, text });
        inverse.unshift(...undo);
        break;
      }
      case "update": {
        const { item } = find(next, op.id);
        const f = cleanFields(op.fields, ctx);
        if (!Object.keys(f).length) throw new PlanError("Nothing to update");
        const before = Object.fromEntries(Object.keys(f).map((k) => [k, item[k] ?? null]));
        setFields(item, f);
        const what = Object.keys(f).map((k) => (k === "lat" || k === "lng" ? "location" : k)).filter((k, i, a) => a.indexOf(k) === i);
        changes.push({ id: item.id, text: `Changed ${name(item)}: ${what.join(", ")}${f.time ? ` (now ${f.time})` : ""}` });
        inverse.unshift({ op: "update", id: item.id, fields: before });
        break;
      }
      default:
        throw new PlanError(`Unknown change "${op?.op}"`);
    }
  }
  return { items: next, changes, inverse };
}
