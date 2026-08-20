import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildExploreResults } from "./explore-results";

const CENTER = { centerLat: 47.5, centerLng: -121.5 };

function destination(
  id: string,
  name: string | null,
  lat: number,
  lng: number,
  features: string[] = ["summit"],
  elevation: number | null = 1500
) {
  return { id, name, elevation, lat, lng, features };
}

test("results come back nearest to the map centre first", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [
      destination("far", "Far Peak", 47.9, -121.5),
      destination("near", "Near Peak", 47.51, -121.5),
      destination("middle", "Middle Peak", 47.6, -121.5),
    ],
    routes: [],
  });
  assert.deepEqual(
    results.map((r) => r.id),
    ["near", "middle", "far"]
  );
  assert.ok(results[0].metersFromCenter < results[1].metersFromCenter);
});

test("a destination missing coordinates is left out", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [
      { ...destination("a", "Has coords", 47.5, -121.5) },
      { id: "b", name: "No coords", elevation: null, lat: null, lng: null, features: [] },
    ],
    routes: [],
  });
  assert.deepEqual(
    results.map((r) => r.id),
    ["a"]
  );
});

test("the same place from two sources is listed once", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [
      destination("gnis", "Snow Lake", 47.5, -121.5, ["lake"]),
      destination("osm", "Snow Lake", 47.5008, -121.5008, ["lake"]),
      destination("other", "Snow Lake", 46.2, -121.9, ["lake"]),
    ],
    routes: [],
  });
  assert.deepEqual(
    results.map((r) => r.id),
    ["gnis", "other"]
  );
});

test("a route keeps its own row even when a peak shares its name", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [destination("peak", "Mount Si", 47.5, -121.5)],
    // A two-point path either side of the centre.
    routes: [
      {
        id: "route",
        name: "Mount Si",
        polyline6: encodeTwoPoints([47.49, -121.49], [47.51, -121.51]),
        distance: 12000,
        gain: 1000,
      },
    ],
  });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.kind).sort(),
    ["destination", "route"]
  );
  const route = results.find((r) => r.kind === "route");
  assert.equal(route?.typeWord, "Route");
  assert.equal(route?.routeDistance, 12000);
});

test("a route with no usable path is dropped rather than placed at 0,0", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [],
    routes: [
      { id: "empty", name: "No path", polyline6: null, distance: 1, gain: 1 },
    ],
  });
  assert.deepEqual(results, []);
});

test("the type word comes from the destination's features", () => {
  const results = buildExploreResults({
    ...CENTER,
    destinations: [
      destination("l", "A Lake", 47.5, -121.5, ["lake"]),
      destination("w", "A Falls", 47.52, -121.5, ["waterfall"]),
      destination("v", "A Volcano", 47.54, -121.5, ["summit", "volcano"]),
    ],
    routes: [],
  });
  assert.deepEqual(
    results.map((r) => r.typeWord),
    ["Lake", "Waterfall", "Volcano"]
  );
});

/** Minimal precision-1e6 encoder for two points. */
function encodeTwoPoints(a: [number, number], b: [number, number]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of [a, b]) {
    const latE6 = Math.round(lat * 1e6);
    const lngE6 = Math.round(lng * 1e6);
    chunk(latE6 - lastLat);
    chunk(lngE6 - lastLng);
    lastLat = latE6;
    lastLng = lngE6;
  }
  return out;
}
