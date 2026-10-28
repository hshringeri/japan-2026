import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyOps, seedItems, PlanError } from "../src/plan.js";
import { parseChatRequest, checkThread, checkBudget, needsSummary, LimitError, LIMITS } from "../src/limits.js";

const trip = JSON.parse(readFileSync(new URL("../../data/trip.json", import.meta.url)));
const places = JSON.parse(readFileSync(new URL("../../data/places.json", import.meta.url)));
const ctx = {
  people: trip.people,
  dates: trip.days.map((d) => d.date),
  placeIds: new Set(places.map((p) => p.id)),
  placeCoords: Object.fromEntries(places.filter((p) => p.lat != null).map((p) => [p.id, { lat: p.lat, lng: p.lng }])),
};
const base = () => seedItems(trip);
const ids = (items, date) => items[date].map((i) => i.id);
const undo = (items, r) => applyOps(r.items, r.inverse, ctx).items;

test("seed keeps trip.json's ids and covers every day", () => {
  const items = base();
  assert.equal(Object.keys(items).length, trip.days.length);
  assert.equal(items["2026-11-16"][0].id, "2026-11-16-1");
});

test("seed gives ids to items that have none", () => {
  const t = structuredClone(trip);
  delete t.days[0].items[0].id;
  const items = seedItems(t);
  const all = Object.values(items).flat().map((i) => i.id);
  assert.ok(items[t.days[0].date][0].id);
  assert.equal(new Set(all).size, all.length);
});

test("add places an item at an index and links a guide place's coordinates", () => {
  const p = places.find((x) => x.city === "tokyo" && x.lat != null);
  const r = applyOps(base(), [{ op: "add", date: "2026-11-16", index: 1, item: { title: p.name, kind: "food", place: p.id, time: "13:00" } }], ctx);
  const added = r.items["2026-11-16"][1];
  assert.equal(added.title, p.name);
  assert.equal(added.lat, p.lat);
  assert.equal(added.time, "13:00");
  assert.match(r.changes[0].text, /Added .* to Mon 16 Nov at 13:00/);
  assert.deepEqual(undo(base(), r), base());
});

test("move across days, with a new time, and undo puts it back", () => {
  const r = applyOps(base(), [{ op: "move", id: "2026-11-17-3", date: "2026-11-18", index: 0, time: "16:00" }], ctx);
  assert.equal(r.items["2026-11-18"][0].id, "2026-11-17-3");
  assert.equal(r.items["2026-11-18"][0].time, "16:00");
  assert.ok(!ids(r.items, "2026-11-17").includes("2026-11-17-3"));
  assert.deepEqual(undo(base(), r), base());
});

test("move within a day reorders", () => {
  const r = applyOps(base(), [{ op: "move", id: "2026-11-16-1", date: "2026-11-16", index: 99 }], ctx);
  assert.equal(ids(r.items, "2026-11-16").at(-1), "2026-11-16-1");
  assert.deepEqual(undo(base(), r), base());
});

test("remove, then undo restores the same item in the same place", () => {
  const r = applyOps(base(), [{ op: "remove", id: "2026-11-16-2" }], ctx);
  assert.ok(!ids(r.items, "2026-11-16").includes("2026-11-16-2"));
  assert.deepEqual(undo(base(), r), base());
});

test("update sets and clears fields, and undo reverses it", () => {
  const r = applyOps(base(), [{ op: "update", id: "2026-11-16-6", fields: { time: "20:30", status: null, notes: "Picked Gyukaku" } }], ctx);
  const it = r.items["2026-11-16"].find((i) => i.id === "2026-11-16-6");
  assert.equal(it.time, "20:30");
  assert.equal(it.status, undefined);
  assert.deepEqual(undo(base(), r), base());
});

test("a batch is all or nothing", () => {
  const items = base();
  assert.throws(() => applyOps(items, [{ op: "remove", id: "2026-11-16-1" }, { op: "remove", id: "nope" }], ctx), PlanError);
  assert.deepEqual(items, base());
});

