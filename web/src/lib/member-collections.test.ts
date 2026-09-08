import test from "node:test";
import assert from "node:assert/strict";
import { selectSavedDestinations, sharedTripPrefill, tripGroup, tripPrefill } from "./member-collections";
import type { PublicPlanBundle } from "./public-plan";

test("saved places search location and features, sort without changing the source", () => {
  const places = [
    { id: "a", name: "Rainier", location: "WA, US", elevation: 4392, features: ["summit"], savedAt: "2026-08-01" },
    { id: "b", name: "Lake", location: "CA, US", elevation: null, features: ["lake"], savedAt: "2026-09-01" },
  ];
  assert.deepEqual(selectSavedDestinations(places, " wa ", "name").map((p) => p.id), ["a"]);
  assert.deepEqual(selectSavedDestinations(places, "", "recent").map((p) => p.id), ["b", "a"]);
  assert.deepEqual(selectSavedDestinations(places, "", "elevation").map((p) => p.id), ["a", "b"]);
  assert.equal(places[0].id, "a");
});

test("trip prefills support existing and new links without accepting path fragments", () => {
  assert.deepEqual(tripPrefill(new URLSearchParams("routeId=r1&destination=d1&name=Weekend")), { routeId: "r1", destinationId: "d1", sourceTripId: "", name: "Weekend" });
  assert.equal(tripPrefill(new URLSearchParams("route=../route")).routeId, "");
  assert.equal(tripPrefill(new URLSearchParams("fromTrip=public-trip")).sourceTripId, "public-trip");
  assert.equal(tripPrefill(new URLSearchParams("fromTrip=../trip")).sourceTripId, "");
});

test("shared trip prefill selects only place IDs and catalog route IDs", () => {
  const source = {
    plan: { name: "Weekend", description: "Public notes", date: new Date(), path: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
    destinations: [{ id: "d1", name: "Summit", lat: 10, lng: 20 }],
    routes: [{ id: "catalog", name: "Trail", isCatalog: true, polyline6: "encoded" }, { id: "custom", name: "My track", isCatalog: false }],
    reachedDestinations: [{ id: "reached", name: "Track-only place" }],
  } as unknown as PublicPlanBundle;
  assert.deepEqual(sharedTripPrefill(source), {
    name: "Weekend",
    destinations: [{ id: "d1", name: "Summit" }],
    routes: [{ id: "catalog", name: "Trail" }],
  });
});

test("trip grouping includes today's trips and keeps undated ideas separate", () => {
  assert.equal(tripGroup("2026-09-07", "2026-09-07"), "Upcoming");
  assert.equal(tripGroup("2026-09-06", "2026-09-07"), "Past");
  assert.equal(tripGroup(null, "2026-09-07"), "Ideas");
});
