import assert from "node:assert/strict";
import test from "node:test";
import * as legacy from "../import-keeper-lists";
import * as core from "../keeper-list-import/core";
import { BASE_THREE_KEEPER_LISTS } from "../keeper-list-import/bundles/base-three";
import {
  DOBIH_V18_5_SOURCE,
  KFS_100_FAMOUS_MOUNTAINS_SOURCE,
  UIAA_BULLETIN_152_SOURCE,
} from "../keeper-list-import/sources";

const emptyFixture: core.KeeperImportFixture = {
  schemaVersion: 1,
  generatedAt: "2026-08-30",
  sources: {},
  lists: {},
};

const emptyResolutions: core.KeeperResolutionFixture = {
  schemaVersion: 1,
  reviewedAt: "2026-08-30",
  catalogSnapshotSha256: "a".repeat(64),
  lists: {},
};

async function assertDefinitionsRejectedBeforeQuery(
  definitions: core.KeeperListDefinition[],
  expected: RegExp
): Promise<void> {
  let queryCount = 0;
  const client = {
    query: async () => {
      queryCount += 1;
      throw new Error("unexpected client.query call");
    },
  };
  await assert.rejects(
    () => core.runKeeperImport(
      client as never,
      emptyFixture,
      emptyResolutions,
      false,
      definitions
    ),
    expected
  );
  assert.equal(queryCount, 0);
}

test("the legacy entry exports the extracted core and base-three bundle", () => {
  assert.equal(legacy.buildKeeperImportReport, core.buildKeeperImportReport);
  assert.equal(legacy.resolveKeeperList, core.resolveKeeperList);
  assert.equal(legacy.runKeeperImport, core.runKeeperImport);
  assert.equal(legacy.KEEPER_LISTS, BASE_THREE_KEEPER_LISTS);
  assert.equal(legacy.BASE_THREE_KEEPER_LISTS, BASE_THREE_KEEPER_LISTS);
  assert.deepEqual(
    legacy.KEEPER_LISTS.map((list) => list.sourceKey),
    ["dobih-corbetts", "dobih-wainwrights", "uiaa-pyrenees-main"]
  );
  assert.ok(!("DOBIH_OPEN_EIGHT_KEEPER_LISTS" in legacy));
});

test("the base-three lists carry explicit roster sources", () => {
  assert.deepEqual(
    BASE_THREE_KEEPER_LISTS.map((list) => [
      list.sourceKey,
      list.sourceDescriptor.keeperRosterSource,
    ]),
    [
      ["dobih-corbetts", "dobih-v18.5"],
      ["dobih-wainwrights", "dobih-v18.5"],
      ["uiaa-pyrenees-main", "uiaa-bulletin-152"],
    ]
  );
  assert.equal(BASE_THREE_KEEPER_LISTS[0].sourceDescriptor, DOBIH_V18_5_SOURCE);
  assert.equal(BASE_THREE_KEEPER_LISTS[2].sourceDescriptor, UIAA_BULLETIN_152_SOURCE);
});

test("the KFS descriptor pins an eight-digit mountain identity", () => {
  const member: core.KeeperSourceMember = {
    sourceMemberId: "kfs:20000004",
    ordinal: 1,
    name: "가리산",
    elevationM: 1_050.9,
    kfsMntnId: "20000004",
  };
  assert.doesNotThrow(() =>
    KFS_100_FAMOUS_MOUNTAINS_SOURCE.assertMemberIdentity(
      "kfs-100-famous-mountains",
      member
    )
  );
  for (const invalid of [
    { ...member, kfsMntnId: "2000004" },
    { ...member, kfsMntnId: "2000000A" },
    { ...member, sourceMemberId: "kfs:20000005" },
    { ...member, kfsMntnId: undefined },
  ]) {
    assert.throws(
      () => KFS_100_FAMOUS_MOUNTAINS_SOURCE.assertMemberIdentity(
        "kfs-100-famous-mountains",
        invalid
      ),
      /KFS.*mountain ID/i
    );
  }
  assert.throws(
    () => KFS_100_FAMOUS_MOUNTAINS_SOURCE.assertMemberIdentity(
      "not-the-kfs-100-list",
      member
    ),
    /KFS 100 list/i
  );
});

test("source and stored ordinals keep their current bases", () => {
  const list = {
    ...BASE_THREE_KEEPER_LISTS[0],
    expectedCount: 1,
    destinationOverrides: { "dobih:1": "destination-1" },
  };
  const result = core.resolveKeeperList(list, {
    source: "dobih-v18.5",
    selection: "test",
    rows: [{
      sourceMemberId: "dobih:1",
      ordinal: 1,
      name: "Test Peak",
      elevationM: 1_000,
      lat: 56,
      lng: -4,
      dobihNumber: 1,
    }],
  }, [{
    id: "destination-1",
    name: "Test Peak",
    elevationM: 1_000,
    lat: 56,
    lng: -4,
    countryCode: "GB",
    stateCode: null,
    osmId: null,
    externalIds: {},
    owner: "peaks",
    destinationType: "point",
    features: ["summit"],
  }]);
  assert.equal(result.members[0].ordinal, 0);
});

test("the production runner rejects incomplete definition sets before querying", async () => {
  const first = BASE_THREE_KEEPER_LISTS[0];
  const second = BASE_THREE_KEEPER_LISTS[1];
  const manifest = second.productionManifest!;
  const cases: Array<{
    definitions: core.KeeperListDefinition[];
    expected: RegExp;
  }> = [
    { definitions: [], expected: /at least one keeper list definition/i },
    {
      definitions: [{
        ...first,
        sourceDescriptor: undefined as unknown as core.KeeperListDefinition["sourceDescriptor"],
      }],
      expected: /source descriptor/i,
    },
    {
      definitions: [first, { ...second, productionManifest: undefined }],
      expected: /production manifest/i,
    },
    {
      definitions: [first, {
        ...second,
        productionManifest: { ...manifest, generatedAt: "2026-8-30" },
      }],
      expected: /production manifest/i,
    },
    {
      definitions: [first, {
        ...second,
        productionManifest: { ...manifest, sourcesSha256: "z".repeat(64) },
      }],
      expected: /production manifest/i,
    },
    {
      definitions: [first, {
        ...second,
        productionManifest: { ...manifest, selection: " " },
      }],
      expected: /production manifest/i,
    },
    {
      definitions: [first, {
        ...second,
        productionManifest: { ...manifest, rosterSha256: "0".repeat(63) },
      }],
      expected: /production manifest/i,
    },
  ];
  for (const scenario of cases) {
    await assertDefinitionsRejectedBeforeQuery(scenario.definitions, scenario.expected);
  }
});

test("the production runner rejects repeated source keys before querying", async () => {
  await assertDefinitionsRejectedBeforeQuery([
    BASE_THREE_KEEPER_LISTS[0],
    {
      ...BASE_THREE_KEEPER_LISTS[1],
      sourceKey: BASE_THREE_KEEPER_LISTS[0].sourceKey,
    },
  ], /repeated source key/i);
});

test("the production runner rejects repeated list IDs before querying", async () => {
  await assertDefinitionsRejectedBeforeQuery([
    BASE_THREE_KEEPER_LISTS[0],
    {
      ...BASE_THREE_KEEPER_LISTS[1],
      listId: BASE_THREE_KEEPER_LISTS[0].listId,
    },
  ], /repeated list ID/i);
});
