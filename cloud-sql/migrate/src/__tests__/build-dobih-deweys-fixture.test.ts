import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDobihDeweysFixture } from "../build-dobih-deweys-fixture";
import {
  DOBIH_DEWEYS_COUNTRY_COUNTS,
  DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS,
  DOBIH_DEWEYS_KEEPER_LISTS,
  DOBIH_DEWEYS_PUBLICATION_READY,
  DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_DEWEYS_SELECTION,
} from "../keeper-list-import/bundles/dobih-deweys";
import {
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/data-audits/fixtures/keeper-list-dobih-deweys-candidates-2026-09-01.json"
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as KeeperImportFixture;
const priorFixturePaths = [
  "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json",
  "docs/data-audits/fixtures/keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json",
] as const;
const priorFixtures = priorFixturePaths.map((relativePath) =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as KeeperImportFixture
);
const migratePackage = JSON.parse(readFileSync(path.join(
  repoRoot,
  "cloud-sql/migrate/package.json"
), "utf8")) as { scripts: Record<string, string> };
const registry = JSON.parse(readFileSync(path.join(
  repoRoot,
  "docs/data-audits/respectable-peakbagging-denominator-v1.6-2026-09-01.json"
), "utf8")) as Record<string, unknown>;

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function allMembers(source: KeeperImportFixture): KeeperSourceMember[] {
  return Object.values(source.lists).flatMap((list) => list.rows);
}

test("pins and validates the 425-member Deweys source roster with publication off", () => {
  assert.equal(
    sha256(fixtureBytes),
    "730ac1326f97d13f41cb289028c118206feebd0270daecedcba583d5655109ea"
  );
  assert.equal(fixture.generatedAt, "2026-09-01");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.deepEqual(Object.keys(fixture.lists), ["dobih-deweys"]);
  assert.doesNotThrow(() => validateKeeperFixture(fixture, DOBIH_DEWEYS_KEEPER_LISTS));
  assert.equal(DOBIH_DEWEYS_PUBLICATION_READY, false);
  assert.equal(DOBIH_DEWEYS_SELECTION, "Dew=1");

  assert.deepEqual(DOBIH_DEWEYS_KEEPER_LISTS.map((definition) => ({
    sourceKey: definition.sourceKey,
    listId: definition.listId,
    name: definition.name,
    count: definition.expectedCount,
    selection: definition.productionManifest?.selection,
    rosterSha256: definition.productionManifest?.rosterSha256,
    allowedCountryCodes: definition.allowedCountryCodes,
  })), [{
    sourceKey: "dobih-deweys",
    listId: "75B4485F6944A4BB43F5",
    name: "Deweys",
    count: 425,
    selection: "Dew=1",
    rosterSha256: "f0aa896b51d6a7f1ae3ec50a774c0c2b17a63288b7f74d5d54de1af143c4fd4a",
    allowedCountryCodes: ["GB", "IM"],
  }]);

  const members = fixture.lists["dobih-deweys"].rows;
  assert.equal(members.length, 425);
  assert.equal(new Set(members.map((member) => member.sourceMemberId)).size, 425);
  assert.deepEqual(
    members.map((member) => member.ordinal),
    Array.from({ length: 425 }, (_, index) => index + 1)
  );
});

test("pins the DoBIH v18.5 artifact and CC BY 4.0 attribution", () => {
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
});

test("freezes 52 reviewed overlaps and 373 new source identities", () => {
  const members = fixture.lists["dobih-deweys"].rows;
  const priorIds = new Set(priorFixtures.flatMap(allMembers).map(
    (member) => member.sourceMemberId
  ));
  assert.equal(members.filter((member) => priorIds.has(member.sourceMemberId)).length, 52);
  assert.equal(members.filter((member) => !priorIds.has(member.sourceMemberId)).length, 373);
});

test("pins the country split and all five Isle of Man source members", () => {
  assert.deepEqual(DOBIH_DEWEYS_COUNTRY_COUNTS, {
    E: 174,
    ES: 6,
    M: 5,
    W: 240,
  });
  assert.deepEqual(DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS, [1946, 3337, 3338, 3339, 3340]);

  const isleOfManNumbers = new Set<number>(DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS);
  assert.deepEqual(
    fixture.lists["dobih-deweys"].rows
      .filter((member) => isleOfManNumbers.has(member.dobihNumber!))
      .map(({ sourceMemberId, ordinal, name, aliases }) => ({
        sourceMemberId,
        ordinal,
        name,
        aliases: aliases ?? [],
      })),
    [
      { sourceMemberId: "dobih:1946", ordinal: 1, name: "North Barrule", aliases: [] },
      { sourceMemberId: "dobih:3337", ordinal: 114, name: "Clagh Ouyr", aliases: [] },
      {
        sourceMemberId: "dobih:3338",
        ordinal: 115,
        name: "Beinn Rein",
        aliases: ["Clagh Ouyr North Top"],
      },
      { sourceMemberId: "dobih:3339", ordinal: 116, name: "Beinn-y-Phott", aliases: [] },
      { sourceMemberId: "dobih:3340", ordinal: 117, name: "Carraghan", aliases: [] },
    ]
  );
});

test("keeps all older source fixture bytes unchanged", () => {
  const expectedHashes = [
    "d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d",
    "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae",
    "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
  ];
  assert.deepEqual(
    priorFixturePaths.map((relativePath) => sha256(readFileSync(path.join(repoRoot, relativePath)))),
    expectedHashes
  );
});

test("has no Deweys import, apply, resolution, or production path", () => {
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:dobih-deweys"],
    "tsx src/build-dobih-deweys-fixture.ts"
  );
  assert.deepEqual(
    Object.keys(migratePackage.scripts).filter((name) =>
      /(?:import|apply).*deweys|deweys.*(?:import|apply)/i.test(name)
    ),
    []
  );
  for (const relativePath of [
    "cloud-sql/migrate/src/import-dobih-deweys.ts",
    "cloud-sql/migrate/src/import-deweys.ts",
    "cloud-sql/migrate/src/apply-dobih-deweys.ts",
    "cloud-sql/migrate/src/build-dobih-deweys-resolutions.ts",
  ]) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), false, relativePath);
  }
  for (const relativePath of [
    "cloud-sql/migrate/src/import-keeper-lists.ts",
    "cloud-sql/migrate/src/import-dobih-open-eight-lists.ts",
  ]) {
    assert.doesNotMatch(readFileSync(path.join(repoRoot, relativePath), "utf8"), /dobih-deweys/);
  }
});

