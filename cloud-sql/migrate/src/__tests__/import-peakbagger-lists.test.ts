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

// Regression: the Adirondack "Armstrong Mountain" row resolved to a summit in
// Okanogan County, Washington, because the distance rule only ran when a name
// matched more than one destination. A lone candidate went through unchecked.
const armstrongRow = {
  ordinal: 18,
  peakbaggerPeakId: 6069,
  name: "Armstrong Mountain",
  elevationFt: 4_453,
  lat: 44.134913,
  lng: -73.850098,
};

const washingtonArmstrong: CatalogPeak = {
  id: "washington-armstrong",
  name: "Armstrong Mountain",
  elevationM: 1_402,
  lat: 48.26692,
  lng: -119.08587,
  osmId: "356544110",
};

const adirondackArmstrong: CatalogPeak = {
  id: "adirondack-armstrong",
  name: "Armstrong Mountain",
  elevationM: 1_355.3,
  lat: 44.1345216,
  lng: -73.8497765,
  osmId: "357545178",
};

const oneRowList: CuratedList = { ...list, expectedCount: 1, destinationOverrides: {} };

test("a lone name match beyond the distance bound fails instead of matching", () => {
  assert.throws(
    () => resolveListMembers(oneRowList, { rows: [armstrongRow] }, [washingtonArmstrong]),
    /matched no destination within 5 km/
  );
  assert.throws(
    () => resolveListMembers(oneRowList, { rows: [armstrongRow] }, [washingtonArmstrong]),
    /washington-armstrong:Armstrong Mountain 3460\.5 km away/
  );
});

test("the distance bound still admits a lone match inside it", () => {
  assert.deepEqual(
    resolveListMembers(oneRowList, { rows: [armstrongRow] }, [adirondackArmstrong]),
    [{
      destinationId: "adirondack-armstrong",
      ordinal: 0,
      sourcePeakId: 6069,
      sourceName: "Armstrong Mountain",
    }]
  );
});

test("the distance bound picks the near summit over the far same-named one", () => {
  assert.deepEqual(
    resolveListMembers(
      oneRowList,
      { rows: [armstrongRow] },
      [washingtonArmstrong, adirondackArmstrong]
    ).map((member) => member.destinationId),
    ["adirondack-armstrong"]
  );
});

