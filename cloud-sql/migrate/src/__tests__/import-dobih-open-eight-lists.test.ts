import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DOBIH_OPEN_EIGHT_KEEPER_LISTS,
} from "../keeper-list-import/bundles/dobih-open-eight";
import * as openEightCommand from "../import-dobih-open-eight-lists";
import { normalizeDobihName } from "../build-dobih-open-eight-fixture";
import { BASE_THREE_KEEPER_LISTS } from "../keeper-list-import/bundles/base-three";
import {
  deterministicKeeperListId,
  buildKeeperImportReport,
  catalogWithReviewedKeeperDestinations,
  type KeeperDestinationFingerprint,
  type KeeperCatalogPeak,
  type KeeperImportFixture,
  type KeeperImportReport,
  type KeeperListDefinition,
  type KeeperResolutionRow,
  type KeeperResolutionFixture,
  type KeeperSourceMember,
  runKeeperImport,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
  validateKeeperCrossListConsistency,
} from "../keeper-list-import/core";
import { DOBIH_V18_5_SOURCE } from "../keeper-list-import/sources";

const fixturePath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/" +
    "keeper-list-dobih-open-eight-candidates-2026-08-30.json"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as KeeperImportFixture;
const resolutionFixturePath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/" +
    "keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json"
);
const resolutionFixtureText = readFileSync(resolutionFixturePath, "utf8");
const resolutions = JSON.parse(resolutionFixtureText) as KeeperResolutionFixture;
const baseFixturePath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json"
);
const baseFixture = JSON.parse(readFileSync(baseFixturePath, "utf8")) as KeeperImportFixture;
const baseResolutionsPath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/keeper-list-identity-resolutions-2026-08-30.json"
);
const baseResolutions = JSON.parse(
  readFileSync(baseResolutionsPath, "utf8")
) as KeeperResolutionFixture;
const migratePackage = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
) as { scripts: Record<string, string> };

const SOURCE_NAME = "The Database of British and Irish Hills (CC BY 4.0)";
const SOURCE_URL = "https://www.hill-bagging.co.uk/dobih/downloads/";
const SOURCES_SHA256 = "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402";

const expectedLists = [
  {
    name: "Munro Tops",
    sourceKey: "dobih-munro-tops",
    identitySeed: "dobih:munro-tops",
    listId: "2D6085E1F8A83611B254",
    selection: "MT=1",
    count: 226,
    rosterSha256: "160fd59e3b4409919a7b5e70bfed265fa70a9bc62feb9743ae754ce198a5c65f",
    allowedCountryCodes: ["GB"],
    region: "Scotland",
    organization: "Scottish Mountaineering Club",
    yearEstablished: null,
  },
  {
    name: "Furths",
    sourceKey: "dobih-furths",
    identitySeed: "dobih:furths",
    listId: "3F89BA4000AC2F219F24",
    selection: "F=1",
    count: 34,
    rosterSha256: "020e054ab78d24151f4c16169acd847e63d6a6867d792b98148906ac2b3fae1d",
    allowedCountryCodes: ["GB", "IE"],
    region: "England, Wales, and Ireland",
    organization: "Scottish Mountaineering Club",
    yearEstablished: null,
  },
  {
    name: "Donalds",
    sourceKey: "dobih-donalds",
    identitySeed: "dobih:donalds",
    listId: "B167A387630B745AE6A5",
    selection: "D=1 OR DT=1",
    count: 141,
    rosterSha256: "a64c6bba2e79621fa08004bb28d1721259b0cd1f6dc0f7685935cb9b6290bfae",
    allowedCountryCodes: ["GB"],
    region: "Scottish Lowlands",
    organization: "Scottish Mountaineering Club",
    yearEstablished: null,
  },
  {
    name: "Wainwright's Outlying Fells",
    sourceKey: "dobih-wainwright-outlying-fells",
    identitySeed: "dobih:wainwright-outlying-fells",
    listId: "5B2ECF1DEB1708867AED",
    selection: "WO=1",
    count: 116,
    rosterSha256: "5ffd1ed3e76a350203a27d57ded8f7b7ac354c0443547f63cb8a788cd30f4999",
    allowedCountryCodes: ["GB"],
    region: "Lake District",
    organization: "LDWA Hillwalkers Register",
    yearEstablished: null,
  },
  {
    name: "Fellrangers",
    sourceKey: "dobih-fellrangers",
    identitySeed: "dobih:fellrangers",
    listId: "8A6978ADBBAC1DB066C6",
    selection: "Fel=1",
    count: 230,
    rosterSha256: "f72a4325df13c1e3e4b5f3046b297e558e900441cad6a44637b017e9988d11c8",
    allowedCountryCodes: ["GB"],
    region: "Lake District",
    organization: "LDWA Hillwalkers Register",
    yearEstablished: null,
  },
  {
    name: "Vandeleur-Lynams",
    sourceKey: "dobih-vandeleur-lynams",
    identitySeed: "dobih:vandeleur-lynams",
    listId: "65DF2B16A9B4E20A20CB",
    selection: "VL=1",
    count: 275,
    rosterSha256: "c02ccde9dc1094bdc54262c0d336cff34805abbb2d6552d213cf45f8ebf4eee7",
    allowedCountryCodes: ["GB", "IE"],
    region: "Ireland",
    organization: "MountainViews / Mountaineering Ireland",
    yearEstablished: null,
  },
  {
    name: "Irish 2000-Foot Mountains",
    sourceKey: "dobih-irish-2000-foot-register",
    identitySeed: "dobih:irish-2000-foot-register",
    listId: "5E3E4171391831A39DF1",
    selection: "Hew=1 AND Country=I",
    count: 207,
    rosterSha256: "cca6ca4c0a1a901b5038cc9cb1a7d80f759d42a0136b863a5e94542cf78bcbf4",
    allowedCountryCodes: ["GB", "IE"],
    region: "Ireland",
    organization: "LDWA Hillwalkers Register / MountainViews",
    yearEstablished: null,
  },
  {
    name: "Grahams",
    sourceKey: "dobih-grahams",
    identitySeed: "dobih:grahams",
    listId: "4944331F036CEB9BE3A1",
    selection: "G=1",
    count: 231,
    rosterSha256: "57e27078f2ec8a323cc34521210d707eba817e3baf8297fa6dbb6971b0c298be",
    allowedCountryCodes: ["GB"],
    region: "Scotland",
    organization:
      "Alan Dawson / Relative Hills Society; Scottish Mountaineering Club legacy register",
    yearEstablished: 1992,
  },
] as const;

