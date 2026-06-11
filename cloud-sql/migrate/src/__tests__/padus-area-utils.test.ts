import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildLinkDestinationsSql,
  geometryToMultiPolygon,
  normalizePadusFeature,
  shouldImportPadusFeature,
} from "../padus-area-utils";

const square = {
  type: "Polygon" as const,
  coordinates: [[
    [-121.9, 46.7],
    [-121.6, 46.7],
    [-121.6, 46.95],
    [-121.9, 46.95],
    [-121.9, 46.7],
  ]],
};

test("normalizes a PAD-US national park feature", () => {
  const area = normalizePadusFeature({
    type: "Feature",
    geometry: square,
    properties: {
      Unit_Nm: "Mount Rainier National Park",
      Des_Tp: "National Park",
      Mang_Name: "National Park Service",
      Own_Name: "National Park Service",
      State_Nm: "Washington",
      State_Nm2: "",
      GIS_Acres: 236380.1,
      PADUS_ID: "NPS-MORA",
    },
  }, "4.1");

  assert.equal(area?.name, "Mount Rainier National Park");
  assert.equal(area?.searchName, "mount rainier national park");
  assert.equal(area?.kind, "national_park");
  assert.equal(area?.designation, "National Park");
  assert.equal(area?.manager, "National Park Service");
  assert.deepEqual(area?.stateCodes, ["WA"]);
  assert.equal(area?.source, "padus");
  assert.equal(area?.sourceVersion, "4.1");
  assert.equal(area?.sourceRecordId, "NPS-MORA");
  assert.match(area?.sourceId ?? "", /^padus41-/);
  assert.equal(area?.groupKey, "national_park|mount rainier national park|national park|national park service");
});

test("keeps outdoor-relevant federal wilderness and rejects local parks", () => {
  const wilderness = {
    type: "Feature" as const,
    geometry: square,
    properties: {
      Unit_Nm: "Alpine Lakes Wilderness",
      Des_Tp: "Wilderness Area",
      Mang_Name: "Forest Service",
      Own_Name: "Forest Service",
      State_Nm: "Washington",
    },
  };
  const localPark = {
    type: "Feature" as const,
    geometry: square,
    properties: {
      Unit_Nm: "Volunteer Park",
      Des_Tp: "Local Park",
      Mang_Name: "City Land",
      Own_Name: "City Land",
      State_Nm: "Washington",
    },
  };

  assert.equal(shouldImportPadusFeature(wilderness), true);
  assert.equal(shouldImportPadusFeature(localPark), false);
});

test("converts polygons to multipolygons and preserves multipolygons", () => {
  assert.deepEqual(geometryToMultiPolygon(square), {
    type: "MultiPolygon",
    coordinates: [square.coordinates],
  });

  const multi = {
    type: "MultiPolygon" as const,
    coordinates: [square.coordinates],
  };
  assert.deepEqual(geometryToMultiPolygon(multi), multi);
});

test("builds ST_Covers destination-area link SQL with optional replacement", () => {
  const keep = buildLinkDestinationsSql(false);
  assert.doesNotMatch(keep, /DELETE FROM destination_areas/);
  assert.match(keep, /ST_Covers\(a\.boundary, d\.location\)/);
  assert.match(keep, /'summit'::destination_feature = ANY\(d\.features\)/);

  const replace = buildLinkDestinationsSql(true);
  assert.match(replace, /DELETE FROM destination_areas WHERE source = 'postgis'/);
  assert.match(replace, /ON CONFLICT \(destination_id, area_id\) DO NOTHING/);
});
