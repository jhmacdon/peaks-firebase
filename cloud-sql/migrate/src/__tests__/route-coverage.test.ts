import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitOsmRouteName,
  isNamedPublicRecording,
  pointToPolylineDistanceMeters,
  stitchOsmRouteChains,
} from "../route-coverage";

test("accepts only explicit OSM route names", () => {
  assert.equal(explicitOsmRouteName({ name: "  Pacific Crest Trail  " }), "Pacific Crest Trail");
  assert.equal(explicitOsmRouteName({ name: "Unnamed" }), null);
  assert.equal(explicitOsmRouteName({ ref: "PCT" }), null);
});

test("public recording names must name a linked summit", () => {
  assert.equal(isNamedPublicRecording("Mount Rainier", ["Mount Rainier"]), true);
  assert.equal(isNamedPublicRecording("Mailbox / Dirtybox", ["Mailbox Peak", "Dirtybox Peak"]), true);
  assert.equal(isNamedPublicRecording("Morning Hike", ["Mount Rainier"]), false);
  assert.equal(isNamedPublicRecording("Goldmyer hot springs", ["Granite Mountain"]), false);
});

test("stitches reversed OSM members into one stable chain", () => {
  const chains = stitchOsmRouteChains({
    type: "relation",
    id: 42,
    members: [
      {
        type: "way",
        ref: 1,
        geometry: [
          { lat: 47, lon: -121 },
          { lat: 47.01, lon: -121 },
        ],
      },
      {
        type: "way",
        ref: 2,
        geometry: [
          { lat: 47.02, lon: -121 },
          { lat: 47.01, lon: -121 },
        ],
      },
    ],
  });

  assert.equal(chains.length, 1);
  assert.equal(chains[0].points.length, 3);
  assert.ok(chains[0].distanceMeters > 2_000);
});

test("measures a summit against each route segment", () => {
  const distance = pointToPolylineDistanceMeters(
    { lat: 47.005, lng: -121.0001 },
    [
      { lat: 47, lng: -121 },
      { lat: 47.01, lng: -121 },
    ]
  );
  assert.ok(distance > 5 && distance < 20);
});