const expectedDescriptions = [
  "The Scottish Mountaineering Club recognizes these 226 Scottish summits above " +
    "3,000 feet as Munro Tops rather than separate Munros. The roster comes from " +
    "DoBIH v18.5.",
  "The Scottish Mountaineering Club lists these 34 peaks above 3,000 feet in " +
    "England, Wales, and Ireland as Furths. The roster comes from DoBIH v18.5.",
  "The Scottish Mountaineering Club keeps the Donalds and Donald Tops of the " +
    "Scottish Lowlands. This combined 141-peak roster comes from DoBIH v18.5.",
  "Alfred Wainwright described these 116 Lake District outlying fells. The LDWA " +
    "Hillwalkers Register records completions, and the roster comes from DoBIH v18.5. " +
    "Peaks progress counts all 116 entries. The LDWA permits High Knott " +
    "(Williamson's Monument) to be omitted because access is prohibited.",
  "The Fellrangers are the 230 Lake District summits in the Fellranger guides. " +
    "The LDWA Hillwalkers Register records completions, and the roster comes from " +
    "DoBIH v18.5.",
  "MountainViews and Mountaineering Ireland recognize these 275 Irish mountains " +
    "at least 600 metres high with at least 15 metres of drop. The roster comes from " +
    "DoBIH v18.5.",
  "The LDWA Hillwalkers Register and MountainViews recognize these 207 Irish " +
    "mountains above 2,000 feet with at least 30 metres of drop. The roster comes " +
    "from DoBIH v18.5.",
  "Alan Dawson and the Relative Hills Society keep the current 231 Grahams: " +
    "Scottish mountains at least 600 metres high with at least 100 metres of drop. " +
    "The Scottish Mountaineering Club kept the earlier register, and this roster " +
    "comes from DoBIH v18.5.",
] as const;

const expectedNewExistingDestinations: Record<string, string> = {
  "dobih:11": "0587ACB8A87EC6D87545",
  "dobih:187": "67BC59CFCC4267D61CC0",
  "dobih:1167": "B76BECD4DB54DCCC01D0",
  "dobih:1218": "4AB29CA8376BBF0A41DF",
  "dobih:1678": "05502EEB409637E0D426",
  "dobih:1963": "gI7CJFLF98a4gaL4dPwZ",
  "dobih:1964": "4F5C41476E5112CC5098",
  "dobih:1970": "EA167DC54BCA8EBAE624",
  "dobih:2586": "19C3F7853C2A48A0F0A1",
  "dobih:2697": "AC65EE115B00A7BCCFDB",
  "dobih:3713": "E9144D2AE04F27E48524",
  "dobih:3761": "94473F8327C5FE57CFFF",
  "dobih:3863": "93DED9CD8B5ED4A78A6D",
  "dobih:20009": "E27209629BBE574F720B",
  "dobih:20012": "78837CC8D923A3F2B614",
  "dobih:20020": "9D60D2B084F46B54C8CD",
  "dobih:20024": "EC1C68B230A66BADFEA3",
  "dobih:20064": "FBAFFA7BE5B037F3075C",
  "dobih:20076": "71272E5C1336993A32A0",
  "dobih:20086": "19CD9FFCC4634C676086",
  "dobih:20093": "39472B53D5E6F99D178C",
  "dobih:20114": "838356B60DB94AE590B1",
  "dobih:20126": "CA68ADF6E1097EBDE7A3",
  "dobih:20140": "7358609AE231C261ECB2",
  "dobih:20169": "91B5E70173639D457CB4",
  "dobih:20210": "72A56C116A4449382D27",
  "dobih:20214": "9C6A6833F9F69EBD3D4F",
};

const expectedNewDirectRepairs: Record<string, string> = {
  "dobih:99": "CE9EAA9D73E23237966E",
  "dobih:681": "2FF8B47F8C691BD20358",
  "dobih:786": "E430C7936F66347EBAFE",
  "dobih:996": "8426AC54741E8DE5F686",
};

const expectedDistinctGuards: Record<string, string[]> = {
  "dobih:1005": ["29F9030A49A6C176BF59"],
  "dobih:1006": ["1F047C2D57CC6FA5E79B", "BC54A152A8837753065D"],
  "dobih:1244": ["39C5485837FAEBC3ECC4"],
  "dobih:1249": ["683A0C010AA1787FA943"],
  "dobih:1251": ["2CF63B8AE97D8FA7D24A"],
  "dobih:1252": ["6E9345C4B750E86BDEEA"],
  "dobih:1253": ["0D4C672ED814C98CB0BF", "70AC2A20B5B90DE21374"],
  "dobih:1256": ["2CF63B8AE97D8FA7D24A"],
  "dobih:1260": ["36237E5CA329C34E9D16", "70AC2A20B5B90DE21374"],
  "dobih:1693": ["11FFD6FDDC71B35D0B3D"],
  "dobih:2381": ["9DA18880F7EF078569F3"],
  "dobih:2505": ["74A9051905E311D6B934"],
  "dobih:722": ["41E90A8FB96CF8FA49BC"],
  "dobih:725": ["49C9C1351ECC38DCBC6C"],
  "dobih:756": ["BD4107A7C69C1B737239"],
};

const northernIrelandSourceIds = new Set(
  [
    20016, 20053, 20067, 20071, 20087, 20090, 20091, 20120, 20121, 20127, 20150,
    20137, 20153, 20183, 20187, 20196, 20198, 20200, 20204, 20205, 21236, 21238,
    21239,
  ].map((number) => `dobih:${number}`)
);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value != null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(
        (value as Record<string, unknown>)[key]
      )}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function memberWithoutOrdinal(member: KeeperSourceMember): Omit<KeeperSourceMember, "ordinal"> {
  const { ordinal: _ordinal, ...identity } = member;
  return identity;
}

function reviewedExistingRow(
  sourceKey: string,
  source: KeeperSourceMember,
  destinationId: string,
  destinationName = source.name
): KeeperResolutionRow {
  return {
    sourceKey,
    sourceMemberId: source.sourceMemberId,
    resolution: "existing_destination",
    destinationId,
    destinationName,
    destinationElevationM: source.elevationM,
    destinationLat: source.lat!,
    destinationLng: source.lng!,
    destinationOsmNodeId: null,
    destinationCountryCode: "IE",
    destinationStateCode: null,
    evidence: ["Cross-list validation test fixture."],
  };
}

function reviewedRepairRow(
  sourceKey: string,
  source: KeeperSourceMember,
  destinationId: string
): KeeperResolutionRow {
  return {
    ...reviewedExistingRow(sourceKey, source, destinationId),
    resolution: "catalog_repair",
    destinationDataSourceName: SOURCE_NAME,
    destinationDataSourceUrl: SOURCE_URL,
    destinationDataLicense: "CC BY 4.0",
    catalogBefore: {
      name: "Old Meenteog Catalog Name",
      elevationM: source.elevationM,
      lat: source.lat!,
      lng: source.lng!,
      osmNodeId: null,
      countryCode: "IE",
      stateCode: null,
      externalIds: {},
    },
    evidence: ["The saved catalog point is the same summit under an old name."],
  };
}

function emptyOpenEightResolutions(): KeeperResolutionFixture {
  return {
    schemaVersion: resolutions.schemaVersion,
    reviewedAt: resolutions.reviewedAt,
    catalogSnapshotSha256: resolutions.catalogSnapshotSha256,
    lists: Object.fromEntries(
      expectedLists.map(({ sourceKey }) => [sourceKey, { rows: [] }])
    ),
  };
}

const eligibleCatalogFields: Pick<
  KeeperCatalogPeak,
  "owner" | "destinationType" | "features"
> = {
  owner: "peaks",
  destinationType: "point",
  features: ["summit"],
};

function catalogPeakFromFingerprint(
  id: string,
  fingerprint: KeeperDestinationFingerprint
): KeeperCatalogPeak {
  return {
    ...eligibleCatalogFields,
    id,
    name: fingerprint.name,
    elevationM: fingerprint.elevationM,
    lat: fingerprint.lat,
    lng: fingerprint.lng,
    countryCode: fingerprint.countryCode,
    stateCode: fingerprint.stateCode,
    osmId: fingerprint.osmNodeId,
    externalIds: { ...(fingerprint.externalIds ?? {}) },
  };
}

