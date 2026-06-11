import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildLinkDestinationsSql,
  geometryToMultiPolygon,
  normalizePadusFeature,
  parseGeoJsonFeatures,
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

function padusFeature(properties: Record<string, unknown>) {
  return {
    type: "Feature" as const,
    geometry: square,
    properties,
  };
}

function sqlStatementCount(sql: string): number {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean).length;
}

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
  assert.match(area?.sourceId ?? "", /^padus-/);
  assert.doesNotMatch(area?.sourceId ?? "", /^padus\d+-/);
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

test("builds destination-area link SQL through the schema helper function", () => {
  const keep = buildLinkDestinationsSql(false);
  assert.equal(keep, "SELECT link_summit_destinations_to_areas(false) AS inserted_count;");
  assert.doesNotMatch(keep, /DELETE FROM destination_areas/);
  assert.doesNotMatch(keep, /WITH deleted AS/i);
  assert.equal(sqlStatementCount(keep), 1);

  const replace = buildLinkDestinationsSql(true);
  assert.equal(replace, "SELECT link_summit_destinations_to_areas(true) AS inserted_count;");
  assert.equal(sqlStatementCount(replace), 1);
  assert.doesNotMatch(replace, /WITH deleted AS/i);
  assert.doesNotMatch(replace, /DELETE FROM destination_areas/i);
});

test("recognizes federal PAD-US agency and owner domain codes", () => {
  const cases = [
    {
      name: "FED manager type",
      props: { Unit_Nm: "Mojave National Preserve", Des_Tp: "National Preserve", Mang_Type: "FED" },
      expectedKind: "other_federal_area",
    },
    {
      name: "NPS manager code",
      props: { Unit_Nm: "Point Reyes National Seashore", Des_Tp: "National Seashore", Mang_Name: "NPS" },
      expectedKind: "other_federal_area",
    },
    {
      name: "USFS owner code",
      props: { Unit_Nm: "Mount Hood National Forest", Des_Tp: "National Forest", Own_Name: "USFS" },
      expectedKind: "national_forest",
    },
    {
      name: "BLM manager code",
      props: { Unit_Nm: "Red Rock Canyon ACEC", Des_Tp: "Area of Critical Environmental Concern", Mang_Name: "BLM" },
      expectedKind: "other_federal_area",
    },
    {
      name: "FWS owner code",
      props: { Unit_Nm: "Nisqually National Wildlife Refuge", Des_Tp: "National Wildlife Refuge", Own_Name: "FWS" },
      expectedKind: "wildlife_refuge",
    },
  ];

  for (const { name, props, expectedKind } of cases) {
    const area = normalizePadusFeature(padusFeature(props), "4.1");
    assert.equal(area?.kind, expectedKind, name);
  }
});

test("recognizes outdoor-relevant federal units beyond narrow park and forest regexes", () => {
  const cases = [
    {
      designation: "National Preserve",
      unitName: "Mojave National Preserve",
      manager: "National Park Service",
      expectedKind: "other_federal_area",
    },
    {
      designation: "National Seashore",
      unitName: "Point Reyes National Seashore",
      manager: "NPS",
      expectedKind: "other_federal_area",
    },
    {
      designation: "National Lakeshore",
      unitName: "Apostle Islands National Lakeshore",
      manager: "NPS",
      expectedKind: "other_federal_area",
    },
    {
      designation: "Wilderness Study Area",
      unitName: "Steens Mountain Wilderness Study Area",
      manager: "FED",
      expectedKind: "wilderness",
    },
    {
      designation: "Area of Critical Environmental Concern",
      unitName: "Red Rock Canyon ACEC",
      manager: "FED",
      expectedKind: "other_federal_area",
    },
    {
      designation: "National Monument",
      unitName: "Craters of the Moon National Monument",
      manager: "NPS",
      expectedKind: "national_monument",
    },
  ];

  for (const { designation, unitName, manager, expectedKind } of cases) {
    const area = normalizePadusFeature(padusFeature({
      Unit_Nm: unitName,
      Des_Tp: designation,
      Mang_Name: manager,
    }), "4.1");

    assert.equal(area?.kind, expectedKind, designation);
  }
});

test("recognizes the U.S. Fish & Wildlife Service ampersand manager form", () => {
  const area = normalizePadusFeature(padusFeature({
    Unit_Nm: "Billy Frank Jr. Nisqually National Wildlife Refuge",
    Des_Tp: "National Wildlife Refuge",
    Mang_Name: "U.S. Fish & Wildlife Service",
  }), "4.1");

  assert.equal(area?.kind, "wildlife_refuge");
});

