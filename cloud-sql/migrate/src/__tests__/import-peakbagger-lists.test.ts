import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListPlan,
  CatalogPeak,
  CuratedList,
  deterministicListId,
  deterministicOsmDestinationId,
  normalizeListPeakName,
  parseArgs,
  resolveListMembers,
  validateSourceList,
} from "../import-peakbagger-lists";

const list: CuratedList = {
  listId: "list-1",
  sourceListId: 42,
  name: "Test Peaks",
  description: "Test",
  expectedCount: 2,
  destinationOverrides: { 102: "destination-2" },
};

const catalog: CatalogPeak[] = [
  {
    id: "destination-1",
    name: "Mount Alpha",
    elevationM: 3_000,
    lat: 40,
    lng: -105,
    osmId: "1",
  },
  {
    id: "destination-2",
    name: "Old Name",
    elevationM: 2_900,
    lat: 40.1,
    lng: -105.1,
    osmId: "2",
  },
];

const source = {
  rows: [
    { ordinal: 1, peakbaggerPeakId: 101, name: "Mount Alpha", elevationFt: 9_842.52 },
    { ordinal: 2, peakbaggerPeakId: 102, name: "New Name", elevationFt: 9_514.44 },
  ],
};

test("parses dry-run and apply modes", () => {
  assert.deepEqual(parseArgs(["--input=/tmp/audit.json"]), {
    input: "/tmp/audit.json",
    apply: false,
  });
  assert.deepEqual(parseArgs(["--apply", "--input=/tmp/audit.json"]), {
    input: "/tmp/audit.json",
    apply: true,
  });
  assert.throws(() => parseArgs([]), /--input is required/);
  assert.throws(() => parseArgs(["--input=x", "--force"]), /Unknown option/);
});

test("uses stable source IDs", () => {
  assert.equal(deterministicListId(50081), deterministicListId(50081));
  assert.equal(deterministicListId(50081).length, 20);
  assert.notEqual(deterministicListId(50081), deterministicListId(50511));
  assert.equal(deterministicOsmDestinationId("356773747").length, 20);
});

test("normalizes punctuation without collapsing words", () => {
  assert.equal(
    normalizeListPeakName("Sugarland Mountain - North Peak"),
    normalizeListPeakName("Sugarland Mountain-North Peak")
  );
  assert.notEqual(normalizeListPeakName("North Peak"), normalizeListPeakName("Northpeak"));
});

test("validates source counts and duplicate peak IDs", () => {
  validateSourceList(list, source);
  assert.throws(
    () => validateSourceList(list, { rows: source.rows.slice(0, 1) }),
    /expected 2/
  );
  assert.throws(
    () => validateSourceList(list, { rows: [source.rows[0], source.rows[0]] }),
    /repeats peak/
  );
});

test("resolves exact names and reviewed overrides", () => {
  assert.deepEqual(resolveListMembers(list, source, catalog), [
    {
      destinationId: "destination-1",
      ordinal: 0,
      sourcePeakId: 101,
      sourceName: "Mount Alpha",
    },
    {
      destinationId: "destination-2",
      ordinal: 1,
      sourcePeakId: 102,
      sourceName: "New Name",
    },
  ]);
});

test("fails closed on missing and ambiguous matches", () => {
  const noOverride = { ...list, destinationOverrides: {} };
  assert.throws(() => resolveListMembers(noOverride, source, catalog), /resolved to 0 destinations/);
  assert.throws(
    () => resolveListMembers(list, source, [...catalog, { ...catalog[0], id: "duplicate" }]),
    /resolved to 2 destinations/
  );
});

test("reports adds, removals, and order changes", () => {
  const members = resolveListMembers(list, source, catalog);
  const plan = buildListPlan(list, members, [
    { listId: "list-1", destinationId: "destination-1", ordinal: 1 },
    { listId: "list-1", destinationId: "old-destination", ordinal: 1 },
  ]);
  assert.deepEqual(plan.addedDestinationIds, ["destination-2"]);
  assert.deepEqual(plan.removedDestinationIds, ["old-destination"]);
  assert.deepEqual(plan.reorderedDestinationIds, ["destination-1"]);
});
