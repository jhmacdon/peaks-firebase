import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TRAIL_SOURCES,
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

test("polyline encoding is stable", () => {
  assert.equal(encodePolyline6([[-120.2, 38.5], [-120.95, 40.7]]), "_izlhA~rlgdF_{geC~ywl@");
});