test("uses version-independent source IDs from canonical grouping fields", () => {
  const fullManager = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mount Rainier National Park",
    Des_Tp: "National Park",
    Mang_Name: "National Park Service",
  }), "4.1");
  const managerCode = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mount Rainier National Park",
    Des_Tp: "National Park",
    Mang_Name: "NPS",
  }), "5.0");

  assert.equal(fullManager?.sourceId, managerCode?.sourceId);
  assert.match(fullManager?.sourceId ?? "", /^padus-/);
  assert.doesNotMatch(fullManager?.sourceId ?? "", /^padus\d+-/);
  assert.equal(managerCode?.sourceVersion, "5.0");
  assert.equal(managerCode?.groupKey, "national_park|mount rainier national park|national park|national park service");
});

test("uses owner agency for grouping when manager agency is absent", () => {
  const managerCode = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mount Hood National Forest",
    Des_Tp: "National Forest",
    Mang_Name: "USFS",
  }), "4.1");
  const ownerCode = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mount Hood National Forest",
    Des_Tp: "National Forest",
    Own_Name: "USFS",
  }), "4.1");

  assert.equal(managerCode?.groupKey, "national_forest|mount hood national forest|national forest|forest service");
  assert.equal(ownerCode?.groupKey, managerCode?.groupKey);
  assert.equal(ownerCode?.sourceId, managerCode?.sourceId);
});

test("uses manager and owner type agency codes for grouping when names are absent", () => {
  const managerType = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mojave National Preserve",
    Des_Tp: "National Preserve",
    Mang_Type: "FED",
  }), "4.1");
  const ownerType = normalizePadusFeature(padusFeature({
    Unit_Nm: "Mojave National Preserve",
    Des_Tp: "National Preserve",
    Own_Type: "FED",
  }), "4.1");

  assert.equal(managerType?.groupKey, "other_federal_area|mojave national preserve|national preserve|federal");
  assert.equal(ownerType?.groupKey, managerType?.groupKey);
  assert.equal(ownerType?.sourceId, managerType?.sourceId);
});

test("prefers documented PAD-US source record IDs before object IDs", () => {
  const cases = [
    { field: "Source_PAID", value: "SRC-PAID-1" },
    { field: "SOURCE_PAID", value: "SRC-PAID-2" },
    { field: "source_paid", value: "SRC-PAID-3" },
  ];

  for (const { field, value } of cases) {
    const area = normalizePadusFeature(padusFeature({
      Unit_Nm: "Mount Rainier National Park",
      Des_Tp: "National Park",
      Mang_Name: "National Park Service",
      [field]: value,
      PADUS_ID: "PADUS-SHOULD-NOT-WIN",
      OBJECTID: "OBJECT-SHOULD-NOT-WIN",
    }), "4.1");

    assert.equal(area?.sourceRecordId, value, field);
  }
});

test("uses sorted-key stable source record fallback IDs", () => {
  const first = normalizePadusFeature(padusFeature({
    Unit_Nm: "Ordering National Park",
    Des_Tp: "National Park",
    Mang_Name: "National Park Service",
    Alpha: "one",
    Zulu: "two",
  }), "4.1");
  const reordered = normalizePadusFeature(padusFeature({
    Zulu: "two",
    Alpha: "one",
    Mang_Name: "National Park Service",
    Des_Tp: "National Park",
    Unit_Nm: "Ordering National Park",
  }), "4.1");

  assert.match(first?.sourceRecordId ?? "", /^record-/);
  assert.equal(first?.sourceRecordId, reordered?.sourceRecordId);
});

test("normalizes state and territory names case-insensitively", () => {
  const area = normalizePadusFeature(padusFeature({
    Unit_Nm: "Multi-State National Monument",
    Des_Tp: "National Monument",
    Mang_Name: "NPS",
    State_Nm: "washington; puerto rico",
    State_Nm2: "ca, American Samoa",
    State_Nm3: "Guam",
    State: "u.s. virgin islands",
    STATE: "Northern Mariana Islands",
  }), "4.1");

  assert.deepEqual(area?.stateCodes, ["AS", "CA", "GU", "MP", "PR", "VI", "WA"]);
});

test("parses feature collections and NDJSON features", () => {
  const collectionText = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: square, properties: { Unit_Nm: "A", Des_Tp: "National Park", Mang_Name: "National Park Service" } }],
  });
  const collection = parseGeoJsonFeatures(collectionText);
  assert.equal(collection.length, 1);

  const ndjson = [
    JSON.stringify({ type: "Feature", geometry: square, properties: { Unit_Nm: "A", Des_Tp: "National Park", Mang_Name: "National Park Service" } }),
    JSON.stringify({ type: "Feature", geometry: square, properties: { Unit_Nm: "B", Des_Tp: "National Forest", Mang_Name: "Forest Service" } }),
  ].join("\n");
  const parsedNdjson = parseGeoJsonFeatures(ndjson);
  assert.equal(parsedNdjson.length, 2);
});
