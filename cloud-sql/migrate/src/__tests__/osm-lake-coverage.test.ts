import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildLakeExternalIds,
  deterministicLakeDestinationId,
  extractOsmLakeLinework,
  findExactNameProximityMatch,
  haversineMeters,
  matchExactNameProximity,
  normalizeLakeName,
  osmExternalIdField,
  osmExternalIdKey,
  osmIdentityKey,
  lakeExternalIdKey,
  lakeIdentityKey,
  matchLakeCandidate,
  parseElevationMeters,
  parseLakeCandidates,
  parseOsmWaterLakeElement,
  parseOsmWaterLakeElements,
  type LakeDestinationPoint,
} from "../osm-lake-coverage";

test("normalizes lake names without dropping meaningful words", () => {
  assert.equal(normalizeLakeName("  Cráter-Lake & Pond  "), "crater lake and pond");
  assert.equal(normalizeLakeName("O’Malley’s Lake"), "omalleys lake");
  assert.equal(normalizeLakeName("Lago São José"), "lago sao jose");
});

test("parses only named natural water lakes and trims their names", () => {
  const lake = parseOsmWaterLakeElement({
    type: "node",
    id: 123,
    lat: 47.5,
    lon: -121.5,
    tags: { natural: "water", water: "lake", name: "  Snow Lake " },
  });
  assert.ok(lake);
  assert.equal(lake.osmId, "123");
  assert.equal(lake.osmType, "node");
  assert.equal(lake.name, "Snow Lake");
  assert.equal(lake.normalizedName, "snow lake");
  assert.equal(lake.lat, 47.5);
  assert.equal(lake.lng, -121.5);
  assert.equal(lake.elevationM, null);
  assert.equal(lake.linework, null);

  assert.equal(parseOsmWaterLakeElement({
    type: "node",
    id: 124,
    lat: 47.5,
    lon: -121.5,
    tags: { natural: "water", water: "pond", name: "Not a lake" },
  }), null);
  assert.equal(parseOsmWaterLakeElement({
    type: "node",
    id: 125,
    lat: 47.5,
    lon: -121.5,
    tags: { natural: "water", water: "lake", name: "   " },
  }), null);
  assert.equal(parseOsmWaterLakeElement({
    type: "node",
    id: 126,
    lat: 95,
    lon: -121.5,
    tags: { natural: "water", water: "lake", name: "Bad Coordinates" },
  }), null);
});

test("parses way geometry and keeps center coordinates when supplied", () => {
  const lake = parseOsmWaterLakeElement({
    type: "way",
    id: "42",
    center: { lat: 47.01, lon: -121.01 },
    geometry: [
      { lat: 47, lon: -121 },
      { lat: 47, lon: -121.02 },
      { lat: 47.02, lon: -121.02 },
      { lat: 47.02, lon: -121 },
      { lat: 47, lon: -121 },
    ],
    tags: { natural: "water", water: "lake", name: "Way Lake" },
  });
  assert.ok(lake);
  assert.deepEqual(lake.linework, {
    type: "MultiLineString",
    coordinates: [[
      [-121, 47],
      [-121.02, 47],
      [-121.02, 47.02],
      [-121, 47.02],
      [-121, 47],
    ]],
  });
  const wayLine = lake.linework?.coordinates[0];
  assert.ok(wayLine);
  assert.deepEqual(wayLine[wayLine.length - 1], [-121, 47]);
  assert.deepEqual({ lat: lake.lat, lng: lake.lng }, { lat: 47.01, lng: -121.01 });
});

test("extracts outer and inner relation member linework and ignores non-way members", () => {
  const linework = extractOsmLakeLinework({
    type: "relation",
    id: 90,
    members: [
      {
        type: "way",
        role: "outer",
        geometry: [
          { lat: 47, lon: -121 },
          { lat: 47, lon: -121.1 },
          { lat: 47.1, lon: -121.1 },
          { lat: 47.1, lon: -121 },
          { lat: 47, lon: -121 },
        ],
      },
      {
        type: "way",
        role: "inner",
        geometry: [
          { lat: 47.03, lon: -121.03 },
          { lat: 47.03, lon: -121.06 },
          { lat: 47.06, lon: -121.06 },
          { lat: 47.06, lon: -121.03 },
          { lat: 47.03, lon: -121.03 },
        ],
      },
      { type: "node", role: "label", geometry: [{ lat: 47.04, lon: -121.04 }] },
    ],
  });
  assert.ok(linework);
  assert.equal(linework.coordinates.length, 2);
  assert.deepEqual(linework.coordinates[0][0], [-121, 47]);
  assert.deepEqual(linework.coordinates[1][0], [-121.03, 47.03]);

  assert.equal(extractOsmLakeLinework({
    type: "way",
    geometry: [{ lat: 47, lon: -121 }],
  }), null);
});

