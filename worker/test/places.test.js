import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCandidate, cityFor, areaFor, findSame, geocode, buildPlace, newPlaceId, PlaceError } from "../src/places.js";
import { tools } from "../src/tools.js";

const taxonomy = JSON.parse(readFileSync(new URL("../../data/taxonomy.json", import.meta.url)));
const places = JSON.parse(readFileSync(new URL("../../data/places.json", import.meta.url)));
const cityName = Object.fromEntries(taxonomy.cities.map((c) => [c.id, c.name]));
for (const p of places) p.area = p.area || p.hood || cityName[p.city];

const curb = places.find((p) => p.id === "tokyo-curb-koenji");
const good = {
  name: "Bar Example", address: "3-55-2 Koenji-minami, Suginami", address_ja: "東京都杉並区高円寺南3-55-2",
  city: "tokyo", area: "Koenji", kind: "drink", category: "Cool Bars", desc: "A tiny bar.", url: "https://example.com/",
};

// A stand-in for fetch that answers by host
const fakeFetch = (answers) => async (url) => {
  const host = new URL(url).hostname;
  const body = answers[host];
  if (body === undefined) throw new Error("offline");
  return { ok: true, json: async () => (typeof body === "function" ? body(url) : body) };
};

test("a guide category sets the kind and drops any emoji", () => {
  const c = checkCandidate({ ...good, kind: "eat", emoji: "🍺" }, taxonomy);
  assert.equal(c.kind, "drink");
  assert.equal(c.category, "Cool Bars");
  assert.equal(c.emoji, undefined);
  assert.equal(c.addressJa, good.address_ja);
});

test("a new category keeps its kind and one emoji", () => {
  const c = checkCandidate({ ...good, kind: "unwind", category: "Museum", emoji: "🖼️" }, taxonomy);
  assert.equal(c.kind, "unwind");
  assert.equal(c.category, "Museum");
  assert.equal(c.emoji, "🖼️");
  // Not an emoji: the kind's mark is used instead
  assert.equal(checkCandidate({ ...good, kind: "unwind", category: "Museum", emoji: "art" }, taxonomy).emoji, undefined);
});

test("bad candidates are refused with a reason", () => {
  for (const bad of [
    { ...good, name: "" }, { ...good, address: undefined }, { ...good, city: "nagoya" }, { ...good, url: "javascript:alert(1)" },
    { ...good, category: "Museum", kind: "sightseeing" }, { ...good, desc: "x".repeat(301) }, null,
  ]) assert.throws(() => checkCandidate(bad, taxonomy), PlaceError, JSON.stringify(bad));
});

test("cities by distance, with elsewhere past 50 km", () => {
  assert.equal(cityFor(curb), "tokyo");
  assert.equal(cityFor({ lat: 34.70, lng: 135.50 }), "osaka");
  assert.equal(cityFor({ lat: 35.0, lng: 135.77 }), "kyoto");
  assert.equal(cityFor({ lat: 35.36, lng: 138.73 }), "elsewhere"); // Fuji
});

test("area comes from the guide places nearby, or nothing", () => {
  assert.equal(areaFor(curb, "tokyo", places), curb.area);
  assert.equal(areaFor({ lat: 35.36, lng: 138.73 }, "elsewhere", places), null);
});

test("the same name close by is a duplicate; far away or a different name isn't", () => {
  assert.equal(findSame("curb Koenji", curb, places)?.id, curb.id);
  assert.equal(findSame("CURB koenji", curb, places)?.id, curb.id);
  assert.equal(findSame("Some Other Bar", curb, places), null);
  assert.equal(findSame("curb Koenji", { lat: 34.7, lng: 135.5 }, places), null);
});

test("GSI answers first, and a block number means block precision", async () => {
  const pt = await geocode(checkCandidate(good, taxonomy), fakeFetch({
    "msearch.gsi.go.jp": [{ geometry: { coordinates: [139.647522, 35.703972] }, properties: { title: "東京都杉並区高円寺南三丁目５５番２号" } }],
  }));
  assert.deepEqual(pt, { lat: 35.70397, lng: 139.64752, precision: "block", via: "gsi" });
});

test("OpenStreetMap is the fallback, and nothing found is null", async () => {
  const pt = await geocode(checkCandidate(good, taxonomy), fakeFetch({
    "msearch.gsi.go.jp": [],
    "nominatim.openstreetmap.org": [{ lat: "35.7", lon: "139.65", place_rank: 20 }],
  }));
  assert.equal(pt.via, "osm");
  assert.equal(pt.precision, "area");
  assert.equal(await geocode(checkCandidate(good, taxonomy), fakeFetch({ "msearch.gsi.go.jp": [], "nominatim.openstreetmap.org": [] })), null);
  assert.equal(await geocode(checkCandidate(good, taxonomy), fakeFetch({})), null);
});

test("a built place has the guide's shape, the guide's area and source chat", () => {
  const c = checkCandidate(good, taxonomy);
  const p = buildPlace(c, { lat: 35.70397, lng: 139.64752, precision: "block" }, places);
  assert.equal(p.city, "tokyo");
  assert.equal(p.area, curb.area);
  assert.equal(p.source, "chat");
  assert.deepEqual(p.kinds, ["drink"]);
  assert.deepEqual(p.categories, ["Cool Bars"]);
  assert.equal(p.listings[0].desc, "A tiny bar.");
  assert.match(p.listings[0].mapUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Bar%20Example/);
  assert.equal(p.addressJa, good.address_ja);
});

test("ids are slugs that don't clash", () => {
  assert.equal(newPlaceId("Bar Éxample!", new Set()), "chat-bar-example");
  assert.equal(newPlaceId("Bar Example", new Set(["chat-bar-example"])), "chat-bar-example-2");
  assert.equal(newPlaceId("居酒屋", new Set()), "chat-place");
  assert.match(newPlaceId("x".repeat(80), new Set()), /^[a-z0-9-]+$/);
});

test("propose_places lists the guide's categories and sits before add_place", () => {
  const list = tools(taxonomy);
  const names = list.map((t) => t.name);
  assert.ok(names.indexOf("propose_places") < names.indexOf("add_place"));
  assert.match(list.find((t) => t.name === "propose_places").description, /drink: Beer & Whisky, Cool Bars, After Dark/);
  // Built once, so the cached prompt prefix stays the same
  assert.equal(tools(taxonomy), list);
  const search = list.find((t) => t.name === "web_search");
  assert.equal(search.allowed_domains, undefined);
});
