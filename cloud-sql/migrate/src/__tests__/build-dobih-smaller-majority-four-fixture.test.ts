import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildDobihSmallerMajorityFourFixture,
} from "../build-dobih-smaller-majority-four-fixture";
import { parseDobihRows } from "../build-dobih-open-eight-fixture";
import {
  DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS,
  DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY,
  DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_WELSH_3000S_NUMBERS,
} from "../keeper-list-import/bundles/dobih-smaller-majority-four";
import {
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/data-audits/fixtures/" +
    "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as KeeperImportFixture;
const baseFixture = JSON.parse(readFileSync(path.join(
  repoRoot,
  "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json"
), "utf8")) as KeeperImportFixture;
const openEightFixture = JSON.parse(readFileSync(path.join(
  repoRoot,
  "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json"
), "utf8")) as KeeperImportFixture;
const migratePackage = JSON.parse(readFileSync(path.join(
  repoRoot,
  "cloud-sql/migrate/package.json"
), "utf8")) as { scripts: Record<string, string> };

const expectedLists = [
  {
    sourceKey: "dobih-welsh-3000s",
    listId: "3B0EE5F022C3E5831E6F",
    name: "Welsh 3000s",
    count: 15,
    selection:
      "Number IN (1963,1964,1965,1966,1967,1968,1969,1970,1971,1972,1973,1974,1975,1976,1977)",
    rosterSha256: "749fc7dda4f61e206dc62539f9e0fd3220411c9417dfeeb93789cc07fff401e2",
    organization: "British Mountaineering Council challenge",
    region: "Eryri (Snowdonia), Wales",
  },
  {
    sourceKey: "dobih-great-britain-submarilyns",
    listId: "8D35EDD459B8D18E9034",
    name: "Great Britain Submarilyns",
    count: 100,
    selection: "sMa=1 AND Country IN (E,ES,S,W)",
    rosterSha256: "80a544c71e8331545620c11510eafb26b18581f8db1a1c2544db5d2bce0c29e0",
    organization: "Alan Dawson / Pedantic Press",
    region: "Great Britain",
  },
  {
    sourceKey: "dobih-donald-deweys",
    listId: "8AEC63FDE65517E74B04",
    name: "Donald Deweys",
    count: 247,
    selection: "DDew=1",
    rosterSha256: "6fb396493ec9e7d48c36f697e7502b51e84d3318c81d87711cdb719ca997c490",
    organization: "David Purchase / LDWA Hillwalkers Register",
    region: "Scottish Lowlands",
  },
  {
    sourceKey: "dobih-england-wales-2000-foot-register",
    listId: "7D21B0495C827F72D12B",
    name: "Hewitts of England and Wales",
    count: 316,
    selection: "Hew=1 AND Country IN (E,ES,W)",
    rosterSha256: "8f3b40a77804c91d6f7da955024bce0bfe49bda384a857b82c5797cdaa63bf22",
    organization: "Alan Dawson / LDWA Hillwalkers Register",
    region: "England and Wales",
  },
] as const;

function memberIdentity(member: KeeperSourceMember): Omit<KeeperSourceMember, "ordinal"> {
  const { ordinal: _ordinal, ...identity } = member;
  return identity;
}

test("pins and validates four source rosters with publication off", () => {
  assert.equal(
    crypto.createHash("sha256").update(fixtureBytes).digest("hex"),
    "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b"
  );
  assert.equal(fixture.generatedAt, "2026-08-31");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.deepEqual(Object.keys(fixture.lists), expectedLists.map(({ sourceKey }) => sourceKey));
  assert.doesNotThrow(() =>
    validateKeeperFixture(fixture, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS)
  );

  assert.deepEqual(
    DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS.map((definition) => ({
      sourceKey: definition.sourceKey,
      listId: definition.listId,
      name: definition.name,
      count: definition.expectedCount,
      selection: definition.productionManifest?.selection,
      rosterSha256: definition.productionManifest?.rosterSha256,
      organization: definition.organization,
      region: definition.region,
    })),
    expectedLists
  );
  assert.equal(DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY, false);
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:dobih-smaller-majority-four"],
    "tsx src/build-dobih-smaller-majority-four-fixture.ts"
  );
  assert.equal(
    migratePackage.scripts["import:keeper-lists:dobih-smaller-majority-four"],
    undefined
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

test("freezes 678 memberships, 648 identities, and 527 new reviews", () => {
  const allMembers = expectedLists.flatMap(({ sourceKey }) => fixture.lists[sourceKey].rows);
  assert.equal(allMembers.length, 678);
  const newIds = new Set(allMembers.map((member) => member.sourceMemberId));
  assert.equal(newIds.size, 648);

  const priorIds = new Set([
    ...baseFixture.lists["dobih-corbetts"].rows,
    ...baseFixture.lists["dobih-wainwrights"].rows,
    ...Object.values(openEightFixture.lists).flatMap((list) => list.rows),
  ].map((member) => member.sourceMemberId));
  assert.equal([...newIds].filter((sourceId) => priorIds.has(sourceId)).length, 121);
  assert.equal([...newIds].filter((sourceId) => !priorIds.has(sourceId)).length, 527);

  const seen = new Set(priorIds);
  const reuseAndNew = expectedLists.map(({ sourceKey }) => {
    const sourceIds = fixture.lists[sourceKey].rows.map((row) => row.sourceMemberId);
    const reused = sourceIds.filter((sourceId) => seen.has(sourceId)).length;
    const added = sourceIds.length - reused;
    sourceIds.forEach((sourceId) => seen.add(sourceId));
    return [reused, added];
  });
  assert.deepEqual(reuseAndNew, [
    [15, 0],
    [9, 91],
    [7, 240],
    [120, 196],
  ]);
});

test("pins the Welsh 3000s to explicit DoBIH Numbers 1963 through 1977", () => {
  assert.deepEqual(
    fixture.lists["dobih-welsh-3000s"].rows.map((member) => member.dobihNumber),
    DOBIH_WELSH_3000S_NUMBERS
  );
  assert.deepEqual(
    fixture.lists["dobih-welsh-3000s"].rows.map((member) => member.sourceMemberId),
    DOBIH_WELSH_3000S_NUMBERS.map((number) => `dobih:${number}`)
  );
});

test("keeps every repeated DoBIH identity byte-for-byte consistent", () => {
  const identities = new Map<string, Omit<KeeperSourceMember, "ordinal">>();
  let repeatedMemberships = 0;
  for (const { sourceKey } of expectedLists) {
    for (const member of fixture.lists[sourceKey].rows) {
      const identity = memberIdentity(member);
      const prior = identities.get(member.sourceMemberId);
      if (prior == null) {
        identities.set(member.sourceMemberId, identity);
      } else {
        repeatedMemberships += 1;
        assert.deepEqual(identity, prior, `${member.sourceMemberId} changed between lists`);
      }
    }
  }
  assert.equal(repeatedMemberships, 30);

  const pairOverlap = (left: string, right: string) => {
    const leftIds = new Set(fixture.lists[left].rows.map((row) => row.sourceMemberId));
    return fixture.lists[right].rows.filter((row) => leftIds.has(row.sourceMemberId)).length;
  };
  assert.equal(pairOverlap("dobih-welsh-3000s", "dobih-great-britain-submarilyns"), 0);
  assert.equal(pairOverlap("dobih-welsh-3000s", "dobih-donald-deweys"), 0);
  assert.equal(pairOverlap("dobih-welsh-3000s", "dobih-england-wales-2000-foot-register"), 15);
  assert.equal(pairOverlap("dobih-great-britain-submarilyns", "dobih-donald-deweys"), 6);
  assert.equal(
    pairOverlap("dobih-great-britain-submarilyns", "dobih-england-wales-2000-foot-register"),
    9
  );
  assert.equal(pairOverlap("dobih-donald-deweys", "dobih-england-wales-2000-foot-register"), 0);
});

test("blocks all four firing-range members from automatic route publication", () => {
  assert.deepEqual(
    DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS.map(
      ({ sourceMemberId, name, reason, routePublicationAllowed }) =>
        [sourceMemberId, name, reason, routePublicationAllowed]
    ),
    [
      ["dobih:2711", "Mickle Fell", "live_firing_range", false],
      ["dobih:2713", "Little Fell", "live_firing_range", false],
      ["dobih:2735", "Murton Fell", "live_firing_range", false],
      ["dobih:2877", "High Willhays", "live_firing_range", false],
    ]
  );

  const hewitts = fixture.lists["dobih-england-wales-2000-foot-register"].rows;
  assert.deepEqual(
    hewitts
      .filter((member) => DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS
        .some((block) => block.sourceMemberId === member.sourceMemberId))
      .map(({ sourceMemberId, name }) => [sourceMemberId, name]),
    [
      ["dobih:2711", "Mickle Fell"],
      ["dobih:2713", "Little Fell"],
      ["dobih:2735", "Murton Fell"],
      ["dobih:2877", "High Willhays"],
    ]
  );
});

test("shared DoBIH parser requires every source-bundle selection flag", () => {
  const headers = [
    "Number", "Name", "Metres", "Latitude", "Longitude", "Country",
    "C", "W", "MT", "F", "D", "DT", "WO", "Fel", "VL", "Hew", "G",
    "Dew", "DDew", "sMa", "B", "Sy", "Ma", "HHB", "Sim", "sSim",
  ];
  const row = [
    "1", "Test Fell", "100", "51", "-1", "E",
    ...Array.from({ length: 20 }, () => "1"),
  ];
  const parsed = parseDobihRows(`${headers.join(",")}\n${row.join(",")}\n`);
  assert.equal(parsed[0].flags.Dew, true);
  assert.equal(parsed[0].flags.DDew, true);
  assert.equal(parsed[0].flags.sMa, true);
  assert.equal(parsed[0].flags.B, true);
  assert.equal(parsed[0].flags.Sy, true);
  assert.equal(parsed[0].flags.Ma, true);
  assert.equal(parsed[0].flags.HHB, true);
  assert.equal(parsed[0].flags.Sim, true);
  assert.equal(parsed[0].flags.sSim, true);

  for (const requiredColumn of [
    "Dew", "DDew", "sMa", "B", "Sy", "Ma", "HHB", "Sim", "sSim",
  ]) {
    const keptIndexes = headers.flatMap((header, index) =>
      header === requiredColumn ? [] : [index]);
    const changedHeaders = keptIndexes.map((index) => headers[index]);
    const changedRow = keptIndexes.map((index) => row[index]);
    assert.throws(
      () => parseDobihRows(`${changedHeaders.join(",")}\n${changedRow.join(",")}\n`),
      new RegExp(`missing column ${requiredColumn}`)
    );
  }
});

test("refuses any raw CSV other than the pinned v18.5 bytes", () => {
  assert.throws(
    () => buildDobihSmallerMajorityFourFixture(
      Buffer.from("not the pinned DoBIH CSV"),
      fixture.sources["dobih-v18.5"]
    ),
    /CSV checksum .* does not match/
  );
});