test("bad input is refused with a reason", () => {
  const bad = [
    [{ op: "remove", id: "nope" }, /No plan item/],
    [{ op: "add", date: "2026-12-01", item: { title: "x" } }, /isn't a trip day/],
    [{ op: "add", date: "2026-11-16", item: { title: "" } }, /can't be empty/],
    [{ op: "add", date: "2026-11-16", item: { title: "x", kind: "party" } }, /Kind must be/],
    [{ op: "update", id: "2026-11-16-1", fields: { time: "7pm" } }, /must look like/],
    [{ op: "update", id: "2026-11-16-1", fields: { lat: 51.5, lng: -0.1 } }, /inside Japan/],
    [{ op: "update", id: "2026-11-16-1", fields: { lat: 35.6 } }, /go together/],
    [{ op: "update", id: "2026-11-16-1", fields: { url: "javascript:alert(1)" } }, /https/],
    [{ op: "update", id: "2026-11-16-1", fields: { who: ["Someone"] } }, /who must list/],
    [{ op: "update", id: "2026-11-16-1", fields: { place: "not-a-place" } }, /No guide place/],
    [{ op: "update", id: "2026-11-16-1", fields: { owner: "x" } }, /Unknown field/],
    [{ op: "explode" }, /Unknown change/],
  ];
  for (const [op, re] of bad) assert.throws(() => applyOps(base(), [op], ctx), re, JSON.stringify(op));
  assert.throws(() => applyOps(base(), [], ctx), /No changes/);
  assert.throws(() => applyOps(base(), Array(21).fill({ op: "remove", id: "x" }), ctx), /Too many/);
});

const req = (o) => JSON.stringify({ chatId: "abcdefgh-1234", text: "I'm hungry", ...o });
const limitCode = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof LimitError); return [e.status, e.code]; } return null; };

test("chat requests: size, length and shape", () => {
  assert.equal(parseChatRequest(req({})).text, "I'm hungry");
  assert.deepEqual(limitCode(() => parseChatRequest(req({ text: "a".repeat(LIMITS.messageChars + 1) }))), [413, "too_long"]);
  assert.equal(parseChatRequest(req({ text: "a".repeat(LIMITS.messageChars) })).text.length, LIMITS.messageChars);
  assert.deepEqual(limitCode(() => parseChatRequest(req({ pad: "x".repeat(LIMITS.bodyBytes) }))), [413, "too_large"]);
  assert.deepEqual(limitCode(() => parseChatRequest(req({ text: "   " }))), [400, "empty"]);
  assert.deepEqual(limitCode(() => parseChatRequest(req({ chatId: "../../etc" }))), [400, "bad_chat"]);
  assert.deepEqual(limitCode(() => parseChatRequest("{not json")), [400, "bad_json"]);
  const r = parseChatRequest(req({ date: "2026-11-20", here: { lat: 35.66, lng: 139.7, accuracy: 12.4 } }));
  assert.equal(r.date, "2026-11-20");
  assert.deepEqual(r.here, { lat: 35.66, lng: 139.7, accuracy: 12 });
  assert.equal(parseChatRequest(req({ date: "2027-01-01" })).date, null);
});

test("a long chat is summarized, never locked", () => {
  const meta = (turns, lastInputTokens, count = 8) => ({ turns, lastInputTokens, count });
  assert.equal(limitCode(() => checkThread(meta(500, 500000))), null);
  assert.deepEqual(limitCode(() => checkThread({ ...meta(1, 0), busyUntil: Date.now() + 1000 })), [409, "busy"]);
  assert.equal(needsSummary(meta(LIMITS.summarizeAfterTurns - 1, LIMITS.summarizeAtTokens - 1)), false);
  assert.equal(needsSummary(meta(LIMITS.summarizeAfterTurns, 0)), true);
  assert.equal(needsSummary(meta(1, LIMITS.summarizeAtTokens)), true);
  // A thread that was just restarted from a summary has nothing to fold yet
  assert.equal(needsSummary(meta(0, LIMITS.summarizeAtTokens, 0)), false);
});

test("daily caps", () => {
  assert.equal(limitCode(() => checkBudget({ messages: LIMITS.dayMessages - 1, tokens: 0 })), null);
  assert.deepEqual(limitCode(() => checkBudget({ messages: LIMITS.dayMessages, tokens: 0 })), [429, "budget"]);
  assert.deepEqual(limitCode(() => checkBudget({ messages: 0, tokens: LIMITS.dayTokens })), [429, "budget"]);
});
