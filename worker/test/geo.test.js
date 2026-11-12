import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { directionsUrl } from "../../js/geo.js";

const places = JSON.parse(readFileSync(new URL("../../data/places.json", import.meta.url)));
const faro = places.find((p) => p.id === "kyoto-gion-omakase-sushi-faro");
const faroId = "0x600109f13716e0d9:0x92237145cf4db80c";

test("venue directions preserve the named Google business instead of a coordinate destination", () => {
  const url = new URL(directionsUrl(faro));
  assert.equal(url.searchParams.get("ftid"), faroId);
  assert.ok(url.searchParams.get("q").includes("Gion OMAKASE SUSHI FARO"));
  assert.equal(url.searchParams.has("destination"), false);
});

test("prepared venues and linked plan stops keep the same business identity", () => {
  const prepared = { ...faro, main: faro.listings[0] };
  const planItem = { title: "Sushi dinner", lat: 35, lng: 135, placeObj: prepared };
  for (const point of [prepared, planItem]) {
    const url = new URL(directionsUrl(point));
    assert.equal(url.searchParams.get("ftid"), faroId);
    assert.equal(url.searchParams.has("destination"), false);
  }
});

test("stays without a saved listing search for their name and street address", () => {
  const stay = { name: "Fuji Classic Hotel", address: "1306 Fujigane, Fujikawaguchiko", lat: 35.42511, lng: 138.62268 };
  const url = new URL(directionsUrl(stay));
  const query = url.searchParams.get("query");
  assert.ok(query.includes(stay.name));
  assert.ok(query.includes(stay.address));
  assert.equal(url.searchParams.has("destination"), false);
});

test("unnamed coordinate-only stops retain transit navigation", () => {
  const url = new URL(directionsUrl({ lat: 35.68, lng: 139.76 }));
  assert.equal(url.pathname, "/maps/dir/");
  assert.equal(url.searchParams.get("destination"), "35.68,139.76");
  assert.equal(url.searchParams.get("travelmode"), "transit");
});

test("a missing destination has no misleading navigation link", () => {
  assert.equal(directionsUrl(null), null);
  assert.equal(directionsUrl({}), null);
});
