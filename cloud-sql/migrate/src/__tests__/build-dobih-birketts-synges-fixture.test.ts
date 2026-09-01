import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDobihBirkettsSyngesFixture } from
  "../build-dobih-birketts-synges-fixture";
import {
  DOBIH_BIRKETTS_SELECTION,
  DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS,
  DOBIH_BIRKETTS_SYNGES_PUBLICATION_READY,
  DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_SYNGES_SELECTION,
} from "../keeper-list-import/bundles/dobih-birketts-synges";
import {
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/data-audits/fixtures/" +
    "keeper-list-dobih-birketts-synges-candidates-2026-09-01.json"
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as KeeperImportFixture;
const priorFixturePaths = [
  "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json",
  "docs/data-audits/fixtures/keeper-list-dobih-deweys-candidates-2026-09-01.json",
] as const;
const priorFixtureHashes = [
  "d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d",
  "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae",
  "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
  "730ac1326f97d13f41cb289028c118206feebd0270daecedcba583d5655109ea",
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
  "cloud-sql/migrate/src/keeper-list-import/bundles/dobih-birketts-synges.ts"
), "utf8");
const registry = JSON.parse(readFileSync(path.join(
  repoRoot,
  "docs/data-audits/respectable-peakbagging-denominator-v1.7-2026-09-01.json"
), "utf8")) as Record<string, unknown>;

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

function distanceM(left: KeeperSourceMember, right: KeeperSourceMember): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = toRadians(left.lat!);
  const rightLat = toRadians(right.lat!);
  const deltaLat = rightLat - leftLat;
  const deltaLng = toRadians(right.lng! - left.lng!);
  const value = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

test("pins and validates both exact source rosters with publication off", () => {
  assert.equal(
    sha256(fixtureBytes),
    "7400d0c105e469e4f0791a47bfa870aae5b8b7b18991c4bb4f97b7e95c33f6b5"
  );
  assert.equal(fixture.generatedAt, "2026-09-01");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.deepEqual(Object.keys(fixture.lists), ["dobih-birketts", "dobih-synges"]);
  assert.doesNotThrow(() =>
    validateKeeperFixture(fixture, DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS));
  assert.equal(DOBIH_BIRKETTS_SYNGES_PUBLICATION_READY, false);
  assert.equal(DOBIH_BIRKETTS_SELECTION, "B=1");
  assert.equal(DOBIH_SYNGES_SELECTION, "Sy=1");

  assert.deepEqual(DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS.map((definition) => ({
    sourceKey: definition.sourceKey,
    listId: definition.listId,
    name: definition.name,
    count: definition.expectedCount,
    selection: definition.productionManifest?.selection,
    rosterSha256: definition.productionManifest?.rosterSha256,
    allowedCountryCodes: definition.allowedCountryCodes,
  })), [
    {
      sourceKey: "dobih-birketts",
      listId: "045A11A6033DC6178CD2",
      name: "Birketts",
      count: 541,
      selection: "B=1",
      rosterSha256: "970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7",
      allowedCountryCodes: ["GB"],
    },
    {
      sourceKey: "dobih-synges",
      listId: "C28C4F0D933C73F79AC4",
      name: "Synges",
      count: 670,
      selection: "Sy=1",
      rosterSha256: "8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff",
      allowedCountryCodes: ["GB"],
    },
  ]);

  for (const [sourceKey, count] of [
    ["dobih-birketts", 541],
    ["dobih-synges", 670],
  ] as const) {
    const members = fixture.lists[sourceKey].rows;
    assert.equal(members.length, count);
    assert.equal(new Set(members.map((member) => member.sourceMemberId)).size, count);
    assert.deepEqual(
      members.map((member) => member.ordinal),
      Array.from({ length: count }, (_, index) => index + 1)
    );
  }
});

test("pins the DoBIH artifact, source license, and old fixture bytes", () => {
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
  assert.deepEqual(
    priorFixturePaths.map((relativePath) =>
      sha256(readFileSync(path.join(repoRoot, relativePath)))),
    priorFixtureHashes
  );
});

