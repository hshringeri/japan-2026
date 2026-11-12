import { test } from "node:test";
import assert from "node:assert/strict";
import { trainJourney, stationDirectionsUrl } from "../../js/train-times.js";

test("a direct ride uses the published onboard minutes and no transfer", () => {
  const journey = trainJourney("Shibuya", "Shimokitazawa");
  assert.deepEqual(journey, {
    minutes: 4,
    transfers: 0,
    legs: [{
      from: "Shibuya",
      to: "Shimokitazawa",
      line: "Keio Inokashira express",
      minutes: 4,
      sources: ["https://ekitan.com/transit/route/sf-2248/st-2265"],
    }],
  });
});

test("a direct published pair beats a cheaper composed same-line path", () => {
  // Ginza to Ueno is 12 and Ueno to Asakusa is 6, sampled on different runs.
  // The published direct Ginza to Asakusa ride is 19; never invent 18 from samples.
  const journey = trainJourney("Ginza", "Asakusa");
  assert.equal(journey.minutes, 19);
  assert.equal(journey.transfers, 0);
  assert.equal(journey.legs.length, 1);
  assert.equal(journey.legs[0].line, "Tokyo Metro Ginza Line");
  assert.equal(journey.legs[0].minutes, 19);
  assert.deepEqual(journey.legs[0].sources, ["https://transit.yahoo.co.jp/search/result/銀座-浅草"]);
});

test("contiguous same-line legs are one ride and sum published minutes only", () => {
  const journey = trainJourney("Shibuya", "Kichijoji");
  assert.equal(journey.minutes, 17);
  assert.equal(journey.transfers, 0);
  assert.equal(journey.legs.length, 1);
  assert.deepEqual(journey.legs[0], {
    from: "Shibuya",
    to: "Kichijoji",
    line: "Keio Inokashira express",
    minutes: 17,
    sources: [
      "https://ekitan.com/transit/route/sf-2248/st-2265",
      "https://ekitan.com/transit/route/sf-2265/st-1978",
    ],
  });
});

test("a line change sums published ride minutes, not a 12-minute estimate", () => {
  const journey = trainJourney("Yoyogi-Hachiman", "Kichijoji");
  assert.equal(journey.transfers, 1);
  assert.equal(journey.minutes, 18);
  assert.equal(journey.minutes, journey.legs.reduce((sum, leg) => sum + leg.minutes, 0));
  assert.deepEqual(journey.legs.map((leg) => [leg.from, leg.to, leg.line, leg.minutes]), [
    ["Yoyogi-Hachiman", "Shimokitazawa", "Odakyu Odawara local", 5],
    ["Shimokitazawa", "Kichijoji", "Keio Inokashira express", 13],
  ]);
});

test("reverse rides use the published direction, not a symmetric guess", () => {
  const out = trainJourney("Shibuya", "Shimokitazawa");
  const back = trainJourney("Shimokitazawa", "Shibuya");
  assert.equal(out.minutes, 4);
  assert.equal(back.minutes, 3);
  assert.equal(out.transfers, 0);
  assert.equal(back.transfers, 0);
  assert.deepEqual(back.legs.map((leg) => [leg.from, leg.to, leg.minutes]), [
    ["Shimokitazawa", "Shibuya", 3],
  ]);

  const uphill = trainJourney("Yoyogi-Hachiman", "Kichijoji");
  const downhill = trainJourney("Kichijoji", "Yoyogi-Hachiman");
  assert.equal(uphill.minutes, 18);
  assert.equal(downhill.minutes, 17);
  assert.equal(downhill.transfers, 1);
  assert.deepEqual(downhill.legs.map((leg) => [leg.from, leg.to, leg.minutes]), [
    ["Kichijoji", "Shimokitazawa", 12],
    ["Shimokitazawa", "Yoyogi-Hachiman", 5],
  ]);
});

test("the same known station is zero minutes with no legs", () => {
  assert.deepEqual(trainJourney("Kichijoji", "Kichijoji"), { minutes: 0, transfers: 0, legs: [] });
});

test("an unmapped station has no made-up timing", () => {
  assert.equal(trainJourney("Nowhere", "Kichijoji"), null);
  assert.equal(trainJourney("Kichijoji", "Nowhere"), null);
});


test("every public station pair resolves to a chained journey", () => {
  const stations = [
    "Shibuya", "Harajuku", "Shinjuku", "Koenji", "Nakano", "Ebisu", "Yoyogi-Hachiman",
    "Kichijoji", "Shimokitazawa", "Ueno", "Asakusa", "Akihabara", "Ginza", "Hamamatsucho",
  ];
  for (const from of stations) {
    for (const to of stations) {
      if (from === to) continue;
      const label = `${from} → ${to}`;
      const journey = trainJourney(from, to);
      assert.ok(journey, label);
      assert.ok(journey.legs.length > 0, label);
      assert.equal(journey.legs[0].from, from, label);
      assert.equal(journey.legs[journey.legs.length - 1].to, to, label);
      assert.equal(journey.minutes, journey.legs.reduce((sum, leg) => sum + leg.minutes, 0), label);
      assert.equal(journey.transfers, journey.legs.length - 1, label);
      for (let i = 1; i < journey.legs.length; i++) {
        assert.equal(journey.legs[i].from, journey.legs[i - 1].to, label);
      }
    }
  }
});

test("the directions link names both station coordinates", () => {
  const from = { name: "Shibuya", lat: 35.65803, lng: 139.70164 };
  const to = { name: "Kichijoji", lat: 35.703, lng: 139.58 };
  const url = new URL(stationDirectionsUrl(from, to));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("origin"), "35.65803,139.70164");
  assert.equal(url.searchParams.get("destination"), "35.703,139.58");
  assert.equal(url.searchParams.get("travelmode"), "transit");
});

test("the directions link needs both station coordinates", () => {
  assert.equal(stationDirectionsUrl(null, { lat: 35.7, lng: 139.7 }), null);
  assert.equal(stationDirectionsUrl({ lat: 35.7, lng: 139.7 }, { name: "No coords" }), null);
});
