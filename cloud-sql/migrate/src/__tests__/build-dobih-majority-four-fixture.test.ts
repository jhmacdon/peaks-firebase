import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildDobihMajorityFourFixture,
} from "../build-dobih-majority-four-fixture";
import { parseDobihRows } from "../build-dobih-open-eight-fixture";
import {
  DOBIH_MAJORITY_FOUR_KEEPER_LISTS,
} from "../keeper-list-import/bundles/dobih-majority-four";
import {
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "../keeper-list-import/core";

const repoRoot = path.resolve(__dirname, "../../../..");
const fixturePath = path.join(
  repoRoot,
  "docs/data-audits/fixtures/keeper-list-dobih-majority-four-candidates-2026-08-31.json"
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
    sourceKey: "dobih-england-wales-2000-foot-register",
    listId: "7D21B0495C827F72D12B",
    name: "Hewitts of England and Wales",
    count: 316,
    selection: "Hew=1 AND Country IN (E,ES,W)",
    rosterSha256: "8f3b40a77804c91d6f7da955024bce0bfe49bda384a857b82c5797cdaa63bf22",
    organization: "Alan Dawson / LDWA Hillwalkers Register",
    region: "England and Wales",
  },
  {
    sourceKey: "dobih-birketts",
    listId: "045A11A6033DC6178CD2",
    name: "Birketts",
    count: 541,
    selection: "B=1 AND Country=E",
    rosterSha256: "970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7",
    organization: "Bill Birkett / LDWA Hillwalkers Register",
    region: "Lake District",
  },
  {
    sourceKey: "dobih-synges",
    listId: "C28C4F0D933C73F79AC4",
    name: "Synges",
    count: 670,
    selection: "Sy=1 AND Country=E",
    rosterSha256: "8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff",
    organization: "Tim Synge / LDWA Hillwalkers Register",
    region: "Lake District",
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
] as const;

function memberIdentity(member: KeeperSourceMember): Omit<KeeperSourceMember, "ordinal"> {
  const { ordinal: _ordinal, ...identity } = member;
  return identity;
}

test("pins and validates the four source rosters without an import path", () => {
  assert.equal(
    crypto.createHash("sha256").update(fixtureBytes).digest("hex"),
    "de3b4025b66e5f7dde1decb2e7a48784044054e0280de46df2d81cc8c8de0eec"
  );
  assert.equal(fixture.generatedAt, "2026-08-31");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.deepEqual(Object.keys(fixture.lists), expectedLists.map(({ sourceKey }) => sourceKey));
  assert.doesNotThrow(() =>
    validateKeeperFixture(fixture, DOBIH_MAJORITY_FOUR_KEEPER_LISTS)
  );

  assert.deepEqual(
    DOBIH_MAJORITY_FOUR_KEEPER_LISTS.map((definition) => ({
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
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:dobih-majority-four"],
    "tsx src/build-dobih-majority-four-fixture.ts"
  );
  assert.equal(migratePackage.scripts["import:keeper-lists:dobih-majority-four"], undefined);
});

test("freezes 1627 memberships, 1015 identities, and 698 new identity reviews", () => {
  const allMembers = expectedLists.flatMap(({ sourceKey }) => fixture.lists[sourceKey].rows);
  assert.equal(allMembers.length, 1_627);
  const newIds = new Set(allMembers.map((member) => member.sourceMemberId));
  assert.equal(newIds.size, 1_015);

  const priorIds = new Set([
    ...baseFixture.lists["dobih-corbetts"].rows,
    ...baseFixture.lists["dobih-wainwrights"].rows,
    ...Object.values(openEightFixture.lists).flatMap((list) => list.rows),
  ].map((member) => member.sourceMemberId));
  assert.equal([...newIds].filter((sourceId) => priorIds.has(sourceId)).length, 317);
  assert.equal([...newIds].filter((sourceId) => !priorIds.has(sourceId)).length, 698);

  const seen = new Set(priorIds);
  const reuseAndNew = expectedLists.map(({ sourceKey }) => {
    const sourceIds = fixture.lists[sourceKey].rows.map((row) => row.sourceMemberId);
    const reused = sourceIds.filter((sourceId) => seen.has(sourceId)).length;
    const added = sourceIds.length - reused;
    sourceIds.forEach((sourceId) => seen.add(sourceId));
    return [reused, added];
  });
  assert.deepEqual(reuseAndNew, [
    [116, 200],
    [292, 249],
    [508, 162],
    [13, 87],
  ]);
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
  assert.equal(repeatedMemberships, 612);

  const pairOverlap = (left: string, right: string) => {
    const leftIds = new Set(fixture.lists[left].rows.map((row) => row.sourceMemberId));
    return fixture.lists[right].rows.filter((row) => leftIds.has(row.sourceMemberId)).length;
  };
  assert.equal(pairOverlap("dobih-england-wales-2000-foot-register", "dobih-birketts"), 113);
  assert.equal(pairOverlap("dobih-england-wales-2000-foot-register", "dobih-synges"), 114);
  assert.equal(pairOverlap("dobih-england-wales-2000-foot-register", "dobih-great-britain-submarilyns"), 9);
  assert.equal(pairOverlap("dobih-birketts", "dobih-synges"), 488);
  assert.equal(pairOverlap("dobih-birketts", "dobih-great-britain-submarilyns"), 5);
  assert.equal(pairOverlap("dobih-synges", "dobih-great-britain-submarilyns"), 6);
});

test("pins route hazards that must block automatic publication", () => {
  const birketts = fixture.lists["dobih-birketts"].rows;
  const synges = fixture.lists["dobih-synges"].rows;
  assert.deepEqual(
    birketts.find((member) => member.sourceMemberId === "dobih:2390"),
    {
      sourceMemberId: "dobih:2390",
      ordinal: 61,
      name: "Pillar Rock",
      elevationM: 779.9,
      lat: 54.499909,
      lng: -3.280793,
      dobihNumber: 2390,
    }
  );
  assert.equal(synges.find((member) => member.sourceMemberId === "dobih:2390")?.ordinal, 65);

  const hewitts = fixture.lists["dobih-england-wales-2000-foot-register"].rows;
  assert.deepEqual(
    hewitts
      .filter((member) => ["dobih:2711", "dobih:2713", "dobih:2735", "dobih:2877"]
        .includes(member.sourceMemberId))
      .map(({ sourceMemberId, name }) => [sourceMemberId, name]),
    [
      ["dobih:2711", "Mickle Fell"],
      ["dobih:2713", "Little Fell"],
      ["dobih:2735", "Murton Fell"],
      ["dobih:2877", "High Willhays"],
    ]
  );
});

test("shared DoBIH parser requires the three added selection flags", () => {
  const headers = [
    "Number", "Name", "Metres", "Latitude", "Longitude", "Country",
    "C", "W", "MT", "F", "D", "DT", "WO", "Fel", "VL", "Hew", "G",
    "B", "Sy", "sMa",
  ];
  const row = [
    "1", "Test Fell", "100", "51", "-1", "E",
    ...Array.from({ length: 14 }, () => "1"),
  ];
  const parsed = parseDobihRows(`${headers.join(",")}\n${row.join(",")}\n`);
  assert.equal(parsed[0].flags.B, true);
  assert.equal(parsed[0].flags.Sy, true);
  assert.equal(parsed[0].flags.sMa, true);

  assert.throws(
    () => parseDobihRows(`${headers.slice(0, -1).join(",")}\n${row.slice(0, -1).join(",")}\n`),
    /missing column sMa/
  );
});

test("refuses any raw CSV other than the pinned v18.5 bytes", () => {
  assert.throws(
    () => buildDobihMajorityFourFixture(
      Buffer.from("not the pinned DoBIH CSV"),
      fixture.sources["dobih-v18.5"]
    ),
    /CSV checksum .* does not match/
  );
});