test("a source row without coordinates keeps matching on name and elevation alone", () => {
  const { lat, lng, ...noCoordinates } = armstrongRow;
  assert.deepEqual(
    resolveListMembers(oneRowList, { rows: [noCoordinates] }, [washingtonArmstrong])
      .map((member) => member.destinationId),
    ["washington-armstrong"]
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

// The Idaho 12ers take part of one Peakbagger page rather than a whole list:
// lid 21330 is "Idaho 11,000-foot Peaks", and the 12ers are its ranked rows at
// or above 12,000 feet. A partial list names the rows it takes AND the row
// count the whole page must still have, so a page that gains or loses a row
// fails instead of quietly importing a stale selection.
const partialSource = {
  rows: [
    { ordinal: 1, peakbaggerPeakId: 101, name: "Mount Alpha", elevationFt: 9_842.52 },
    { ordinal: 2, peakbaggerPeakId: 102, name: "Mount Beta", elevationFt: 6_000 },
    { ordinal: 3, peakbaggerPeakId: 103, name: "New Name", elevationFt: 9_514.44 },
  ],
};

const partialList: CuratedList = {
  ...list,
  expectedCount: 2,
  sourcePeakIds: [103, 101],
  sourceRowCount: 3,
  destinationOverrides: { 103: "destination-2" },
};

test("a partial list takes only its named peaks, in page order", () => {
  assert.deepEqual(resolveListMembers(partialList, partialSource, catalog), [
    { destinationId: "destination-1", ordinal: 0, sourcePeakId: 101, sourceName: "Mount Alpha" },
    { destinationId: "destination-2", ordinal: 1, sourcePeakId: 103, sourceName: "New Name" },
  ]);
});

test("a partial list still checks the whole page's row count", () => {
  assert.throws(
    () => resolveListMembers(partialList, { rows: partialSource.rows.slice(0, 2) }, catalog),
    /has 2 rows; expected 3/
  );
});

test("a partial list refuses a selection the page does not carry", () => {
  assert.throws(
    () => validateSourceList({ ...partialList, sourcePeakIds: [101, 999] }, partialSource),
    /missing selected peak 999/
  );
});

test("a partial list refuses a selection that disagrees with expectedCount", () => {
  assert.throws(
    () => validateSourceList({ ...partialList, sourcePeakIds: [101, 102, 103] }, partialSource),
    /selects 3 peaks; expected 2/
  );
});

test("a partial list refuses a repeated selection", () => {
  assert.throws(
    () => validateSourceList({ ...partialList, sourcePeakIds: [101, 101] }, partialSource),
    /repeats selected peak/
  );
});

test("sourcePeakIds and sourceRowCount only count together", () => {
  const { sourceRowCount, ...noRowCount } = partialList;
  assert.throws(
    () => validateSourceList(noRowCount as CuratedList, partialSource),
    /sourcePeakIds and sourceRowCount together/
  );
  const { sourcePeakIds, ...noSelection } = partialList;
  assert.throws(
    () => validateSourceList(noSelection as CuratedList, partialSource),
    /sourcePeakIds and sourceRowCount together/
  );
});

test("the four Western lists carry the metadata their audit-doc sources support", () => {
  const byId = new Map(CURATED_LISTS.map((entry) => [entry.listId, entry]));
  const shape = (curated: CuratedList | undefined) => ({
    name: curated?.name,
    expectedCount: curated?.expectedCount,
    yearEstablished: curated?.yearEstablished,
    organization: curated?.organization,
    region: curated?.region,
    sourceUrl: curated?.sourceUrl,
  });

  assert.deepEqual(shape(byId.get(deterministicListId(5053))), {
    name: "Desert Peaks Section",
    expectedCount: 95,
    yearEstablished: 1941,
    organization: "Sierra Club Angeles Chapter",
    region: "Desert Southwest",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5053",
  });

  // The Ogul list dates from "the early 1980s" and no source gives a year, so
  // the field stays null rather than carrying a guess. Its keeper is the
  // Western States Climbers; the Sierra Club tie ended in 1998.
  assert.deepEqual(shape(byId.get(deterministicListId(5055))), {
    name: "Tahoe Ogul Peaks",
    expectedCount: 63,
    yearEstablished: null,
    organization: "Western States Climbers",
    region: "Lake Tahoe",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5055",
  });

  // Two sponsors, both named: the club's own page says it has always been both.
  assert.deepEqual(shape(byId.get(deterministicListId(5180))), {
    name: "South Beyond 6000",
    expectedCount: 40,
    yearEstablished: 1968,
    organization: "Carolina Mountain Club and Tennessee Eastman Hiking and Canoeing Club",
    region: "Southern Appalachians",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5180",
  });

  assert.deepEqual(shape(byId.get(deterministicListId(21330))), {
    name: "Idaho 12ers",
    expectedCount: 9,
    yearEstablished: null,
    organization: null,
    region: "Idaho",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21330",
  });
});

test("the Idaho 12ers are the only partial list, and their selection is pinned", () => {
  const partial = CURATED_LISTS.filter((entry) => entry.sourcePeakIds != null);
  assert.equal(partial.length, 1);
  const idaho = partial[0];
  assert.equal(idaho.sourceListId, 21330);
  assert.equal(idaho.sourceRowCount, 138);
  assert.deepEqual(idaho.sourcePeakIds, [5142, 5147, 5164, 5150, 5151, 5145, 5154, 5152, 5118]);
  assert.equal(idaho.sourcePeakIds?.length, idaho.expectedCount);
  for (const curated of CURATED_LISTS) {
    assert.equal(
      curated.sourcePeakIds == null,
      curated.sourceRowCount == null,
      `${curated.name} sets one of sourcePeakIds/sourceRowCount without the other`
    );
  }
});
