import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_MAP_TYPES,
  DEFAULT_MAP_VIEW,
  allTypesSelected,
  clampViewportBounds,
  dedupeByNameAndProximity,
  destinationFeatureFilter,
  destinationTypeWord,
  destinationTypesSelected,
  haversineMeters,
  mapExploreHref,
  mapSearchHref,
  parseMapExploreUrl,
  parseMapTypes,
  routesSelected,
  serializeMapTypes,
  shouldAutoLocate,
  toggleMapType,
  type MapTypeId,
} from "./map-view";

test("a pinned view survives the round trip through the URL", () => {
  const href = mapExploreHref({
    view: { lat: 46.8523, lng: -121.7603, zoom: 12 },
    types: [...DEFAULT_MAP_TYPES],
  });
  const parsed = parseMapExploreUrl(href.slice(href.indexOf("?")));
  assert.deepEqual(parsed.view, { lat: 46.8523, lng: -121.7603, zoom: 12 });
  assert.deepEqual(parsed.types, DEFAULT_MAP_TYPES);
  assert.equal(parsed.query, "");
});

test("no view in the URL reads as unpinned, not as the default view", () => {
  const parsed = parseMapExploreUrl("");
  assert.equal(parsed.view, null);
  assert.notEqual(DEFAULT_MAP_VIEW, null);
});

test("a half-written or out-of-range view is ignored", () => {
  assert.equal(parseMapExploreUrl("?lat=47.5&z=9").view, null);
  assert.equal(parseMapExploreUrl("?lat=947.5&lng=-121.5&z=9").view, null);
  assert.equal(parseMapExploreUrl("?lat=47.5&lng=-421.5&z=9").view, null);
  assert.equal(parseMapExploreUrl("?lat=x&lng=y&z=z").view, null);
});

test("zoom is rounded and clamped to what the tiles cover", () => {
  assert.equal(parseMapExploreUrl("?lat=47.5&lng=-121.5&z=11.6").view?.zoom, 12);
  assert.equal(parseMapExploreUrl("?lat=47.5&lng=-121.5&z=99").view?.zoom, 18);
  assert.equal(parseMapExploreUrl("?lat=47.5&lng=-121.5&z=-3").view?.zoom, 2);
});

test("the default type selection never appears in the URL", () => {
  assert.equal(serializeMapTypes(["peaks", "routes"]), null);
  assert.equal(serializeMapTypes(["routes", "peaks"]), null);
  assert.equal(serializeMapTypes(["peaks"]), "peaks");
  assert.equal(
    serializeMapTypes(["waterfalls", "peaks", "routes", "lakes"]),
    "peaks,routes,lakes,waterfalls"
  );
});

test("a missing or unreadable types param falls back to peaks and routes", () => {
  assert.deepEqual(parseMapTypes(null), DEFAULT_MAP_TYPES);
  assert.deepEqual(parseMapTypes("glaciers,fjords"), DEFAULT_MAP_TYPES);
  assert.deepEqual(parseMapTypes(""), DEFAULT_MAP_TYPES);
  assert.deepEqual(parseMapTypes("lakes,glaciers"), ["lakes"]);
  assert.deepEqual(parseMapTypes("waterfalls,peaks"), ["peaks", "waterfalls"]);
});

test("the query rides along in the URL and comes back trimmed", () => {
  const href = mapExploreHref({
    view: DEFAULT_MAP_VIEW,
    types: ["peaks"],
    query: "  mount rainier ",
  });
  assert.ok(href.includes("q=mount+rainier"));
  assert.ok(href.includes("types=peaks"));
  assert.equal(
    parseMapExploreUrl(href.slice(href.indexOf("?"))).query,
    "mount rainier"
  );
});

test("an empty query is left out of the URL", () => {
  const href = mapExploreHref({
    view: DEFAULT_MAP_VIEW,
    types: [...DEFAULT_MAP_TYPES],
    query: "   ",
  });
  assert.ok(!href.includes("q="));
  assert.ok(!href.includes("types="));
});

test("a search handed to the map carries only the query", () => {
  assert.equal(mapSearchHref("Mount Si"), "/map?q=Mount%20Si");
  assert.equal(mapSearchHref("  "), "/map");
  assert.equal(
    parseMapExploreUrl(mapSearchHref("rainier").slice("/map".length)).query,
    "rainier"
  );
});

