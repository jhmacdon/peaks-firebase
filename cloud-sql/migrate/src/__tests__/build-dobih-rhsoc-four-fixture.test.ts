import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDobihRhsocFourFixture } from "../build-dobih-rhsoc-four-fixture";
import { normalizeDobihName } from "../build-dobih-open-eight-fixture";
import {
  DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION,
  DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION,
  DOBIH_RHSOC_FOUR_KEEPER_LISTS,
  DOBIH_RHSOC_FOUR_NAMED_COMPLETION_EXCEPTIONS,
  DOBIH_RHSOC_FOUR_PUBLICATION_READY,
  DOBIH_RHSOC_FOUR_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_RHSOC_FOUR_ROUTE_SAFETY_AUDIT_COMPLETE,
  DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING,
  DOBIH_SIMMS_SELECTION,
  DOBIH_SUBSIMMS_SELECTION,
} from "../keeper-list-import/bundles/dobih-rhsoc-four";
import {
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/data-audits/fixtures/" +
    "keeper-list-dobih-rhsoc-four-candidates-2026-09-01.json"
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as KeeperImportFixture;
const priorFixturePaths = [
  "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json",
  "docs/data-audits/fixtures/keeper-list-dobih-deweys-candidates-2026-09-01.json",
  "docs/data-audits/fixtures/keeper-list-dobih-birketts-synges-candidates-2026-09-01.json",
] as const;
const priorFixtureHashes = [
  "d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d",
  "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae",
  "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
  "730ac1326f97d13f41cb289028c118206feebd0270daecedcba583d5655109ea",
  "7400d0c105e469e4f0791a47bfa870aae5b8b7b18991c4bb4f97b7e95c33f6b5",
] as const;
const priorFixtures = priorFixturePaths.map((relativePath) =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as KeeperImportFixture
);
const migratePackage = JSON.parse(readFileSync(path.join(
  repoRoot,
  "cloud-sql/migrate/package.json"
), "utf8")) as { scripts: Record<string, string> };
const bundleSource = readFileSync(path.join(
  repoRoot,
  "cloud-sql/migrate/src/keeper-list-import/bundles/dobih-rhsoc-four.ts"
), "utf8");
const registry = JSON.parse(readFileSync(path.join(
  repoRoot,
  "docs/data-audits/respectable-peakbagging-denominator-v1.8-2026-09-01.json"
), "utf8")) as Record<string, unknown>;

const expectedLists = [
  {
    sourceKey: "dobih-great-britain-marilyns",
    listId: "28159A46DB14A20C6AAD",
    name: "Great Britain Marilyns",
    count: 1_550,
    selection: "Ma=1 AND Country IN (E,ES,S,W)",
    rosterSha256: "055fe69b5a5ad8dc78445fdbc0051e9c062b813f777983d843a844b9943eddbd",
    allowedCountryCodes: ["GB"],
  },
  {
    sourceKey: "dobih-high-hills-of-britain",
    listId: "07F30062B5F3654C3493",
    name: "High Hills of Britain",
    count: 1_035,
    selection: "HHB=1",
    rosterSha256: "66f5919cddefae958d02337610c0e0218543ebd7cb261a909b98286d004b52e0",
    allowedCountryCodes: ["GB"],
  },
  {
    sourceKey: "dobih-simms",
    listId: "71F41F9E96DDD5D0FF02",
    name: "Simms",
    count: 2_755,
    selection: "Sim=1",
    rosterSha256: "59be2fd9017be3ec6f4284a5e2884f5ad05f77eced5ab53e1b83b1e1139b7a87",
    allowedCountryCodes: ["GB", "IE", "IM"],
  },
  {
    sourceKey: "dobih-subsimms",
    listId: "8C5F5BC5DC2D8F765ACB",
    name: "Subsimms",
    count: 739,
    selection: "sSim=1",
    rosterSha256: "241812f1e490c6521c34dc0bdee310ed3a4eede95a941889d05c793221237c96",
    allowedCountryCodes: ["GB", "IE"],
  },
] as const;

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function allMembers(source: KeeperImportFixture): KeeperSourceMember[] {
  return Object.values(source.lists).flatMap((list) => list.rows);
}

function uniqueMembers(members: KeeperSourceMember[]): KeeperSourceMember[] {
  return [...new Map(members.map((member) => [member.sourceMemberId, member])).values()];
}

function identityWithoutOrdinal(member: KeeperSourceMember): Omit<KeeperSourceMember, "ordinal"> {
  const { ordinal: _ordinal, ...identity } = member;
  return identity;
}

function pairOverlap(leftSourceKey: string, rightSourceKey: string): number {
  const leftIds = new Set(fixture.lists[leftSourceKey].rows.map(
    (member) => member.sourceMemberId
  ));
  return fixture.lists[rightSourceKey].rows.filter(
    (member) => leftIds.has(member.sourceMemberId)
  ).length;
}

test("pins and validates all four exact source rosters with publication off", () => {
  assert.equal(
    sha256(fixtureBytes),
    "cb75b57dc26431565b592f11e7c96f218cda090841fc258628e24f5753347005"
  );
  assert.equal(fixtureBytes.length, 1_499_794);
  assert.equal(fixture.generatedAt, "2026-09-01");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.deepEqual(Object.keys(fixture.lists), expectedLists.map(({ sourceKey }) => sourceKey));
  assert.doesNotThrow(() => validateKeeperFixture(fixture, DOBIH_RHSOC_FOUR_KEEPER_LISTS));
  assert.equal(DOBIH_RHSOC_FOUR_PUBLICATION_READY, false);
  assert.equal(DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION, expectedLists[0].selection);
  assert.equal(DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION, expectedLists[1].selection);
  assert.equal(DOBIH_SIMMS_SELECTION, expectedLists[2].selection);
  assert.equal(DOBIH_SUBSIMMS_SELECTION, expectedLists[3].selection);

  assert.deepEqual(DOBIH_RHSOC_FOUR_KEEPER_LISTS.map((definition) => ({
    sourceKey: definition.sourceKey,
    listId: definition.listId,
    name: definition.name,
    count: definition.expectedCount,
    selection: definition.productionManifest?.selection,
    rosterSha256: definition.productionManifest?.rosterSha256,
    allowedCountryCodes: definition.allowedCountryCodes,
  })), expectedLists);

  for (const { sourceKey, count } of expectedLists) {
    const members = fixture.lists[sourceKey].rows;
    assert.equal(members.length, count);
    assert.equal(new Set(members.map((member) => member.sourceMemberId)).size, count);
    assert.deepEqual(
      members.map((member) => member.ordinal),
      Array.from({ length: count }, (_, index) => index + 1)
    );
  }
});

test("pins the DoBIH source bytes, license, row count, and prior fixtures", () => {
  assert.deepEqual(fixture.sources["dobih-v18.5"], {
    name: "The Database of British and Irish Hills v18.5",
    version: "18.5",
    releasedAt: "2026-07-26",
    url: "https://www.hill-bagging.co.uk/dobih/downloads/",
    downloadUrl: "https://www.hill-bagging.co.uk/dobih-downloads/hillcsv.zip",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    archiveSha256: "0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021",
    csvSha256: "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea",
    identityField: "Number",
  });
  assert.equal(
    (registry.source_change as Record<string, unknown>).source_metadata_sha256,
    "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402"
  );
  assert.equal((registry.source_change as Record<string, unknown>).source_csv_row_count, 21_576);
  assert.deepEqual(
    priorFixturePaths.map((relativePath) =>
      sha256(readFileSync(path.join(repoRoot, relativePath)))),
    priorFixtureHashes
  );
});

test("freezes every union, frequency, pair-overlap, and prior-review count", () => {
  const membersByList = new Map(expectedLists.map(({ sourceKey }) =>
    [sourceKey, fixture.lists[sourceKey].rows]));
  const all = expectedLists.flatMap(({ sourceKey }) => membersByList.get(sourceKey)!);
  const union = uniqueMembers(all);
  assert.equal(all.length, 6_079);
  assert.equal(union.length, 4_306);

  const frequencies = new Map<string, number>();
  for (const member of all) {
    frequencies.set(member.sourceMemberId, (frequencies.get(member.sourceMemberId) ?? 0) + 1);
  }
  assert.deepEqual(
    [1, 2, 3, 4].map((count) =>
      [...frequencies.values()].filter((value) => value === count).length),
    [2_875, 1_089, 342, 0]
  );

  assert.deepEqual([
    pairOverlap("dobih-great-britain-marilyns", "dobih-high-hills-of-britain"),
    pairOverlap("dobih-great-britain-marilyns", "dobih-simms"),
    pairOverlap("dobih-great-britain-marilyns", "dobih-subsimms"),
    pairOverlap("dobih-high-hills-of-britain", "dobih-simms"),
    pairOverlap("dobih-high-hills-of-britain", "dobih-subsimms"),
    pairOverlap("dobih-simms", "dobih-subsimms"),
  ], [342, 767, 0, 828, 178, 0]);

  const priorIds = new Set(priorFixtures.flatMap(allMembers).map(
    (member) => member.sourceMemberId
  ));
  assert.deepEqual(expectedLists.map(({ sourceKey }) =>
    fixture.lists[sourceKey].rows.filter(
      (member) => priorIds.has(member.sourceMemberId)
    ).length), [667, 401, 1_313, 131]);
  assert.equal(union.filter((member) => priorIds.has(member.sourceMemberId)).length, 1_552);
  assert.equal(union.filter((member) => !priorIds.has(member.sourceMemberId)).length, 2_754);

  const identityById = new Map<string, Omit<KeeperSourceMember, "ordinal">>();
  for (const member of all) {
    const identity = identityWithoutOrdinal(member);
    const prior = identityById.get(member.sourceMemberId);
    if (prior == null) identityById.set(member.sourceMemberId, identity);
    else assert.deepEqual(identity, prior, member.sourceMemberId);
  }
});

test("pins alias and repeated-name risks without any exact coordinate collision", () => {
  const union = uniqueMembers(allMembers(fixture));
  assert.equal(union.filter((member) => (member.aliases?.length ?? 0) > 0).length, 290);

  const primaryNameGroups = new Map<string, KeeperSourceMember[]>();
  const coordinateGroups = new Map<string, KeeperSourceMember[]>();
  for (const member of union) {
    const nameKey = member.name.toLocaleLowerCase("en");
    primaryNameGroups.set(nameKey, [...(primaryNameGroups.get(nameKey) ?? []), member]);
    const coordinateKey = `${member.lat},${member.lng}`;
    coordinateGroups.set(
      coordinateKey,
      [...(coordinateGroups.get(coordinateKey) ?? []), member]
    );
  }
  const repeatedNameGroups = [...primaryNameGroups.values()].filter(
    (members) => members.length > 1
  );
  assert.equal(repeatedNameGroups.length, 227);
  assert.equal(repeatedNameGroups.reduce((sum, members) => sum + members.length, 0), 722);
  assert.equal([...coordinateGroups.values()].filter((members) => members.length > 1).length, 0);
  assert.deepEqual(
    primaryNameGroups.get("beinn bhreac")?.map((member) => member.sourceMemberId).sort(),
    [
      "dobih:1077", "dobih:1234", "dobih:1272", "dobih:1348", "dobih:1385",
      "dobih:1456", "dobih:1458", "dobih:1477", "dobih:1584", "dobih:2985",
      "dobih:3136", "dobih:3903", "dobih:3963", "dobih:3983", "dobih:4022",
      "dobih:414", "dobih:4318", "dobih:4381", "dobih:4539", "dobih:4545",
      "dobih:5705", "dobih:5734", "dobih:587", "dobih:6275", "dobih:98",
    ].sort()
  );
});

test("pins the two reviewed source-name corrections and rejects drift", () => {
  const foinavenIdentity = {
    sourceMemberId: "dobih:1124",
    name: "Foinaven - Ganu Mor",
    elevationM: 911.05,
    lat: 58.41206,
    lng: -4.885699,
    dobihNumber: 1124,
    aliases: ["Foinne Bhein"],
  };
  assert.deepEqual(expectedLists.slice(0, 3).map(({ sourceKey }) =>
    fixture.lists[sourceKey].rows.find((member) => member.sourceMemberId === "dobih:1124")), [
    { ...foinavenIdentity, ordinal: 639 },
    { ...foinavenIdentity, ordinal: 644 },
    { ...foinavenIdentity, ordinal: 788 },
  ]);
  assert.deepEqual(
    fixture.lists["dobih-simms"].rows.find(
      (member) => member.sourceMemberId === "dobih:20085"
    ),
    {
      sourceMemberId: "dobih:20085",
      ordinal: 2_612,
      name: "Meenteog",
      elevationM: 715,
      lat: 51.979787,
      lng: -9.983003,
      dobihNumber: 20085,
      aliases: ["Moing an tSamhaidh"],
    }
  );
  assert.deepEqual(
    normalizeDobihName(1_124, "Foinaven [Foinne Bhein] - Ganu Mor"),
    { name: "Foinaven - Ganu Mor", aliases: ["Foinne Bhein"] }
  );
  assert.throws(
    () => normalizeDobihName(1_124, "Foinaven - Ganu Mor"),
    /Number 1124 Name changed/
  );
  assert.throws(
    () => normalizeDobihName(20_085, "Meenteog [Moing an tSamhaidh]"),
    /Number 20085 Name changed/
  );
});

test("pins the initial route blocks without treating them as a complete safety audit", () => {
  const expectedBlocks = [
    {
      sourceMemberId: "dobih:79",
      name: "The Cobbler",
      reason: "exposed_summit_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 61 },
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 34 },
        { sourceKey: "dobih-simms", ordinal: 57 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml",
    },
    {
      sourceMemberId: "dobih:1212",
      name: "Stac Pollaidh",
      reason: "expert_summit_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 710 },
        { sourceKey: "dobih-simms", ordinal: 825 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/ullapool/stacpollaidh.shtml",
    },
    {
      sourceMemberId: "dobih:1240",
      name: "Sgurr Dearg - Inaccessible Pinnacle",
      reason: "rock_climb_and_abseil_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 734 },
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 655 },
        { sourceKey: "dobih-simms", ordinal: 830 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/munros/inaccessible-pinnacle",
    },
    {
      sourceMemberId: "dobih:1260",
      name: "Bhasteir Tooth",
      reason: "technical_climbing_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 673 },
        { sourceKey: "dobih-subsimms", ordinal: 82 },
      ],
      referenceUrl: "https://www.thebmc.co.uk/en/how-to-scramble-the-cuillin-ridge",
    },
    {
      sourceMemberId: "dobih:1639",
      name: "Stac an Armin",
      reason: "restricted_sea_stack_access",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_068 },
      ],
      referenceUrl:
        "https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf",
    },
    {
      sourceMemberId: "dobih:1641",
      name: "Stac Lee",
      reason: "restricted_sea_stack_access",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_070 },
      ],
      referenceUrl:
        "https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf",
    },
    {
      sourceMemberId: "dobih:2711",
      name: "Mickle Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_434 },
        { sourceKey: "dobih-simms", ordinal: 1_340 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2713",
      name: "Little Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-simms", ordinal: 1_342 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2735",
      name: "Murton Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-simms", ordinal: 1_356 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2877",
      name: "High Willhays",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_510 },
        { sourceKey: "dobih-simms", ordinal: 1_399 },
      ],
      referenceUrl:
        "https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access",
    },
    {
      sourceMemberId: "dobih:2952",
      name: "The Cobbler South Peak",
      reason: "rock_climb_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 767 },
        { sourceKey: "dobih-subsimms", ordinal: 168 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml",
    },
    {
      sourceMemberId: "dobih:7888",
      name: "Sgurr nan Gillean Third Pinnacle",
      reason: "rock_climb_and_abseil_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 1_010 },
        { sourceKey: "dobih-subsimms", ordinal: 610 },
      ],
      referenceUrl:
        "https://www.ukhillwalking.com/gear/competitions/" +
        "who_won_the_race_along_the_cuillin_ridge-4738",
    },
    {
      sourceMemberId: "dobih:19843",
      name: "Douglas Boulder",
      reason: "rock_climb_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 1_035 },
      ],
      referenceUrl: "https://rockfax.digital/crag/ben-nevis-1434",
    },
    {
      sourceMemberId: "dobih:21237",
      name: "Hag's Tooth",
      reason: "exposed_grade_2_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-subsimms", ordinal: 735 },
      ],
      referenceUrl: "https://kerryclimbing.ie/activities/scrambling/",
    },
  ];
  assert.deepEqual(DOBIH_RHSOC_FOUR_ROUTE_PUBLICATION_BLOCKS, expectedBlocks);
  assert.equal(DOBIH_RHSOC_FOUR_ROUTE_SAFETY_AUDIT_COMPLETE, false);
  assert.equal(
    DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING,
    "This initial block set is non-exhaustive. Absence from it never means a source " +
      "member or proposed route is safe; every route requires separate safety and access review."
  );
  assert.deepEqual(DOBIH_RHSOC_FOUR_NAMED_COMPLETION_EXCEPTIONS, []);

  for (const block of expectedBlocks) {
    const actualOccurrences = expectedLists.flatMap(({ sourceKey }) => {
      const member = fixture.lists[sourceKey].rows.find(
        (candidate) => candidate.sourceMemberId === block.sourceMemberId
      );
      if (member == null) return [];
      assert.equal(member.name, block.name, block.sourceMemberId);
      return [{ sourceKey, ordinal: member.ordinal }];
    });
    assert.deepEqual(actualOccurrences, block.sourceOccurrences, block.sourceMemberId);
    assert.match(block.referenceUrl, /^https:\/\//);
  }

  const fixtureIds = new Set(allMembers(fixture).map((member) => member.sourceMemberId));
  assert.equal(fixtureIds.has("dobih:2390"), false);
  assert.equal(fixtureIds.has("dobih:2630"), false);
  assert.doesNotMatch(bundleSource, /claimAcceptedWithoutSummit|completionTarget|completion_target/);
});