test("uses geometry as a center fallback and deduplicates element identities", () => {
  const response = {
    elements: [
      {
        type: "relation",
        id: "700",
        members: [{
          type: "way",
          role: "outer",
          geometry: [
            { lat: 47, lon: -121 },
            { lat: 47, lon: -121.02 },
            { lat: 47.02, lon: -121.02 },
            { lat: 47.02, lon: -121 },
          ],
        }],
        tags: { natural: "water", water: "lake", name: "Relation Lake" },
      },
      {
        type: "relation",
        id: "700",
        center: { lat: 47.01, lon: -121.01 },
        tags: { natural: "water", water: "lake", name: "Relation Lake" },
      },
      {
        type: "way",
        id: 700,
        center: { lat: 47.5, lon: -121.5 },
        tags: { natural: "water", water: "lake", name: "Way Lake" },
      },
    ],
  };
  const lakes = parseOsmWaterLakeElements(response);
  assert.equal(lakes.length, 2);
  assert.equal(lakes[0].osmId, "700");
  assert.equal(lakes[0].osmType, "relation");
  assert.ok(Math.abs(lakes[0].lat - 47.01) < 1e-10);
  assert.ok(Math.abs(lakes[0].lng + 121.01) < 1e-10);
  assert.equal(lakes[1].osmType, "way");
  assert.equal(parseLakeCandidates(response).length, 2);
});

test("prefers a lake relation over its tagged member way", () => {
  const geometry = [
    { lat: 47, lon: -121 },
    { lat: 47, lon: -121.01 },
    { lat: 47.01, lon: -121 },
    { lat: 47, lon: -121 },
  ];
  const lakes = parseOsmWaterLakeElements({
    elements: [
      {
        type: "way",
        id: 55,
        geometry,
        tags: { natural: "water", water: "lake", name: "Member Lake" },
      },
      {
        type: "relation",
        id: 77,
        members: [{ type: "way", ref: 55, role: "outer", geometry }],
        tags: { natural: "water", water: "lake", name: "Member Lake" },
      },
    ],
  });

  assert.deepEqual(lakes.map((lake) => lake.osmType), ["relation"]);
  assert.equal(lakes[0].osmId, "77");
});

test("type-qualified identity, external keys, and destination IDs are stable", () => {
  assert.equal(osmIdentityKey("node", "000123"), "node:123");
  assert.equal(lakeIdentityKey("node", "000123"), "node:123");
  assert.equal(osmExternalIdField("relation"), "osm_relation");
  assert.equal(osmExternalIdKey("way", 123), "osm_way:123");
  assert.equal(lakeExternalIdKey("way"), "osm_way");
  assert.deepEqual(buildLakeExternalIds("way", 123), { osm_way: "123" });

  const nodeId = deterministicLakeDestinationId("node", 123);
  const wayId = deterministicLakeDestinationId("way", 123);
  assert.match(nodeId, /^[0-9A-F]{20}$/);
  assert.equal(nodeId.length, 20);
  assert.equal(nodeId, deterministicLakeDestinationId("node", "123"));
  assert.notEqual(nodeId, wayId);
});

test("parses metric and explicit feet elevations", () => {
  assert.equal(parseElevationMeters("1,234.5 m"), 1234.5);
  assert.ok(Math.abs((parseElevationMeters("5989 ft") ?? 0) - 1825.45) < 0.1);
  assert.equal(parseElevationMeters("unknown"), null);
});

test("haversine distance handles identical points and longitude wrapping", () => {
  assert.equal(haversineMeters({ lat: 47, lng: -121 }, { lat: 47, lng: -121 }), 0);
  const oneDegree = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(oneDegree > 111_000 && oneDegree < 111_300);
  const wrapped = haversineMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
  assert.ok(wrapped < 25_000);
});

test("exact-name proximity matching refuses ambiguous legacy rows", () => {
  const incoming: LakeDestinationPoint = {
    name: "Snow Lake",
    lat: 47,
    lng: -121,
  };
  const one = { id: "one", name: " snow-lake ", lat: 47.0001, lng: -121 };
  const two = { id: "two", name: "Snow Lake", lat: 47.0002, lng: -121 };

  const match = matchExactNameProximity(incoming, [one], 200);
  assert.equal(match.kind, "match");
  if (match.kind === "match") {
    assert.equal(match.candidate.id, "one");
    assert.ok(match.distanceMeters < 20);
  }
  assert.equal(findExactNameProximityMatch(incoming, [one, two], 200).kind, "ambiguous");
  const runnerMatch = matchLakeCandidate(
    { osmId: "10", osmType: "way", name: "Snow Lake", normalizedName: "snow lake", lat: 47, lng: -121, tags: {}, elevationM: null, linework: null },
    [one],
    200
  );
  assert.equal(runnerMatch.kind, "match");
  assert.equal(matchExactNameProximity({ ...incoming, name: "Other Lake" }, [one], 200).kind, "none");
  assert.equal(matchExactNameProximity(incoming, [{ ...one, lat: 48 }], 200).kind, "none");
});