function syntheticCatalogBeforeReview(
  sourceFixture: KeeperImportFixture,
  sourceResolutions: KeeperResolutionFixture,
  definitions: KeeperListDefinition[],
  automaticCountry: (sourceMemberId: string) => string,
  automaticOverrides: Record<string, KeeperCatalogPeak> = {}
): KeeperCatalogPeak[] {
  const byId = new Map<string, KeeperCatalogPeak>();
  const auxiliaryAfterByDestination = new Map(
    (sourceResolutions.catalogRepairs ?? []).map((repair) => [
      repair.destinationId,
      catalogPeakFromFingerprint(repair.destinationId, repair.after),
    ])
  );
  const add = (peak: KeeperCatalogPeak) => {
    const previous = byId.get(peak.id);
    if (previous == null) {
      byId.set(peak.id, peak);
      return;
    }
    assert.deepEqual(previous, peak, `synthetic catalog identity ${peak.id} changed`);
  };

  for (const repair of sourceResolutions.catalogRepairs ?? []) {
    add(catalogPeakFromFingerprint(repair.destinationId, repair.before));
  }
  for (const resolutionList of Object.values(sourceResolutions.lists)) {
    for (const row of resolutionList.rows) {
      if (row.resolution === "catalog_repair") {
        add(catalogPeakFromFingerprint(row.destinationId, row.catalogBefore!));
      }
    }
  }

  for (const definition of definitions) {
    const reviewedBySourceId = new Map(
      sourceResolutions.lists[definition.sourceKey].rows.map((row) => [
        row.sourceMemberId,
        row,
      ])
    );
    for (const source of sourceFixture.lists[definition.sourceKey].rows) {
      const reviewed = reviewedBySourceId.get(source.sourceMemberId);
      if (reviewed?.resolution === "curated_destination" ||
          reviewed?.resolution === "catalog_repair") {
        continue;
      }
      if (reviewed?.resolution === "existing_destination") {
        const existingPeak: KeeperCatalogPeak = {
          ...eligibleCatalogFields,
          id: reviewed.destinationId,
          name: reviewed.destinationName,
          elevationM: reviewed.destinationElevationM,
          lat: reviewed.destinationLat,
          lng: reviewed.destinationLng,
          countryCode: reviewed.destinationCountryCode,
          stateCode: reviewed.destinationStateCode,
          osmId: reviewed.destinationOsmNodeId,
          externalIds: reviewed.destinationOsmNodeId == null
            ? {}
            : { osm: reviewed.destinationOsmNodeId },
        };
        const alreadyPresent = byId.get(reviewed.destinationId);
        if (alreadyPresent != null) {
          const expectedPresent = auxiliaryAfterByDestination.get(reviewed.destinationId) ??
            alreadyPresent;
          assert.deepEqual(
            {
              ...expectedPresent,
              externalIds: existingPeak.externalIds,
            },
            existingPeak,
            `synthetic existing destination ${reviewed.destinationId} changed`
          );
        } else {
          add(existingPeak);
        }
        continue;
      }
      const automaticOverride = automaticOverrides[source.sourceMemberId];
      if (automaticOverride != null) {
        add(automaticOverride);
        continue;
      }
      if (source.sourceMemberId === "dobih:3713") {
        assert.ok(byId.has("E9144D2AE04F27E48524"));
        continue;
      }
      assert.ok(source.lat != null && source.lng != null, source.sourceMemberId);
      add({
        ...eligibleCatalogFields,
        id: `automatic:${source.sourceMemberId}`,
        name: source.name,
        elevationM: source.elevationM,
        lat: source.lat!,
        lng: source.lng!,
        countryCode: automaticCountry(source.sourceMemberId),
        stateCode: null,
        osmId: null,
        externalIds: {},
      });
    }
  }
  return [...byId.values()];
}

async function assertRejectedBeforeAnyQuery(
  fixtureUnderTest: KeeperImportFixture,
  resolutionsUnderTest: KeeperResolutionFixture,
  expected: RegExp,
  definitions = DOBIH_OPEN_EIGHT_KEEPER_LISTS
): Promise<void> {
  let queryCount = 0;
  const client = {
    query: async () => {
      queryCount += 1;
      throw new Error("unexpected database query");
    },
  };
  await assert.rejects(
    () => runKeeperImport(
      client as never,
      fixtureUnderTest,
      resolutionsUnderTest,
      false,
      definitions
    ),
    expected
  );
  assert.equal(queryCount, 0);
}

test("pins the exact open-eight definitions and production manifests", () => {
  assert.equal(openEightCommand.DOBIH_OPEN_EIGHT_KEEPER_LISTS, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  assert.equal(DOBIH_OPEN_EIGHT_KEEPER_LISTS.length, expectedLists.length);

  for (const [index, expected] of expectedLists.entries()) {
    const actual = DOBIH_OPEN_EIGHT_KEEPER_LISTS[index];
    assert.equal(deterministicKeeperListId(expected.identitySeed), expected.listId);
    assert.equal(actual.listId, expected.listId);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.description, expectedDescriptions[index]);
    assert.equal(actual.sourceKey, expected.sourceKey);
    assert.equal(actual.sourceDescriptor, DOBIH_V18_5_SOURCE);
    assert.equal(actual.expectedCount, expected.count);
    assert.deepEqual(actual.destinationOverrides, {});
    assert.deepEqual(actual.allowedCountryCodes, expected.allowedCountryCodes);
    assert.equal(actual.allowedStateCodes, undefined);
    assert.equal(actual.region, expected.region);
    assert.equal(actual.organization, expected.organization);
    assert.equal(actual.yearEstablished, expected.yearEstablished);
    assert.equal(actual.sourceName, SOURCE_NAME);
    assert.equal(actual.sourceUrl, SOURCE_URL);
    assert.deepEqual(actual.productionManifest, {
      generatedAt: "2026-08-30",
      sourcesSha256: SOURCES_SHA256,
      selection: expected.selection,
      rosterSha256: expected.rosterSha256,
    });
  }
});

test("exposes separate import and offline resolution-builder commands", () => {
  assert.equal(
    migratePackage.scripts["import:keeper-lists:dobih-open-eight"],
    "tsx src/import-dobih-open-eight-lists.ts"
  );
  assert.equal(
    migratePackage.scripts["build:keeper-list-resolutions:dobih-open-eight"],
    "tsx src/build-dobih-open-eight-resolutions.ts"
  );
});