test("adds only a source-fixture command and no importer or apply path", () => {
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:dobih-rhsoc-four"],
    "tsx src/build-dobih-rhsoc-four-fixture.ts"
  );
  assert.deepEqual(
    Object.keys(migratePackage.scripts).filter((name) =>
      /(?:import|apply|resolution).*rhsoc|rhsoc.*(?:import|apply|resolution)/i.test(name)
    ),
    []
  );
  for (const relativePath of [
    "cloud-sql/migrate/src/import-dobih-rhsoc-four.ts",
    "cloud-sql/migrate/src/import-rhsoc-four.ts",
    "cloud-sql/migrate/src/apply-dobih-rhsoc-four.ts",
    "cloud-sql/migrate/src/build-dobih-rhsoc-four-resolutions.ts",
  ]) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), false, relativePath);
  }
  for (const relativePath of [
    "cloud-sql/migrate/src/import-keeper-lists.ts",
    "cloud-sql/migrate/src/import-dobih-open-eight-lists.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(path.join(repoRoot, relativePath), "utf8"),
      /dobih-(?:great-britain-marilyns|high-hills-of-britain|simms|subsimms)/
    );
  }
});

test("pins the v1.8 readiness amendment without claiming production coverage", () => {
  const amendment = registry as {
    base_registry: Record<string, unknown>;
    stack_base: Record<string, unknown>;
    source_change: Record<string, unknown>;
    coverage: Record<string, unknown>;
    new_ready_units: Array<Record<string, unknown>>;
    source_work: Record<string, unknown>;
    before_production: string[];
    cost: Record<string, unknown>;
  };
  assert.deepEqual(amendment.base_registry, {
    version: "2026-09-01-primary-source-lower-bound-7",
    json_path: "docs/data-audits/respectable-peakbagging-denominator-v1.7-2026-09-01.json",
    json_sha256: "7d904693f8b67356bcd256827de30b58ab4352093a46d80e081c63cfbc72c233",
    markdown_sha256: "07b62e886d03385dc0487c31b76567a0cc498dff267310dfcf78d74e5e22988f",
  });
  assert.deepEqual(amendment.stack_base, {
    pull_request: 196,
    url: "https://github.com/jhmacdon/peaks-firebase/pull/196",
    head_commit: "c1e800ebd5091d9d0d245b7e57e008033bbc8abe",
    status: "ready_for_review_not_merged",
  });
  assert.equal(amendment.source_change.fixture_sha256, sha256(fixtureBytes));
  assert.equal(amendment.source_change.publication_ready, false);
  assert.equal(amendment.source_change.production_write_performed, false);
  assert.deepEqual(amendment.coverage, {
    confirmed_lower_bound_denominator: 83,
    current_exact_count: 22,
    prior_ready_exact_count: 23,
    new_ready_exact_count: 4,
    ready_exact_count: 27,
    current_plus_ready_exact_count: 49,
    current_plus_ready_exact_percent_of_lower_bound: 59.0361,
    majority_threshold_for_83: 42,
    additional_ready_units_needed_for_registry_majority: 0,
    ready_stack_reaches_registry_majority: true,
    production_reaches_registry_majority: false,
    worldwide_majority_claim_supported: false,
    coverage_claim_supported: false,
    scope_warning:
      "The 49 of 83 result is a ready review stack against one dated lower-bound " +
      "registry. It is not merged or imported, and it does not prove a worldwide majority.",
  });
  assert.deepEqual(amendment.new_ready_units, expectedLists.map((list, index) => ({
    denominator_registry_id: [
      "great-britain-marilyns", "high-hills-of-britain", "simms", "subsimms",
    ][index],
    source_key: list.sourceKey,
    list_id: list.listId,
    name: list.name,
    count: list.count,
    selection: list.selection,
    roster_sha256: list.rosterSha256,
    base_state: "not_imported_open",
    ready_state: "ready_exact_open_roster_not_merged",
  })));
  assert.deepEqual(amendment.source_work, {
    membership_count: 6_079,
    unique_identity_count: 4_306,
    membership_frequency: {
      one_list: 2_875,
      two_lists: 1_089,
      three_lists: 342,
      four_lists: 0,
    },
    pairwise_overlap: {
      great_britain_marilyns__high_hills_of_britain: 342,
      great_britain_marilyns__simms: 767,
      great_britain_marilyns__subsimms: 0,
      high_hills_of_britain__simms: 828,
      high_hills_of_britain__subsimms: 178,
      simms__subsimms: 0,
    },
    prior_reviewed_identity_count: 1_552,
    new_identity_review_count: 2_754,
    prior_reviewed_membership_by_list: {
      great_britain_marilyns: 667,
      high_hills_of_britain: 401,
      simms: 1_313,
      subsimms: 131,
    },
    country_split: { E: 430, ES: 2, I: 262, M: 1, S: 5_013, W: 371 },
    alias_bearing_identity_count: 290,
    duplicate_primary_name_group_count: 227,
    duplicate_primary_name_row_count: 722,
    exact_coordinate_duplicate_group_count: 0,
    route_safety_audit_complete: false,
    route_publication_block_set_non_exhaustive: true,
    route_safety_warning: DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING,
    route_publication_blocks: [
      "dobih:79", "dobih:1212", "dobih:1240", "dobih:1260", "dobih:1639",
      "dobih:1641", "dobih:2711", "dobih:2713", "dobih:2735", "dobih:2877",
      "dobih:2952", "dobih:7888", "dobih:19843", "dobih:21237",
    ],
    named_completion_exceptions: [],
  });
  assert.ok(amendment.before_production.includes(
    "Keep dobih:2711, dobih:2713, dobih:2735, and dobih:2877 blocked from " +
      "summit-route publication while their firing-range restrictions apply."
  ));
  assert.ok(amendment.before_production.includes(
    "Keep all 14 initial route-publication blocks enforced; this set is non-exhaustive, " +
      "and absence from it never means safe."
  ));
  assert.ok(amendment.before_production.includes(
    "Complete a separate safety and access audit for every proposed route before publication."
  ));
  assert.deepEqual(amendment.cost, {
    infrastructure_change: false,
    estimated_monthly_usd: 0,
  });
});

test("rejects changed roster, selector, and unpinned CSV bytes", () => {
  const wrongSelector = structuredClone(fixture);
  wrongSelector.lists["dobih-great-britain-marilyns"].selection = "Ma=0";
  assert.throws(
    () => validateKeeperFixture(wrongSelector, DOBIH_RHSOC_FOUR_KEEPER_LISTS),
    /selection/
  );

  const changedRoster = structuredClone(fixture);
  changedRoster.lists["dobih-subsimms"].rows.reverse();
  assert.throws(
    () => validateKeeperFixture(changedRoster, DOBIH_RHSOC_FOUR_KEEPER_LISTS),
    /ordinals|checksum/
  );

  assert.throws(
    () => buildDobihRhsocFourFixture(
      Buffer.from("not the pinned DoBIH CSV"),
      fixture.sources["dobih-v18.5"]
    ),
    /CSV checksum .* does not match/
  );
});
