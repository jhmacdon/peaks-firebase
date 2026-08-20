import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildViewpointExternalIds,
  canonicalOsmViewpointId,
  deterministicViewpointDestinationId,
  exactNameProximityMatches,
  normalizeViewpointName,
  osmViewpointExternalIdField,
  osmViewpointIdentity,
  parseOsmViewpointElement,
  parseOsmViewpointElements,
  parseViewpointElevationMeters,
} from "../osm-viewpoint-coverage";

test("parses a named public OSM viewpoint", () => {
  const viewpoint = parseOsmViewpointElement({
    type: "node",
    id: 123,
    lat: 47.5,
    lon: -121.5,
    tags: { tourism: "viewpoint", name: "  Dirty Harry's Balcony ", ele: "2,680 ft" },
  });

  assert.ok(viewpoint);
  assert.equal(viewpoint.name, "Dirty Harry's Balcony");
  assert.equal(viewpoint.normalizedName, "dirty harrys balcony");
  assert.equal(viewpoint.osmId, "123");
  assert.equal(viewpoint.osmType, "node");
  assert.ok(Math.abs((viewpoint.elevationM ?? 0) - 816.864) < 0.001);
});

test("requires a name and excludes private or closed viewpoints", () => {
  assert.equal(parseOsmViewpointElement({
    type: "node",
    id: 1,
    lat: 47,
    lon: -121,
    tags: { tourism: "viewpoint" },
  }), null);
  assert.equal(parseOsmViewpointElement({
    type: "node",
    id: 2,
    lat: 47,
    lon: -121,
    tags: { tourism: "viewpoint", name: "Private View", access: "private" },
  }), null);
  assert.equal(parseOsmViewpointElement({
    type: "node",
    id: 3,
    lat: 47,
    lon: -121,
    tags: { tourism: "viewpoint", name: "Closed View", access: "no" },
  }), null);
});

test("uses way centers and deduplicates type-qualified identities", () => {
  const viewpoints = parseOsmViewpointElements({
    elements: [
      {
        type: "way",
        id: "00042",
        center: { lat: 47.1, lon: -121.1 },
        tags: { tourism: "viewpoint", name: "Observation Deck" },
      },
      {
        type: "way",
        id: 42,
        center: { lat: 47.1, lon: -121.1 },
        tags: { tourism: "viewpoint", name: "Observation Deck" },
      },
      {
        type: "node",
        id: 42,
        lat: 47.2,
        lon: -121.2,
        tags: { tourism: "viewpoint", name: "Different Node" },
      },
    ],
  });

  assert.equal(viewpoints.length, 2);
  assert.deepEqual(viewpoints.map((value) => value.osmType), ["way", "node"]);
});

test("keeps OSM element namespaces separate", () => {
  assert.equal(canonicalOsmViewpointId("000123"), "123");
  assert.equal(canonicalOsmViewpointId("0"), null);
  assert.equal(osmViewpointIdentity("node", 123), "node:123");
  assert.equal(osmViewpointExternalIdField("relation"), "osm_relation");
  assert.deepEqual(buildViewpointExternalIds("way", 123), { osm_way: "123" });
  assert.notEqual(
    deterministicViewpointDestinationId("node", 123),
    deterministicViewpointDestinationId("way", 123)
  );
  assert.match(deterministicViewpointDestinationId("node", 123), /^[0-9A-F]{20}$/);
});

test("normalizes names and parses metric elevation", () => {
  assert.equal(normalizeViewpointName("  Déception–Pass & Rim  "), "deception pass and rim");
  assert.equal(parseViewpointElevationMeters("1234.5 m"), 1234.5);
  assert.equal(parseViewpointElevationMeters("unknown"), null);
});

test("matches one exact normalized name within the point radius", () => {
  const matches = exactNameProximityMatches(
    { name: "Dirty Harry’s Balcony", lat: 47.433, lng: -121.632 },
    [
      { id: "near", name: "Dirty Harry's Balcony", lat: 47.4331, lng: -121.632 },
      { id: "far", name: "Dirty Harry's Balcony", lat: 47.5, lng: -121.6 },
      { id: "other", name: "Dirty Harry Peak", lat: 47.433, lng: -121.632 },
    ],
    200
  );

  assert.deepEqual(matches.map((match) => match.destination.id), ["near"]);
  assert.ok(matches[0].distanceMeters < 20);
});