test("pins the open-eight source fixture counts, hashes, order, and overlaps", () => {
  validateKeeperFixture(fixture, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.generatedAt, "2026-08-30");
  assert.deepEqual(Object.keys(fixture.sources), ["dobih-v18.5"]);
  assert.equal(canonicalSha256(fixture.sources), SOURCES_SHA256);

  const source = fixture.sources["dobih-v18.5"] as Record<string, unknown>;
  assert.equal(source.archiveSha256,
    "0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021");
  assert.equal(source.csvSha256,
    "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea");

  const allRows: KeeperSourceMember[] = [];
  for (const expected of expectedLists) {
    const sourceList = fixture.lists[expected.sourceKey];
    assert.equal(sourceList.source, "dobih-v18.5");
    assert.equal(sourceList.selection, expected.selection);
    assert.equal(sourceList.rows.length, expected.count);
    assert.equal(canonicalSha256(sourceList.rows), expected.rosterSha256);
    assert.deepEqual(
      sourceList.rows.map((row) => row.ordinal),
      Array.from({ length: expected.count }, (_, index) => index + 1)
    );
    assert.deepEqual(
      sourceList.rows.map((row) => row.dobihNumber),
      [...sourceList.rows]
        .map((row) => row.dobihNumber)
        .sort((left, right) => left! - right!)
    );
    assert.ok(sourceList.rows.every((row) =>
      row.sourceMemberId === `dobih:${row.dobihNumber}`
    ));
    allRows.push(...sourceList.rows);
  }

  assert.equal(allRows.length, 1_460);
  const openEightIds = new Set(allRows.map((row) => row.sourceMemberId));
  assert.equal(openEightIds.size, 1_201);

  const baseDobihIds = new Set([
    ...baseFixture.lists["dobih-corbetts"].rows,
    ...baseFixture.lists["dobih-wainwrights"].rows,
  ].map((row) => row.sourceMemberId));
  assert.equal([...openEightIds].filter((sourceId) => baseDobihIds.has(sourceId)).length, 212);
  assert.equal([...openEightIds].filter((sourceId) => !baseDobihIds.has(sourceId)).length, 989);

  const seen = new Set(baseDobihIds);
  const reuseAndNew = expectedLists.map(({ sourceKey }) => {
    const sourceIds = fixture.lists[sourceKey].rows.map((row) => row.sourceMemberId);
    const reused = sourceIds.filter((sourceId) => seen.has(sourceId)).length;
    const added = sourceIds.length - reused;
    sourceIds.forEach((sourceId) => seen.add(sourceId));
    return [reused, added];
  });
  assert.deepEqual(reuseAndNew, [
    [0, 226],
    [4, 30],
    [7, 134],
    [0, 116],
    [217, 13],
    [13, 262],
    [207, 0],
    [23, 208],
  ]);
});

test("normalizes every repeated DoBIH source row and the guarded row 20085", () => {
  const identities = new Map<string, Omit<KeeperSourceMember, "ordinal">>();
  let repeatedMemberships = 0;
  for (const { sourceKey } of expectedLists) {
    for (const row of fixture.lists[sourceKey].rows) {
      const identity = memberWithoutOrdinal(row);
      const prior = identities.get(row.sourceMemberId);
      if (prior == null) {
        identities.set(row.sourceMemberId, identity);
      } else {
        repeatedMemberships += 1;
        assert.deepEqual(identity, prior, `${row.sourceMemberId} changed between source lists`);
      }
    }
  }
  assert.equal(repeatedMemberships, 259);

  const correctedRows = expectedLists.flatMap(({ sourceKey }) =>
    fixture.lists[sourceKey].rows.filter((row) => row.sourceMemberId === "dobih:20085")
  );
  assert.equal(correctedRows.length, 2);
  for (const row of correctedRows) {
    assert.equal(row.dobihNumber, 20_085);
    assert.equal(row.name, "Meenteog");
    assert.deepEqual(row.aliases, ["Moing an tSamhaidh"]);
    assert.doesNotMatch(`${row.name} ${(row.aliases ?? []).join(" ")}`, /[\[\]]/);
  }
});

test("limits the row-20085 correction to the exact reviewed typo", () => {
  assert.deepEqual(
    normalizeDobihName(20_085, "Meenteog [Moing an tSamhaidh]]"),
    { name: "Meenteog", aliases: ["Moing an tSamhaidh"] }
  );
  assert.throws(
    () => normalizeDobihName(20_085, "Meenteog [Moing an tSamhaidh]"),
    /Name changed/
  );
  assert.throws(
    () => normalizeDobihName(99_999, "Another Summit [Alias]]"),
    /unbalanced Name brackets/
  );
});

test("rejects a repeated source identity conflict before any database query", async () => {
  const conflictedFixture = structuredClone(fixture);
  const conflictingRow = conflictedFixture.lists[
    "dobih-irish-2000-foot-register"
  ].rows.find((row) => row.sourceMemberId === "dobih:20085")!;
  conflictingRow.name = "Conflicting Meenteog Identity";
  const conflictedDefinitions = DOBIH_OPEN_EIGHT_KEEPER_LISTS.map((definition) => ({
    ...definition,
    productionManifest: {
      ...definition.productionManifest!,
      rosterSha256: canonicalSha256(
        conflictedFixture.lists[definition.sourceKey].rows
      ),
    },
  }));

  await assertRejectedBeforeAnyQuery(
    conflictedFixture,
    resolutions,
    /dobih:20085.*changes between lists/,
    conflictedDefinitions
  );
});

test("rejects a repeated resolution destination conflict before any database query", async () => {
  const conflictedResolutions = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  conflictedResolutions.lists["dobih-vandeleur-lynams"].rows = [
    reviewedExistingRow("dobih-vandeleur-lynams", source, "destination-a"),
  ];
  conflictedResolutions.lists["dobih-irish-2000-foot-register"].rows = [
    reviewedExistingRow("dobih-irish-2000-foot-register", source, "destination-b"),
  ];

  await assertRejectedBeforeAnyQuery(
    fixture,
    conflictedResolutions,
    /dobih:20085.*different destination IDs/
  );
});

test("requires an explicit repeated decision in every owner list before querying", async () => {
  const incompleteResolutions = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  incompleteResolutions.lists["dobih-vandeleur-lynams"].rows = [
    reviewedExistingRow("dobih-vandeleur-lynams", source, "destination-a"),
  ];

  await assertRejectedBeforeAnyQuery(
    fixture,
    incompleteResolutions,
    /dobih:20085.*missing.*dobih-irish-2000-foot-register/
  );
});

test("rejects a repeated resolution fingerprint conflict before any database query", async () => {
  const conflictedResolutions = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  conflictedResolutions.lists["dobih-vandeleur-lynams"].rows = [
    reviewedExistingRow("dobih-vandeleur-lynams", source, "destination-a"),
  ];
  conflictedResolutions.lists["dobih-irish-2000-foot-register"].rows = [
    reviewedExistingRow(
      "dobih-irish-2000-foot-register",
      source,
      "destination-a",
      "Moing an tSamhaidh"
    ),
  ];

  await assertRejectedBeforeAnyQuery(
    fixture,
    conflictedResolutions,
    /dobih:20085.*different destination fingerprints/
  );
});

test("rejects repeated curated provenance drift before any database query", async () => {
  const conflictedResolutions = structuredClone(resolutions);
  const changed = conflictedResolutions.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20005"
  )!;
  assert.equal(changed.resolution, "curated_destination");
  changed.destinationDataSourceUrl =
    "https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=20006";

  await assertRejectedBeforeAnyQuery(
    fixture,
    conflictedResolutions,
    /dobih:20005.*different destination decisions/
  );
});

test("validates fixture and resolution schemas before any database query", async () => {
  const invalidFixture = structuredClone(fixture);
  invalidFixture.schemaVersion = 2;
  await assertRejectedBeforeAnyQuery(
    invalidFixture,
    resolutions,
    /Unsupported keeper fixture schema 2/
  );

  const invalidResolutions = structuredClone(resolutions);
  invalidResolutions.schemaVersion = 2;
  await assertRejectedBeforeAnyQuery(
    fixture,
    invalidResolutions,
    /Unsupported keeper resolution schema 2/
  );

  const missingListResolutions = structuredClone(resolutions);
  missingListResolutions.lists = {};
  await assertRejectedBeforeAnyQuery(
    fixture,
    missingListResolutions,
    /Keeper resolutions are missing list dobih-munro-tops/
  );
});