test("freezes cross-list reuse and prior source-review counts", () => {
  const birketts = fixture.lists["dobih-birketts"].rows;
  const synges = fixture.lists["dobih-synges"].rows;
  const birkettsById = new Map(birketts.map((member) => [member.sourceMemberId, member]));
  const syngesById = new Map(synges.map((member) => [member.sourceMemberId, member]));
  const sharedIds = [...birkettsById.keys()].filter((sourceMemberId) =>
    syngesById.has(sourceMemberId));
  const union = uniqueMembers([...birketts, ...synges]);
  const priorIds = new Set(priorFixtures.flatMap(allMembers).map(
    (member) => member.sourceMemberId
  ));

  assert.equal(birketts.length + synges.length, 1_211);
  assert.equal(union.length, 723);
  assert.equal(sharedIds.length, 488);
  assert.equal(birketts.filter((member) => priorIds.has(member.sourceMemberId)).length, 302);
  assert.equal(synges.filter((member) => priorIds.has(member.sourceMemberId)).length, 322);
  assert.equal(union.filter((member) => priorIds.has(member.sourceMemberId)).length, 323);
  assert.equal(union.filter((member) => !priorIds.has(member.sourceMemberId)).length, 400);

  for (const sourceMemberId of sharedIds) {
    assert.deepEqual(
      identityWithoutOrdinal(birkettsById.get(sourceMemberId)!),
      identityWithoutOrdinal(syngesById.get(sourceMemberId)!),
      sourceMemberId
    );
  }
});

test("pins the repeated names, aliases, and close distinct source identities", () => {
  const union = uniqueMembers(allMembers(fixture));
  const primaryNameGroups = new Map<string, KeeperSourceMember[]>();
  for (const member of union) {
    const key = member.name.toLocaleLowerCase("en");
    const group = primaryNameGroups.get(key) ?? [];
    group.push(member);
    primaryNameGroups.set(key, group);
  }
  const repeatedNameGroups = [...primaryNameGroups.values()].filter(
    (members) => members.length > 1
  );
  assert.equal(union.filter((member) => (member.aliases?.length ?? 0) > 0).length, 79);
  assert.equal(repeatedNameGroups.length, 19);
  assert.equal(repeatedNameGroups.reduce((sum, members) => sum + members.length, 0), 41);
  assert.deepEqual(
    primaryNameGroups.get("raven crag")?.map((member) => member.sourceMemberId).sort(),
    ["dobih:2487", "dobih:7991", "dobih:7992", "dobih:8025"]
  );

  const closePairs: string[] = [];
  for (let leftIndex = 0; leftIndex < union.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < union.length; rightIndex += 1) {
      const left = union[leftIndex];
      const right = union[rightIndex];
      if (distanceM(left, right) <= 150) {
        closePairs.push([left.sourceMemberId, right.sourceMemberId].sort().join("|"));
      }
    }
  }
  assert.deepEqual(closePairs.sort(), [
    "dobih:2607|dobih:3838",
    "dobih:2610|dobih:7833",
    "dobih:2667|dobih:3863",
    "dobih:2777|dobih:3724",
    "dobih:3724|dobih:3725",
    "dobih:3876|dobih:3883",
  ]);
});

test("pins Pillar Rock as the shared named exception and route block", () => {
  assert.deepEqual(DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS, [{
    sourceMemberId: "dobih:2390",
    name: "Pillar Rock",
    reason: "technical_rock_summit",
    routePublicationAllowed: false,
    claimAcceptedWithoutSummit: true,
    sourceKeys: ["dobih-birketts", "dobih-synges"],
    accessUrl: "https://ldwa.org.uk/hillwalkers/register2.php",
  }]);
  const pillarIdentity = {
    sourceMemberId: "dobih:2390",
    name: "Pillar Rock",
    elevationM: 779.9,
    lat: 54.499909,
    lng: -3.280793,
    dobihNumber: 2390,
  };
  assert.deepEqual(
    fixture.lists["dobih-birketts"].rows.find((member) =>
      member.sourceMemberId === "dobih:2390"),
    { ...pillarIdentity, ordinal: 61 }
  );
  assert.deepEqual(
    fixture.lists["dobih-synges"].rows.find((member) =>
      member.sourceMemberId === "dobih:2390"),
    { ...pillarIdentity, ordinal: 65 }
  );

  const memberIds = new Set(allMembers(fixture).map((member) => member.sourceMemberId));
  assert.deepEqual(
    ["dobih:2630", "dobih:2711", "dobih:2713", "dobih:2735", "dobih:2877", "dobih:3649"]
      .filter((sourceMemberId) => memberIds.has(sourceMemberId)),
    []
  );
  assert.doesNotMatch(bundleSource, /completionTarget|completion_target/);
});

test("adds only a source-fixture command and no importer or apply path", () => {
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:dobih-birketts-synges"],
    "tsx src/build-dobih-birketts-synges-fixture.ts"
  );
  assert.deepEqual(
    Object.keys(migratePackage.scripts).filter((name) =>
      /(?:import|apply|resolution).*(?:birketts|synges)|(?:birketts|synges).*(?:import|apply|resolution)/i
        .test(name)
    ),
    []
  );
  for (const relativePath of [
    "cloud-sql/migrate/src/import-dobih-birketts-synges.ts",
    "cloud-sql/migrate/src/import-birketts-synges.ts",
    "cloud-sql/migrate/src/apply-dobih-birketts-synges.ts",
    "cloud-sql/migrate/src/build-dobih-birketts-synges-resolutions.ts",
  ]) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), false, relativePath);
  }
  for (const relativePath of [
    "cloud-sql/migrate/src/import-keeper-lists.ts",
    "cloud-sql/migrate/src/import-dobih-open-eight-lists.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(path.join(repoRoot, relativePath), "utf8"),
      /dobih-(?:birketts|synges)/
    );
  }
});