test("blocks Great Links Tor and excludes the older access-blocked members", () => {
  const members = fixture.lists["dobih-deweys"].rows;
  const memberIds = new Set(members.map((member) => member.sourceMemberId));
  assert.deepEqual(
    ["dobih:2711", "dobih:2713", "dobih:2735", "dobih:2877"]
      .filter((sourceMemberId) => memberIds.has(sourceMemberId)),
    []
  );
  assert.equal(members.some((member) =>
    /high knott|williamson's monument/i.test(
      [member.name, ...(member.aliases ?? [])].join(" ")
    )), false);
  assert.deepEqual(
    DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS,
    [{
      sourceMemberId: "dobih:3649",
      name: "Great Links Tor",
      reason: "technical_rock_summit",
      routePublicationAllowed: false,
      accessUrl: "https://ldwa.org.uk/hillwalkers/register5.php",
    }]
  );
  assert.deepEqual(
    members.find((member) => member.sourceMemberId === "dobih:3649"),
    {
      sourceMemberId: "dobih:3649",
      ordinal: 408,
      name: "Great Links Tor",
      elevationM: 589,
      lat: 50.662431,
      lng: -4.051835,
      dobihNumber: 3649,
    }
  );
});

test("pins the v1.6 readiness amendment without claiming production coverage", () => {
  const amendment = registry as {
    base_registry: Record<string, unknown>;
    stack_base: Record<string, unknown>;
    source_change: Record<string, unknown>;
    coverage: Record<string, unknown>;
    new_ready_units: Array<Record<string, unknown>>;
    source_work: Record<string, unknown>;
    cost: Record<string, unknown>;
  };
  assert.deepEqual(amendment.base_registry, {
    version: "2026-08-31-primary-source-lower-bound-5",
    json_path: "docs/data-audits/respectable-peakbagging-denominator-v1.5-2026-08-31.json",
    json_sha256: "7272964cad7edbe1649bba2b14b3cc0af74bc266eabb7a506e365e2e48ac3030",
    markdown_sha256: "d549c73e529ac253c95f0924aed2f8ae4145afde188959bea3eb1c13504dd2d9",
  });
  assert.deepEqual(amendment.stack_base, {
    pull_request: 192,
    url: "https://github.com/jhmacdon/peaks-firebase/pull/192",
    head_commit: "5ef776bb209be7c9bfa1109093ab09076345b433",
    status: "ready_for_review_not_merged",
  });
  assert.equal(amendment.source_change.fixture_sha256, sha256(fixtureBytes));
  assert.equal(amendment.source_change.publication_ready, false);
  assert.equal(amendment.source_change.production_write_performed, false);
  assert.deepEqual(amendment.coverage, {
    confirmed_lower_bound_denominator: 83,
    current_exact_count: 22,
    prior_ready_exact_count: 20,
    new_ready_exact_count: 1,
    ready_exact_count: 21,
    current_plus_ready_exact_count: 43,
    current_plus_ready_exact_percent_of_lower_bound: 51.8072,
    majority_threshold_for_83: 42,
    additional_ready_units_needed_for_registry_majority: 0,
    ready_stack_reaches_registry_majority: true,
    production_reaches_registry_majority: false,
    worldwide_majority_claim_supported: false,
    coverage_claim_supported: false,
    scope_warning:
      "The 43 of 83 result is a ready review stack against one dated lower-bound " +
      "registry. It is not merged or imported, and it does not prove a worldwide majority.",
  });
  assert.deepEqual(amendment.new_ready_units, [{
    denominator_registry_id: "deweys",
    source_key: "dobih-deweys",
    list_id: "75B4485F6944A4BB43F5",
    name: "Deweys",
    count: 425,
    selection: "Dew=1",
    roster_sha256: "f0aa896b51d6a7f1ae3ec50a774c0c2b17a63288b7f74d5d54de1af143c4fd4a",
    base_state: "not_imported_open",
    ready_state: "ready_exact_open_roster_not_merged",
  }]);
  assert.deepEqual(amendment.source_work, {
    membership_count: 425,
    unique_identity_count: 425,
    prior_reviewed_identity_count: 52,
    new_identity_review_count: 373,
    country_split: { W: 240, E: 174, ES: 6, M: 5 },
    isle_of_man_source_numbers: [1946, 3337, 3338, 3339, 3340],
    route_publication_blocks: ["dobih:3649"],
  });
  assert.ok((registry as { before_production: string[] }).before_production.includes(
    "Keep dobih:3649 blocked from any summit route until review pins a " +
    "non-climbing endpoint or a clear exception."
  ));
  assert.deepEqual(amendment.cost, {
    infrastructure_change: false,
    estimated_monthly_usd: 0,
  });
});

test("refuses any raw CSV other than the pinned v18.5 bytes", () => {
  assert.throws(
    () => buildDobihDeweysFixture(
      Buffer.from("not the pinned DoBIH CSV"),
      fixture.sources["dobih-v18.5"]
    ),
    /CSV checksum .* does not match/
  );
});
