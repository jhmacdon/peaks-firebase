import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TRAIL_SOURCES,
  buildSourceSections,
  chainConnectedLines,
  distanceMeters,
  encodePolyline6,
  parseArgs,
  segmentizeLine,
  simplifyLine,
  validateItem,
} from "../import-triple-crown-trails";

test("the import uses stable IDs and published 2026 lengths", () => {
  assert.deepEqual(
    TRAIL_SOURCES.map(({ routeId, officialMiles }) => [routeId, officialMiles]),
    [
      ["triple-crown-pct", 2_655.84],
      ["triple-crown-at", 2_197.9],
      ["triple-crown-cdt", 3_100],
    ]
  );
  assert.equal(new Set(TRAIL_SOURCES.map((source) => source.itemId)).size, 3);
});

test("dry-run is the default and conflicting modes fail", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.throws(() => parseArgs(["--apply", "--dry-run"]), /not both/);
  assert.throws(() => parseArgs(["--write"]), /Unknown option/);
});

test("official item checks fail closed when identity or reuse terms change", () => {
  const source = TRAIL_SOURCES[0];
  const valid = {
    title: source.itemTitle,
    owner: source.itemOwner,
    url: source.layerUrl,
    licenseInfo: `Licensed at ${source.licenseNeedle}`,
  };
  assert.doesNotThrow(() => validateItem(source, valid));
  assert.throws(() => validateItem(source, { ...valid, owner: "someone-else" }), /identity changed/);
  assert.throws(() => validateItem(source, { ...valid, licenseInfo: "all rights reserved" }), /terms changed/);
});

test("line simplification keeps endpoints and removes small noise", () => {
  const points: Array<[number, number]> = [
    [0, 0],
    [0.00001, 0.0001],
    [0, 0.0002],
  ];
  const simplified = simplifyLine(points, 2);
  assert.deepEqual(simplified, [points[0], points[2]]);
});

test("segmentization keeps every vertex gap within the match bound", () => {
  const segmented = segmentizeLine([[0, 0], [0, 0.01]], 100);
  assert.deepEqual(segmented[0], [0, 0]);
  assert.deepEqual(segmented[segmented.length - 1], [0, 0.01]);
  for (let index = 1; index < segmented.length; index++) {
    assert.ok(distanceMeters(segmented[index - 1], segmented[index]) <= 100.1);
  }
});

test("official sections chain south to north despite reversed parts and a tiny fragment", () => {
  const chained = chainConnectedLines([
    [[0, 0], [0, 0.01]],
    [[0, 0.02], [0, 0.01]],
    [[0, 0.03], [0, 0.02]],
    [[1, 1], [1, 1.000001]],
  ]);
  assert.deepEqual(chained, [[0, 0], [0, 0.01], [0, 0.02], [0, 0.03]]);
});

test("official source lines can exceed JavaScript's argument limit", () => {
  const pointCount = 150_000;
  const points = Array.from({ length: pointCount }, (_, index) =>
    [0, index / 1_000_000] as [number, number]
  );

  const chained = chainConnectedLines([points]);

  assert.equal(chained.length, pointCount);
  assert.deepEqual(chained[0], points[0]);
  assert.deepEqual(chained[pointCount - 1], points[pointCount - 1]);
});

test("large adjacent source parts merge into one published section", () => {
  const pointsPerPart = 130_000;
  const first = Array.from({ length: pointsPerPart }, (_, index) =>
    [0, index / 1_000_000] as [number, number]
  );
  const second = Array.from({ length: pointsPerPart }, (_, index) =>
    [0, (pointsPerPart - 1 + index) / 1_000_000] as [number, number]
  );
  const properties = {
    Name: "GATC AT Treadway", Region: "3", Trail_Club: "30",
    Status: "Official A.T. Route", Publish: "Yes",
  };

  const sections = buildSourceSections(TRAIL_SOURCES[1], {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: first }, properties },
      { type: "Feature", geometry: { type: "LineString", coordinates: second }, properties },
    ],
  } as any);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].label, "Georgia Appalachian Trail Club");
  assert.equal(sections[0].startFraction, 0);
  assert.equal(sections[0].endFraction, 1);
});

test("polyline encoding is stable", () => {
  assert.equal(encodePolyline6([[-120.2, 38.5], [-120.95, 40.7]]), "_izlhA~rlgdF_{geC~ywl@");
});

test("PCT sections are the 29 continuous PCTA guidebook stretches", () => {
  const sections = buildSourceSections(TRAIL_SOURCES[0], {
    type: "FeatureCollection",
    features: [],
  } as any);

  assert.equal(sections.length, 29);
  assert.equal(sections[0].label, "Section A");
  assert.equal(sections[17].label, "Section R / A");
  assert.equal(sections[28].label, "Section L");
  assert.equal(sections[0].startFraction, 0);
  assert.equal(sections[28].endFraction, 1);
  for (let index = 1; index < sections.length; index++) {
    assert.equal(sections[index].startFraction, sections[index - 1].endFraction);
  }
});

test("A.T. and CDT section order comes from their official source features", () => {
  const atSections = buildSourceSections(TRAIL_SOURCES[1], {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0], [0, 0.01]] },
        properties: {
          Name: "GATC AT Treadway", Region: "3", Trail_Club: "30",
          Status: "Official A.T. Route", Publish: "Yes",
        },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0.02], [0, 0.01]] },
        properties: {
          Name: "CMC AT Treadway", Region: "3", Trail_Club: "27",
          Status: "Official A.T. Route", Publish: "Yes",
        },
      },
    ],
  } as any);
  assert.deepEqual(atSections.map((section) => section.label), [
    "Georgia Appalachian Trail Club",
    "Carolina Mountain Club",
  ]);
  assert.equal(atSections[0].startFraction, 0);
  assert.equal(atSections[1].endFraction, 1);

  const states = ["New Mexico", "Colorado", "Wyoming", "Montana"];
  const cdtSections = buildSourceSections(TRAIL_SOURCES[2], {
    type: "FeatureCollection",
    features: states.map((State, index) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[0, index * 0.01], [0, (index + 1) * 0.01]],
      },
      properties: { Label: "CDT Primary Route", State },
    })),
  } as any);
  assert.deepEqual(cdtSections.map((section) => section.label), [
    "New Mexico", "Colorado", "Wyoming", "Montana & Idaho",
  ]);
});

test("non-adjacent A.T. sections managed by the same club get stable unique ids", () => {
  const officialProperties = {
    Region: "2", Trail_Club: "23", Status: "Official A.T. Route", Publish: "Yes",
  };
  const sections = buildSourceSections(TRAIL_SOURCES[1], {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0], [0, 0.01]] },
        properties: { ...officialProperties, Name: "RATC AT Treadway" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0.01], [0, 0.02]] },
        properties: { ...officialProperties, Name: "OCVT AT Treadway", Trail_Club: "22" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0.02], [0, 0.03]] },
        properties: { ...officialProperties, Name: "RATC AT Treadway" },
      },
    ],
  } as any);

  assert.deepEqual(sections.map((section) => section.id), [
    "at-ratc-at-treadway",
    "at-ocvt-at-treadway",
    "at-ratc-at-treadway-2",
  ]);
});