test("the browser is only asked for a location when the URL asked for nothing", () => {
  assert.equal(shouldAutoLocate({ view: null, query: "" }), true);
  assert.equal(shouldAutoLocate({ view: null, query: " " }), true);
  // A single letter never runs a search, so it never says where to look.
  assert.equal(shouldAutoLocate({ view: null, query: "r" }), true);
  // A query says where to look — the map flies to its best match, and a
  // late "allow" must not drag the reader off it.
  assert.equal(shouldAutoLocate({ view: null, query: "rainier" }), false);
  // A pinned view says it outright.
  assert.equal(shouldAutoLocate({ view: DEFAULT_MAP_VIEW, query: "" }), false);
  assert.equal(
    shouldAutoLocate({ view: DEFAULT_MAP_VIEW, query: "rainier" }),
    false
  );
  assert.equal(
    shouldAutoLocate(parseMapExploreUrl(mapSearchHref("rainier").slice(4))),
    false
  );
  assert.equal(shouldAutoLocate(parseMapExploreUrl("")), true);
});

test("toggling a chip adds and removes it, but never empties the map", () => {
  assert.deepEqual(toggleMapType(["peaks", "routes"], "lakes"), [
    "peaks",
    "routes",
    "lakes",
  ]);
  assert.deepEqual(toggleMapType(["peaks", "routes"], "routes"), ["peaks"]);
  assert.deepEqual(toggleMapType(["peaks"], "peaks"), ["peaks"]);
});

test("all-selected is what the All chip reads from", () => {
  assert.equal(allTypesSelected(["peaks", "routes"]), false);
  assert.equal(
    allTypesSelected(["peaks", "routes", "lakes", "waterfalls"]),
    true
  );
});

test("the feature filter follows the destination chips", () => {
  assert.deepEqual(destinationFeatureFilter(["peaks", "routes"]), [
    "summit",
    "volcano",
  ]);
  assert.deepEqual(destinationFeatureFilter(["lakes", "waterfalls"]), [
    "lake",
    "waterfall",
  ]);
  // Every destination chip on means "everything", including the trailheads
  // and huts that carry none of the three named features.
  assert.equal(
    destinationFeatureFilter(["peaks", "routes", "lakes", "waterfalls"]),
    null
  );
  // Routes only: no destination query at all.
  assert.deepEqual(destinationFeatureFilter(["routes"]), []);
  assert.deepEqual(destinationTypesSelected(["routes"]), []);
  assert.equal(routesSelected(["peaks"]), false);
  assert.equal(routesSelected(["peaks", "routes"]), true);
});

test("a whole-world viewport is narrowed to a span PostGIS can answer", () => {
  const clamped = clampViewportBounds({
    minLat: -95,
    maxLat: 95,
    minLng: -260,
    maxLng: 260,
  });
  assert.equal(clamped.minLat, -85);
  assert.equal(clamped.maxLat, 85);
  assert.equal(clamped.maxLng - clamped.minLng, 340);
  assert.ok(clamped.minLng >= -180 && clamped.maxLng <= 180);
});

test("an ordinary viewport passes through untouched, whichever way round", () => {
  const bounds = { minLat: 47, maxLat: 48, minLng: -122.5, maxLng: -120.5 };
  assert.deepEqual(clampViewportBounds(bounds), bounds);
  assert.deepEqual(
    clampViewportBounds({ minLat: 48, maxLat: 47, minLng: -120.5, maxLng: -122.5 }),
    bounds
  );
});

test("haversine measures a known separation", () => {
  // Camp Muir to Mount Rainier's summit: 1.79 km north by 2.22 km west,
  // so a shade under 2.9 km apart.
  const meters = haversineMeters(46.8362, -121.7311, 46.8523, -121.7603);
  assert.ok(meters > 2800 && meters < 2900, `got ${meters}`);
  assert.equal(haversineMeters(47.5, -121.5, 47.5, -121.5), 0);
});

test("same-name rows on top of each other collapse to the first", () => {
  const rows = [
    { id: "a", name: "Bear Lake", lat: 47.5, lng: -121.5 },
    { id: "b", name: "bear lake ", lat: 47.5005, lng: -121.5005 },
    { id: "c", name: "Bear Lake", lat: 44.2, lng: -110.4 },
    { id: "d", name: null, lat: 47.5, lng: -121.5 },
    { id: "e", name: null, lat: 47.5, lng: -121.5 },
  ];
  assert.deepEqual(
    dedupeByNameAndProximity(rows).map((row) => row.id),
    ["a", "c", "d", "e"]
  );
});

test("a place is named by its most specific feature", () => {
  assert.equal(destinationTypeWord(["summit", "volcano"]), "Volcano");
  assert.equal(destinationTypeWord(["summit"]), "Peak");
  assert.equal(destinationTypeWord(["summit", "fire-lookout"]), "Lookout");
  assert.equal(destinationTypeWord(["lake"]), "Lake");
  assert.equal(destinationTypeWord([]), "Place");
});

test("every chip id round-trips through parse and serialize", () => {
  const ids: MapTypeId[] = ["peaks", "routes", "lakes", "waterfalls"];
  for (const id of ids) {
    const serialized = serializeMapTypes([id]);
    assert.ok(serialized, `${id} should serialize`);
    assert.deepEqual(parseMapTypes(serialized), [id]);
  }
});