test("pins the v1.7 readiness amendment without claiming production coverage", () => {
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
    version: "2026-09-01-primary-source-lower-bound-6",
    json_path: "docs/data-audits/respectable-peakbagging-denominator-v1.6-2026-09-01.json",
    json_sha256: "832bb68a1641240783173ff76fa165f59ef6f4e83f1e066092ea3d682291fbeb",
    markdown_sha256: "385515e7eac8d287b231d8adf73492ea88c15112366f9020cdb4eda177cec2fc",
  });
  assert.deepEqual(amendment.stack_base, {
    pull_request: 194,
    url: "https://github.com/jhmacdon/peaks-firebase/pull/194",
    head_commit: "02a960fe880d1170e41a851c4b31e94b6c0ddd02",
    status: "ready_for_review_not_merged",
  });
  assert.equal(amendment.source_change.fixture_sha256, sha256(fixtureBytes));
  assert.equal(amendment.source_change.publication_ready, false);
  assert.equal(amendment.source_change.production_write_performed, false);
  assert.deepEqual(amendment.coverage, {
    confirmed_lower_bound_denominator: 83,
    current_exact_count: 22,
    prior_ready_exact_count: 21,
    new_ready_exact_count: 2,
    ready_exact_count: 23,
    current_plus_ready_exact_count: 45,
    current_plus_ready_exact_percent_of_lower_bound: 54.2169,
    majority_threshold_for_83: 42,
    additional_ready_units_needed_for_registry_majority: 0,
    ready_stack_reaches_registry_majority: true,
    production_reaches_registry_majority: false,
    worldwide_majority_claim_supported: false,
    coverage_claim_supported: false,
    scope_warning:
      "The 45 of 83 result is a ready review stack against one dated lower-bound " +
      "registry. It is not merged or imported, and it does not prove a worldwide majority.",
  });
  assert.deepEqual(amendment.new_ready_units, [
    {
      denominator_registry_id: "birketts",
      source_key: "dobih-birketts",
      list_id: "045A11A6033DC6178CD2",
      name: "Birketts",
      count: 541,
      selection: "B=1",
      roster_sha256: "970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7",
      base_state: "not_imported_open",
      ready_state: "ready_exact_open_roster_not_merged",
    },
    {
      denominator_registry_id: "synges",
      source_key: "dobih-synges",
      list_id: "C28C4F0D933C73F79AC4",
      name: "Synges",
      count: 670,
      selection: "Sy=1",
      roster_sha256: "8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff",
      base_state: "not_imported_open",
      ready_state: "ready_exact_open_roster_not_merged",
    },
  ]);
  assert.deepEqual(amendment.source_work, {
    membership_count: 1_211,
    unique_identity_count: 723,
    shared_identity_count: 488,
    prior_reviewed_identity_count: 323,
    new_identity_review_count: 400,
    country_split: { E: 1_211 },
    alias_bearing_identity_count: 79,
    duplicate_primary_name_group_count: 19,
    duplicate_primary_name_row_count: 41,
    distinct_source_pair_count_within_150m: 6,
    route_publication_blocks: ["dobih:2390"],
    named_completion_exceptions: ["dobih:2390"],
  });
  assert.ok(amendment.before_production.includes(
    "Keep dobih:2390 blocked from summit-route publication in both lists."
  ));
  assert.ok(amendment.before_production.includes(
    "Model the named Pillar Rock completion exception; do not replace it with a numeric " +
      "any-member omission."
  ));
  assert.deepEqual(amendment.cost, {
    infrastructure_change: false,
    estimated_monthly_usd: 0,
  });
});

test("rejects changed roster, selector, and unpinned CSV bytes", () => {
  const wrongSelector = structuredClone(fixture);
  wrongSelector.lists["dobih-birketts"].selection = "B=0";
  assert.throws(
    () => validateKeeperFixture(wrongSelector, DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS),
    /selection/
  );

  const changedRoster = structuredClone(fixture);
  changedRoster.lists["dobih-synges"].rows.reverse();
  assert.throws(
    () => validateKeeperFixture(changedRoster, DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS),
    /ordinals|checksum/
  );

  assert.throws(
    () => buildDobihBirkettsSyngesFixture(
      Buffer.from("not the pinned DoBIH CSV"),
      fixture.sources["dobih-v18.5"]
    ),
    /CSV checksum .* does not match/
  );
});
