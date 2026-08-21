import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListPlan,
  buildListUpsertParams,
  CatalogPeak,
  CURATED_LISTS,
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
  yearEstablished: 1999,
  organization: "Test Club",
  sourceName: "Peakbagger",
  sourceUrl: "https://www.peakbagger.com/list.aspx?lid=42",
  region: "Test Region",
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

test("re-importing an unchanged list produces an empty membership diff", () => {
  const members = resolveListMembers(list, source, catalog);
  const current = members.map((member) => ({
    listId: list.listId,
    destinationId: member.destinationId,
    ordinal: member.ordinal,
  }));
  const plan = buildListPlan(list, members, current);
  assert.deepEqual(plan.addedDestinationIds, []);
  assert.deepEqual(plan.removedDestinationIds, []);
  assert.deepEqual(plan.reorderedDestinationIds, []);
});

test("the list upsert plan carries all five metadata columns", () => {
  const params = buildListUpsertParams(list);
  assert.deepEqual(params, {
    listId: list.listId,
    name: list.name,
    description: list.description,
    yearEstablished: list.yearEstablished,
    organization: list.organization,
    sourceName: list.sourceName,
    sourceUrl: list.sourceUrl,
    region: list.region,
  });
});

test("the list upsert plan passes a null organization through as SQL NULL, not the string 'null'", () => {
  const noOrgList: CuratedList = { ...list, organization: null };
  const params = buildListUpsertParams(noOrgList);
  assert.equal(params.organization, null);
  assert.notEqual(params.organization, "null");
});

test("curated list descriptions are pure prose: no trailing Source: clause, no raw URL", () => {
  for (const curated of CURATED_LISTS) {
    assert.doesNotMatch(
      curated.description,
      /Source:/i,
      `${curated.name} description still carries a "Source:" clause`
    );
    assert.doesNotMatch(
      curated.description,
      /https?:\/\//,
      `${curated.name} description still carries a raw URL`
    );
  }
});

test("elevation-cut curated lists have a null organization, never the string 'null'", () => {
  const colorado14ers = CURATED_LISTS.find((entry) => entry.listId === "LAZcIKjluO0oT3o9g6MC");
  const tennessee4500 = CURATED_LISTS.find((entry) => entry.listId === "3S29a3viZKKnSMz4wzPQ");
  assert.equal(colorado14ers?.organization, null);
  assert.notEqual(colorado14ers?.organization, "null");
  assert.equal(tennessee4500?.organization, null);
  assert.notEqual(tennessee4500?.organization, "null");

  const cascadeVolcanoes = CURATED_LISTS.find((entry) => entry.listId === "ULCGhLnsWcYYRqXQ3aOo");
  assert.equal(cascadeVolcanoes?.organization, "The Mountaineers");
});

test("the five audited curated lists carry researched metadata verbatim from the audit doc", () => {
  const byId = new Map(CURATED_LISTS.map((entry) => [entry.listId, entry]));
  const metadataOf = (curated: CuratedList | undefined) => ({
    yearEstablished: curated?.yearEstablished,
    organization: curated?.organization,
    sourceName: curated?.sourceName,
    sourceUrl: curated?.sourceUrl,
    region: curated?.region,
    description: curated?.description,
  });

  assert.deepEqual(metadataOf(byId.get("ULCGhLnsWcYYRqXQ3aOo")), {
    yearEstablished: 2010,
    organization: "The Mountaineers",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5044",
    region: "Cascades",
    description:
      "The Mountaineers' Tacoma branch created this peak pin in 2010 for climbers who reach all twenty major Cascade volcanoes. The line runs from Mount Garibaldi in British Columbia south to Lassen Peak in California. Every peak counts toward the pin; there is no partial credit.",
  });

  assert.deepEqual(metadataOf(byId.get("LAZcIKjluO0oT3o9g6MC")), {
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21360",
    region: "Colorado",
    description:
      "Colorado holds fifty-three peaks above 14,000 feet that also rise 300 feet above the saddle linking them to a higher neighbor. Other Colorado summits clear 14,000 feet but fall short of that rise, so lists count them as shoulders rather than mountains of their own. Mount Elbert is the highest of them, and the highest summit in the Rocky Mountains.",
  });

  assert.deepEqual(metadataOf(byId.get("3S29a3viZKKnSMz4wzPQ")), {
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21457",
    region: "Tennessee",
    description:
      "Fifty-five summits in and around Tennessee reach 4,500 feet. Many sit on the crest of the Great Smoky Mountains, where the state line follows the ridge shared with North Carolina. Kuwohi, at 6,643 feet, is the highest of them and the highest point in Tennessee.",
  });

  assert.deepEqual(metadataOf(byId.get("B2867467BB8132CB8D34")), {
    yearEstablished: 1991,
    organization: "Porcella and Burns",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50081",
    region: "California",
    description:
      "Steve Porcella and Cameron Burns counted fifteen California summits above 14,000 feet in their guidebook, first published in 1991. Fourteen rise in the Sierra Nevada; White Mountain Peak stands alone east of the Owens Valley. Mount Whitney is the highest of the fifteen, and of the contiguous United States.",
  });

  assert.deepEqual(metadataOf(byId.get("43142E0739A961123EDC")), {
    yearEstablished: 1955,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50511",
    region: "Sierra Nevada",
    description:
      "The Sierra Club's Angeles Chapter founded the Sierra Peaks Section in 1955 and marked fifteen summits on its peaks list as Emblem Peaks, the ones that dominate their part of the range. A member earns the section emblem by climbing ten of the fifteen plus fifteen more peaks from the full list. Mount Whitney, Mount Williamson, North Palisade, and Mount Ritter are among them.",
  });
});