test("permits one later-list repair with exact earlier-list projections", () => {
  const reviewed = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  const destinationId = "destination-meenteog";
  reviewed.lists["dobih-vandeleur-lynams"].rows = [
    reviewedExistingRow("dobih-vandeleur-lynams", source, destinationId),
  ];
  reviewed.lists["dobih-irish-2000-foot-register"].rows = [
    reviewedRepairRow("dobih-irish-2000-foot-register", source, destinationId),
  ];

  validateKeeperResolutionFixture(fixture, reviewed, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  validateKeeperCrossListConsistency(fixture, reviewed, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  const before = reviewed.lists[
    "dobih-irish-2000-foot-register"
  ].rows[0].catalogBefore!;
  const catalog: KeeperCatalogPeak[] = [{
    id: destinationId,
    name: before.name,
    elevationM: before.elevationM,
    lat: before.lat,
    lng: before.lng,
    countryCode: before.countryCode,
    stateCode: before.stateCode,
    osmId: before.osmNodeId,
    externalIds: before.externalIds!,
    owner: "peaks",
    destinationType: "point",
    features: ["summit"],
  }];
  const result = catalogWithReviewedKeeperDestinations(
    catalog,
    fixture,
    reviewed,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(result.destinationsToRepair.length, 1);
  assert.equal(result.destinationsToRepair[0].id, destinationId);
  assert.equal(result.catalog.find((peak) => peak.id === destinationId)?.name, "Meenteog");
});

test("rejects two cross-list repairs before any database query", async () => {
  const reviewed = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  reviewed.lists["dobih-vandeleur-lynams"].rows = [
    reviewedRepairRow("dobih-vandeleur-lynams", source, "destination-meenteog"),
  ];
  reviewed.lists["dobih-irish-2000-foot-register"].rows = [
    reviewedRepairRow(
      "dobih-irish-2000-foot-register",
      source,
      "destination-meenteog"
    ),
  ];
  await assertRejectedBeforeAnyQuery(
    fixture,
    reviewed,
    /dobih:20085.*more than one catalog repair/
  );
});

test("rejects colliding direct repair targets before any database query", async () => {
  const directCollision = structuredClone(resolutions);
  const shalloch = directCollision.lists["dobih-donalds"].rows.find((row) =>
    row.sourceMemberId === "dobih:1692"
  )!;
  const midHill = directCollision.lists["dobih-grahams"].rows.find((row) =>
    row.sourceMemberId === "dobih:99"
  )!;
  midHill.destinationId = shalloch.destinationId;
  await assertRejectedBeforeAnyQuery(
    fixture,
    directCollision,
    /catalog repairs dobih:1692 and dobih:99 target the same destination/
  );

  const auxiliaryCollision = structuredClone(resolutions);
  auxiliaryCollision.lists["dobih-grahams"].rows.find((row) =>
    row.sourceMemberId === "dobih:99"
  )!.destinationId = "E9144D2AE04F27E48524";
  await assertRejectedBeforeAnyQuery(
    fixture,
    auxiliaryCollision,
    /catalog repair dobih:99 conflicts with auxiliary repair dobih:2489-graystones-main/
  );
});

test("rejects one repeated automatic source resolving to different destinations", () => {
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find((row) =>
    row.sourceMemberId === "dobih:20085"
  )!;
  const sourceDescriptor = DOBIH_OPEN_EIGHT_KEEPER_LISTS[5].sourceDescriptor;
  const definitions: KeeperListDefinition[] = [
    {
      listId: "automatic-ie",
      sourceKey: "automatic-ie",
      sourceDescriptor,
      name: "Automatic IE",
      description: "Test list.",
      expectedCount: 1,
      destinationOverrides: {},
      allowedCountryCodes: ["IE"],
      yearEstablished: null,
      organization: null,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      region: "Ireland",
    },
    {
      listId: "automatic-gb",
      sourceKey: "automatic-gb",
      sourceDescriptor,
      name: "Automatic GB",
      description: "Test list.",
      expectedCount: 1,
      destinationOverrides: {},
      allowedCountryCodes: ["GB"],
      yearEstablished: null,
      organization: null,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      region: "Northern Ireland",
    },
  ];
  const repeatedFixture: KeeperImportFixture = {
    schemaVersion: 1,
    generatedAt: fixture.generatedAt,
    sources: fixture.sources,
    lists: Object.fromEntries(definitions.map((definition) => [
      definition.sourceKey,
      {
        source: "dobih-v18.5",
        selection: "test",
        rows: [{ ...source, ordinal: 1 }],
      },
    ])),
  };
  const repeatedResolutions: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: Object.fromEntries(definitions.map((definition) => [
      definition.sourceKey,
      { rows: [] },
    ])),
  };
  const catalog = ["IE", "GB"].map((countryCode, index): KeeperCatalogPeak => ({
    id: `automatic-${index}`,
    name: source.name,
    elevationM: source.elevationM,
    lat: source.lat!,
    lng: source.lng!,
    countryCode,
    stateCode: null,
    osmId: null,
    externalIds: {},
    owner: "peaks",
    destinationType: "point",
    features: ["summit"],
  }));

  assert.throws(
    () => buildKeeperImportReport(
      repeatedFixture,
      repeatedResolutions,
      catalog,
      [],
      false,
      definitions
    ),
    /dobih:20085.*different destinations automatic-0 and automatic-1/
  );
});

test("rejects a repair projection that does not pin the after fingerprint", async () => {
  const reviewed = emptyOpenEightResolutions();
  const source = fixture.lists["dobih-vandeleur-lynams"].rows.find(
    (row) => row.sourceMemberId === "dobih:20085"
  )!;
  reviewed.lists["dobih-vandeleur-lynams"].rows = [
    reviewedExistingRow(
      "dobih-vandeleur-lynams",
      source,
      "destination-meenteog",
      "Wrong Projection Name"
    ),
  ];
  reviewed.lists["dobih-irish-2000-foot-register"].rows = [
    reviewedRepairRow(
      "dobih-irish-2000-foot-register",
      source,
      "destination-meenteog"
    ),
  ];
  await assertRejectedBeforeAnyQuery(
    fixture,
    reviewed,
    /dobih:20085.*different destination fingerprints/
  );
});

test("rejects an unbounded catalog repair before any database query", async () => {
  const source = fixture.lists["dobih-grahams"].rows.find(
    (row) => row.sourceMemberId === "dobih:99"
  )!;
  const moved = emptyOpenEightResolutions();
  const movedRow = reviewedRepairRow("dobih-grahams", source, "destination-mid-hill");
  movedRow.destinationCountryCode = "GB";
  movedRow.catalogBefore!.countryCode = "GB";
  movedRow.catalogBefore!.lat += 0.1;
  moved.lists["dobih-grahams"].rows = [movedRow];
  await assertRejectedBeforeAnyQuery(
    fixture,
    moved,
    /dobih:99.*moves.*more than 750 m/
  );

  const raised = emptyOpenEightResolutions();
  const raisedRow = reviewedRepairRow("dobih-grahams", source, "destination-mid-hill");
  raisedRow.destinationCountryCode = "GB";
  raisedRow.catalogBefore!.countryCode = "GB";
  raisedRow.catalogBefore!.elevationM += 100;
  raised.lists["dobih-grahams"].rows = [raisedRow];
  await assertRejectedBeforeAnyQuery(
    fixture,
    raised,
    /dobih:99.*changes elevation.*more than 10 m/
  );
});

test("keeps catalog repair distance and elevation limits closed at the edge", () => {
  const source = fixture.lists["dobih-grahams"].rows.find(
    (row) => row.sourceMemberId === "dobih:99"
  )!;
  const reviewedAt = (distanceM: number, elevationDeltaM: number) => {
    const reviewed = emptyOpenEightResolutions();
    const row = reviewedRepairRow("dobih-grahams", source, "destination-mid-hill");
    row.destinationCountryCode = "GB";
    row.catalogBefore!.countryCode = "GB";
    row.catalogBefore!.lat = row.destinationLat +
      distanceM / 6_371_000 * 180 / Math.PI;
    row.catalogBefore!.elevationM = row.destinationElevationM + elevationDeltaM;
    reviewed.lists["dobih-grahams"].rows = [row];
    return reviewed;
  };

  assert.doesNotThrow(() => validateKeeperResolutionFixture(
    fixture,
    reviewedAt(749.999, 10),
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  ));
  assert.throws(
    () => validateKeeperResolutionFixture(
      fixture,
      reviewedAt(750.001, 10),
      DOBIH_OPEN_EIGHT_KEEPER_LISTS
    ),
    /moves 750 m, more than 750 m/
  );
  assert.throws(
    () => validateKeeperResolutionFixture(
      fixture,
      reviewedAt(749.999, 10.001),
      DOBIH_OPEN_EIGHT_KEEPER_LISTS
    ),
    /changes elevation by 10\..*more than 10 m/
  );
});

test("starts the reviewed resolution fixture with every open-eight list boundary", () => {
  assert.equal(resolutions.schemaVersion, 1);
  assert.match(resolutions.catalogSnapshotSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(resolutions.lists), expectedLists.map((list) => list.sourceKey));
});

test("pins a complete and cross-list-consistent reviewed resolution fixture", () => {
  validateKeeperResolutionFixture(fixture, resolutions, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  validateKeeperCrossListConsistency(fixture, resolutions, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  assert.equal(
    resolutions.catalogSnapshotSha256,
    "ba9eafe8f7a97f1b96a95c4b0c4a2fc6818f575da9425c1b57dd19467c319726"
  );
  assert.equal(
    crypto.createHash("sha256").update(resolutionFixtureText).digest("hex"),
    "bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1"
  );
  assert.equal(
    canonicalSha256(resolutions),
    "c8603cb6db054c93799094e65cd0ac00225b06b628d1d3e72eb2c351ff23ffbf"
  );
  assert.deepEqual(resolutions.catalogSnapshots, {
    "dobih-open-eight-catalog-2026-08-30.csv":
      "ba9eafe8f7a97f1b96a95c4b0c4a2fc6818f575da9425c1b57dd19467c319726",
    "dobih-open-eight-nearby-osm-nodes.json":
      "1c1f8f128949bf0f400498567df2d8320dced0f6f83d2d8d8f882ee2dbbf6c8e",
    "dobih-open-eight-nearest-osm-nodes.json":
      "49a13a228df0e9658f9d9e76e98ab849ccfdfea170ab0cfaf170ef7b03dac3d4",
  });

  const rows = expectedLists.flatMap(({ sourceKey }) => resolutions.lists[sourceKey].rows);
  assert.equal(rows.length, 827);
  assert.deepEqual(
    Object.fromEntries(
      ["existing_destination", "catalog_repair", "curated_destination"].map((kind) => [
        kind,
        rows.filter((row) => row.resolution === kind).length,
      ])
    ),
    {
      existing_destination: 76,
      catalog_repair: 6,
      curated_destination: 745,
    }
  );
  assert.equal(resolutions.catalogRepairs?.length, 11);

  const openSourceIds = new Set(
    expectedLists.flatMap(({ sourceKey }) =>
      fixture.lists[sourceKey].rows.map((row) => row.sourceMemberId)
    )
  );
  const reviewedBaseRows = Object.values(baseResolutions.lists)
    .flatMap((list) => list.rows)
    .filter((row) => openSourceIds.has(row.sourceMemberId));
  assert.equal(new Set(reviewedBaseRows.map((row) => row.sourceMemberId)).size, 45);

  const rowsBySourceId = new Map<string, KeeperResolutionRow[]>();
  for (const row of rows) {
    const grouped = rowsBySourceId.get(row.sourceMemberId) ?? [];
    grouped.push(row);
    rowsBySourceId.set(row.sourceMemberId, grouped);
  }
  for (const baseRow of reviewedBaseRows) {
    const reusedRows = rowsBySourceId.get(baseRow.sourceMemberId) ?? [];
    assert.ok(reusedRows.length > 0, `${baseRow.sourceMemberId} did not reuse its reviewed identity`);
    for (const row of reusedRows) {
      assert.deepEqual(
        {
          destinationId: row.destinationId,
          destinationName: row.destinationName,
          destinationElevationM: row.destinationElevationM,
          destinationLat: row.destinationLat,
          destinationLng: row.destinationLng,
          destinationOsmNodeId: row.destinationOsmNodeId,
          destinationCountryCode: row.destinationCountryCode,
          destinationStateCode: row.destinationStateCode,
        },
        {
          destinationId: baseRow.destinationId,
          destinationName: baseRow.destinationName,
          destinationElevationM: baseRow.destinationElevationM,
          destinationLat: baseRow.destinationLat,
          destinationLng: baseRow.destinationLng,
          destinationOsmNodeId: baseRow.destinationOsmNodeId,
          destinationCountryCode: baseRow.destinationCountryCode,
          destinationStateCode: baseRow.destinationStateCode,
        },
        `${baseRow.sourceMemberId} changed its reviewed destination identity`
      );
    }
  }

  const baseRepairIds = new Set((baseResolutions.catalogRepairs ?? []).map((repair) => repair.repairId));
  const openRepairs = new Map(
    (resolutions.catalogRepairs ?? []).map((repair) => [repair.repairId, repair])
  );
  assert.equal(baseRepairIds.size, 7);
  for (const repairId of baseRepairIds) {
    assert.deepEqual(
      openRepairs.get(repairId),
      baseResolutions.catalogRepairs!.find((repair) => repair.repairId === repairId),
      `${repairId} changed from the reviewed base fixture`
    );
  }
});

test("pins the reviewed identity classes, close neighbors, and Irish border split", () => {
  const rows = expectedLists.flatMap(({ sourceKey }) => resolutions.lists[sourceKey].rows);
  let existingOwnerRows = 0;
  for (const [sourceMemberId, destinationId] of Object.entries(
    expectedNewExistingDestinations
  )) {
    const mapped = rows.filter((row) => row.sourceMemberId === sourceMemberId);
    assert.ok(mapped.length > 0, `${sourceMemberId} has no reviewed existing destination`);
    existingOwnerRows += mapped.length;
    for (const row of mapped) {
      assert.equal(row.resolution, "existing_destination", sourceMemberId);
      assert.equal(row.destinationId, destinationId, sourceMemberId);
    }
  }
  assert.equal(existingOwnerRows, 43);

  for (const [sourceMemberId, destinationId] of Object.entries(expectedNewDirectRepairs)) {
    const mapped = rows.filter((row) => row.sourceMemberId === sourceMemberId);
    assert.equal(mapped.length, 1, sourceMemberId);
    assert.equal(mapped[0].resolution, "catalog_repair", sourceMemberId);
    assert.equal(mapped[0].destinationId, destinationId, sourceMemberId);
  }

  const guardRows = new Map<string, string[]>();
  for (const row of rows) {
    if (row.distinctFromDestinationIds == null) continue;
    const previous = guardRows.get(row.sourceMemberId);
    if (previous != null) {
      assert.deepEqual(row.distinctFromDestinationIds, previous, row.sourceMemberId);
    } else {
      guardRows.set(row.sourceMemberId, row.distinctFromDestinationIds);
    }
  }
  assert.deepEqual(
    Object.fromEntries([...guardRows.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )),
    expectedDistinctGuards
  );

  const expectedSecondaryRepairs = [
    ["dobih:1693-secondary-name", "11FFD6FDDC71B35D0B3D", "Meikle Millyea - Trig Point"],
    ["dobih:722-secondary-name", "41E90A8FB96CF8FA49BC", "Beinn a' Chapuill West Top"],
    ["dobih:725-secondary-name", "49C9C1351ECC38DCBC6C", "Beinn Clachach West Top"],
    ["dobih:756-secondary-name", "BD4107A7C69C1B737239", "Meall nan Eun West Top"],
  ] as const;
  for (const [repairId, destinationId, afterName] of expectedSecondaryRepairs) {
    const repair = resolutions.catalogRepairs?.find((candidate) =>
      candidate.repairId === repairId
    );
    assert.ok(repair, repairId);
    assert.equal(repair.destinationId, destinationId);
    assert.equal(repair.after.name, afterName);
    assert.equal(repair.after.lat, repair.before.lat);
    assert.equal(repair.after.lng, repair.before.lng);
    assert.equal(repair.after.elevationM, repair.before.elevationM);
  }
  const meikleRepair = resolutions.catalogRepairs?.find((repair) =>
    repair.repairId === "dobih:1693-secondary-name"
  )!;
  assert.deepEqual(meikleRepair.externalIdRemovals, { wikidata: "Q86753760" });
  assert.equal(meikleRepair.before.externalIds?.wikidata, "Q86753760");
  assert.equal(meikleRepair.after.externalIds?.wikidata, undefined);

  const irishSourceIds = new Set(
    fixture.lists["dobih-vandeleur-lynams"].rows.map((row) => row.sourceMemberId)
  );
  assert.equal(irishSourceIds.size, 275);
  assert.equal(northernIrelandSourceIds.size, 23);
  for (const sourceMemberId of northernIrelandSourceIds) {
    assert.ok(irishSourceIds.has(sourceMemberId), `${sourceMemberId} is outside the Irish roster`);
  }
  for (const row of rows) {
    assert.equal(row.destinationStateCode, null, row.sourceMemberId);
    assert.equal(
      row.destinationCountryCode,
      irishSourceIds.has(row.sourceMemberId) &&
        !northernIrelandSourceIds.has(row.sourceMemberId) ? "IE" : "GB",
      row.sourceMemberId
    );
  }
  const combinedCountyRows = rows.filter((row) => row.sourceMemberId === "dobih:20200");
  assert.equal(combinedCountyRows.length, 2);
  assert.ok(combinedCountyRows.every((row) => row.destinationCountryCode === "GB"));
  assert.equal(
    rows.filter((row) => row.sourceMemberId === "dobih:20137").length,
    0,
    "Cuilcagh stays on its separately pinned catalog auto-match path"
  );

  const highKnott = rows.filter((row) => row.sourceMemberId === "dobih:2630");
  assert.equal(highKnott.length, 1);
  assert.equal(highKnott[0].resolution, "curated_destination");
  assert.equal(highKnott[0].destinationId, "7F036923996DFDBB0C0C");
  assert.equal(highKnott[0].destinationName, "High Knott");

  const graystones = rows.filter((row) => row.sourceMemberId === "dobih:3713");
  assert.equal(graystones.length, 1);
  assert.equal(graystones[0].resolution, "existing_destination");
  assert.equal(graystones[0].destinationId, "E9144D2AE04F27E48524");
  assert.equal(graystones[0].destinationName, "Graystones (main summit)");
  assert.equal(graystones[0].destinationOsmNodeId, "29953562");
});

test("never puts a DoBIH identity into destination external IDs", () => {
  const externalIdSets: Array<Record<string, string> | undefined> = [];
  for (const row of expectedLists.flatMap(({ sourceKey }) =>
    resolutions.lists[sourceKey].rows
  )) {
    externalIdSets.push(row.catalogBefore?.externalIds);
    externalIdSets.push(row.catalogExternalIdAdditions);
  }
  for (const repair of resolutions.catalogRepairs ?? []) {
    externalIdSets.push(repair.before.externalIds);
    externalIdSets.push(repair.after.externalIds);
  }
  for (const externalIds of externalIdSets) {
    for (const [key, value] of Object.entries(externalIds ?? {})) {
      assert.doesNotMatch(key, /dobih/i);
      assert.doesNotMatch(value, /^dobih:/i);
    }
  }
});

test("the full pre- and post-base plans resolve all 1,460 memberships idempotently", () => {
  const irishSourceIds = new Set(
    fixture.lists["dobih-vandeleur-lynams"].rows.map((row) => row.sourceMemberId)
  );
  const cuilcaghCatalogPeak: KeeperCatalogPeak = {
    ...eligibleCatalogFields,
    id: "E1B5FA84B5B6986A16FF",
    name: "Cuilcagh",
    elevationM: 666,
    lat: 54.2007467,
    lng: -7.8117352,
    countryCode: "GB",
    stateCode: null,
    osmId: "3133612029",
    externalIds: { osm: "3133612029", wikidata: "Q3544420" },
  };
  const openCatalogBeforeReview = syntheticCatalogBeforeReview(
    fixture,
    resolutions,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS,
    (sourceMemberId) => irishSourceIds.has(sourceMemberId) &&
      !northernIrelandSourceIds.has(sourceMemberId) ? "IE" : "GB",
    { "dobih:20137": cuilcaghCatalogPeak }
  );

  const preBasePlan = catalogWithReviewedKeeperDestinations(
    openCatalogBeforeReview,
    fixture,
    resolutions,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(preBasePlan.destinationsToAdd.length, 617);
  assert.equal(preBasePlan.destinationsToRepair.length, 17);
  const preBaseResolved = buildKeeperImportReport(
    fixture,
    resolutions,
    preBasePlan.catalog,
    [],
    false,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(preBaseResolved.report.complete, true);
  assert.deepEqual(
    preBaseResolved.report.lists.map((list) => [
      list.sourceKey,
      list.resolvedCount,
      list.unresolvedCount,
    ]),
    expectedLists.map((list) => [list.sourceKey, list.count, 0])
  );
  assert.equal(
    preBaseResolved.plans.reduce((total, plan) => total + plan.members.length, 0),
    1_460
  );

  const baseCatalogBeforeReview = syntheticCatalogBeforeReview(
    baseFixture,
    baseResolutions,
    BASE_THREE_KEEPER_LISTS,
    () => "GB"
  );
  const baseApplied = catalogWithReviewedKeeperDestinations(
    baseCatalogBeforeReview,
    baseFixture,
    baseResolutions,
    BASE_THREE_KEEPER_LISTS
  );
  const postBaseCatalogById = new Map(
    openCatalogBeforeReview.map((peak) => [peak.id, peak])
  );
  for (const peak of baseApplied.catalog) postBaseCatalogById.set(peak.id, peak);
  const postBasePlan = catalogWithReviewedKeeperDestinations(
    [...postBaseCatalogById.values()],
    fixture,
    resolutions,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(postBasePlan.destinationsToAdd.length, 607);
  assert.equal(postBasePlan.destinationsToRepair.length, 8);
  const postBaseResolved = buildKeeperImportReport(
    fixture,
    resolutions,
    postBasePlan.catalog,
    [],
    false,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(postBaseResolved.report.complete, true);

  const decisions = (plans: typeof preBaseResolved.plans) => plans.flatMap((plan) =>
    plan.members.map((member) => ({
      sourceKey: plan.list.sourceKey,
      sourceMemberId: member.sourceMemberId,
      destinationId: member.destinationId,
      ordinal: member.ordinal,
    }))
  );
  assert.deepEqual(decisions(postBaseResolved.plans), decisions(preBaseResolved.plans));

  const currentMemberships = preBaseResolved.plans.flatMap((plan) =>
    plan.members.map((member) => ({
      listId: plan.list.listId,
      destinationId: member.destinationId,
      ordinal: member.ordinal,
    }))
  );
  assert.equal(currentMemberships.length, 1_460);
  const second = buildKeeperImportReport(
    fixture,
    resolutions,
    preBasePlan.catalog,
    currentMemberships,
    false,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  assert.equal(second.report.complete, true);
  assert.equal(second.destinationsToAdd.length, 0);
  assert.equal(second.destinationsToRepair.length, 0);
  assert.ok(second.report.lists.every((list) =>
    list.added.length === 0 && list.removed.length === 0 && list.reorderedCount === 0
  ));
});

test("keeps Irish County Highpoints outside definitions and both fixtures", () => {
  const excludedSourceKey = "dobih-irish-county-highpoints";
  const excludedListId = deterministicKeeperListId("dobih:irish-county-highpoints");
  assert.ok(!DOBIH_OPEN_EIGHT_KEEPER_LISTS.some((list) =>
    list.sourceKey === excludedSourceKey || list.listId === excludedListId
  ));
  assert.ok(!(excludedSourceKey in fixture.lists));
  assert.ok(!(excludedSourceKey in resolutions.lists));
});

test("keeps the base-three and open-eight command bundles isolated", () => {
  assert.deepEqual(
    BASE_THREE_KEEPER_LISTS.map((list) => list.sourceKey),
    ["dobih-corbetts", "dobih-wainwrights", "uiaa-pyrenees-main"]
  );
  assert.ok(BASE_THREE_KEEPER_LISTS.every((baseList) =>
    !DOBIH_OPEN_EIGHT_KEEPER_LISTS.some((openList) => openList.listId === baseList.listId)
  ));
});

test("runs the open-eight command boundary with exact output, definitions, and cleanup", async () => {
  const report: KeeperImportReport = {
    mode: "stage-destinations",
    apply: true,
    complete: false,
    destinationsToAdd: [],
    destinationsToRepair: [],
    lists: [],
  };
  const readPaths: string[] = [];
  const output: string[] = [];
  const calls: unknown[][] = [];
  let releases = 0;
  let ends = 0;
  const client = { release: () => { releases += 1; } };
  const exitCode = await openEightCommand.runDobihOpenEightCommand([
    "--input=/tmp/open-eight-input.json",
    "--resolutions=/tmp/open-eight-resolutions.json",
    "--stage-destinations",
  ], {
    readFile: async (filePath) => {
      readPaths.push(filePath);
      return filePath.includes("resolutions")
        ? JSON.stringify(resolutions)
        : JSON.stringify(fixture);
    },
    connect: async () => client as never,
    end: async () => { ends += 1; },
    runKeeperImport: async (...args) => {
      calls.push(args);
      return report;
    },
    writeLine: (line) => output.push(line),
  });

  assert.equal(exitCode, 2);
  assert.deepEqual(readPaths, [
    "/tmp/open-eight-input.json",
    "/tmp/open-eight-resolutions.json",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], client);
  assert.deepEqual(calls[0][1], fixture);
  assert.deepEqual(calls[0][2], resolutions);
  assert.equal(calls[0][3], "stage-destinations");
  assert.equal(calls[0][4], DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  assert.deepEqual(output, [JSON.stringify(report, null, 2)]);
  assert.equal(releases, 1);
  assert.equal(ends, 1);
});

test("returns success and cleans up when the import is complete", async () => {
  let releases = 0;
  let ends = 0;
  const exitCode = await openEightCommand.runDobihOpenEightCommand([
    "--input=/tmp/open-eight-input.json",
    "--resolutions=/tmp/open-eight-resolutions.json",
  ], {
    readFile: async (filePath) => filePath.includes("resolutions")
      ? JSON.stringify(resolutions)
      : JSON.stringify(fixture),
    connect: async () => ({ release: () => { releases += 1; } }) as never,
    end: async () => { ends += 1; },
    runKeeperImport: async () => ({
      mode: "dry-run",
      apply: false,
      complete: true,
      destinationsToAdd: [],
      destinationsToRepair: [],
      lists: [],
    }),
    writeLine: () => {},
  });
  assert.equal(exitCode, 0);
  assert.equal(releases, 1);
  assert.equal(ends, 1);
});

test("returns review-needed when a publication check finds a gap", async () => {
  const exitCode = await openEightCommand.runDobihOpenEightCommand([
    "--input=/tmp/open-eight-input.json",
    "--resolutions=/tmp/open-eight-resolutions.json",
    "--check-publication",
  ], {
    readFile: async (filePath) => filePath.includes("resolutions")
      ? JSON.stringify(resolutions)
      : JSON.stringify(fixture),
    connect: async () => ({ release: () => {} }) as never,
    end: async () => {},
    runKeeperImport: async () => ({
      mode: "check-publication",
      apply: false,
      complete: true,
      destinationsToAdd: [],
      destinationsToRepair: [],
      lists: [],
      publication: {
        ready: false,
        stageRequired: { destinationAdditions: 0, destinationRepairs: 0 },
        destinations: [],
        activePeaksRoutesMissingCover: [{ id: "route-gap", name: "Route gap" }],
      },
    }),
    writeLine: () => {},
  });
  assert.equal(exitCode, 2);
});

test("maps command failures to exit code 1 through an injectable main boundary", async () => {
  const runMain = (openEightCommand as unknown as {
    runDobihOpenEightMain?: (
      argv: string[],
      overrides: openEightCommand.DobihOpenEightCommandOverrides
    ) => Promise<number>;
  }).runDobihOpenEightMain;
  assert.equal(typeof runMain, "function");
  const errors: string[] = [];
  let releases = 0;
  let ends = 0;
  const exitCode = await runMain!([
    "--input=/tmp/open-eight-input.json",
    "--resolutions=/tmp/open-eight-resolutions.json",
  ], {
    readFile: async (filePath) => filePath.includes("resolutions")
      ? JSON.stringify(resolutions)
      : JSON.stringify(fixture),
    connect: async () => ({ release: () => { releases += 1; } }) as never,
    end: async () => { ends += 1; },
    runKeeperImport: async () => {
      throw new Error("reviewed import failed");
    },
    writeError: (line: string) => errors.push(line),
  } as openEightCommand.DobihOpenEightCommandOverrides);
  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ["reviewed import failed"]);
  assert.equal(releases, 1);
  assert.equal(ends, 1);
});
