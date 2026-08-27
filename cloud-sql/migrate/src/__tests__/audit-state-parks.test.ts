import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLogicalParkWhere,
  buildStateParkDiscoveryParams,
  buildStateParkFeatureParams,
  parseArcGisObjectIds,
  parseStateParkAuditArgs,
  type SummitPoint,
} from "../audit-state-parks";
import type { GeoJsonFeature } from "../padus-area-utils";

const summit: SummitPoint = {
  id: "mount-mitchell",
  name: "Mount Mitchell",
  stateCode: "NC",
  prominenceM: 1856,
  lat: 35.7648,
  lng: -82.2652,
};

function feature(properties: Record<string, unknown>): GeoJsonFeature {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-82.3, 35.7],
        [-82.2, 35.7],
        [-82.2, 35.8],
        [-82.3, 35.8],
        [-82.3, 35.7],
      ]],
    },
  };
}

test("audit defaults to every lower-48 state and summary output", () => {
  assert.deepEqual(parseStateParkAuditArgs([]), {
    stateCode: null,
    format: "summary",
    batchSize: 200,
    geojsonOutput: null,
    reportOutput: null,
  });
});

test("audit accepts a lower-48 state and output paths", () => {
  assert.deepEqual(parseStateParkAuditArgs([
    "--state=nc",
    "--format=json",
    "--batch-size=25",
    "--geojson-output=/tmp/parks.geojson",
    "--report-output=/tmp/parks.json",
  ]), {
    stateCode: "NC",
    format: "json",
    batchSize: 25,
    geojsonOutput: "/tmp/parks.geojson",
    reportOutput: "/tmp/parks.json",
  });
});

test("audit rejects Alaska, bad batch sizes, and unknown flags", () => {
  assert.throws(() => parseStateParkAuditArgs(["--state=AK"]), /lower-48/);
  assert.throws(() => parseStateParkAuditArgs(["--batch-size=0"]), /1 to 500/);
  assert.throws(() => parseStateParkAuditArgs(["--apply=true"]), /Unknown argument/);
});

test("discovery uses PAD-US state parks, multipoints, and the canonical tolerance", () => {
  const params = buildStateParkDiscoveryParams("NC", [summit]);
  assert.equal(params.get("where"), "Des_Tp='SP' AND State_Nm='NC'");
  assert.equal(params.get("geometryType"), "esriGeometryMultipoint");
  assert.equal(params.get("spatialRel"), "esriSpatialRelIntersects");
  assert.equal(params.get("distance"), "50");
  assert.equal(params.get("units"), "esriSRUnit_Meter");
  assert.equal(params.get("returnIdsOnly"), "true");
  assert.deepEqual(JSON.parse(params.get("geometry") ?? ""), {
    points: [[-82.2652, 35.7648]],
    spatialReference: { wkid: 4326 },
  });
});

test("feature queries request complete WGS84 GeoJSON", () => {
  const params = buildStateParkFeatureParams([218497, 218498]);
  assert.equal(params.get("objectIds"), "218497,218498");
  assert.equal(params.get("outFields"), "*");
  assert.equal(params.get("returnGeometry"), "true");
  assert.equal(params.get("outSR"), "4326");
  assert.equal(params.get("f"), "geojson");
});

test("ArcGIS object IDs accept explicit no-match null but reject malformed responses", () => {
  assert.deepEqual(parseArcGisObjectIds({ objectIds: null }, "AZ"), []);
  assert.deepEqual(parseArcGisObjectIds({ objectIds: [218497, "218498"] }, "NC"), [
    218497,
    218498,
  ]);
  assert.throws(() => parseArcGisObjectIds({}, "AZ"), /no objectIds array/);
  assert.throws(
    () => parseArcGisObjectIds({ objectIds: ["bad"] }, "AZ"),
    /invalid OBJECTID/
  );
});

test("logical park queries fetch every feature sharing a state-local Source_PAID", () => {
  const clauses = buildLogicalParkWhere([
    feature({ OBJECTID: 218497, State_Nm: "NC", Source_PAID: "643" }),
    feature({ OBJECTID: 218498, State_Nm: "NC", Source_PAID: "643" }),
    feature({ OBJECTID: 999, State_Nm: "CA", Source_PAID: "O'Neil" }),
  ]);
  assert.deepEqual(clauses, [
    "Des_Tp='SP' AND State_Nm='CA' AND Source_PAID IN ('O''Neil')",
    "Des_Tp='SP' AND State_Nm='NC' AND Source_PAID IN ('643')",
  ]);
});

test("logical park queries fall back to exact object IDs when Source_PAID is blank", () => {
  assert.deepEqual(buildLogicalParkWhere([
    feature({ OBJECTID: 7, State_Nm: "UT", Source_PAID: "" }),
  ]), ["OBJECTID IN (7)"]);
});
