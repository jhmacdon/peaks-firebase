import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as keeperImporter from "../import-keeper-lists";
import {
  assertReviewedKeeperDestinations,
  buildKeeperImportReport,
  catalogWithReviewedKeeperDestinations,
  deterministicKeeperDestinationId,
  deterministicKeeperListId,
  deterministicOsmKeeperDestinationId,
  KeeperCatalogPeak,
  KeeperDestinationFingerprint,
  KeeperImportFixture,
  KeeperListDefinition,
  KeeperResolutionFixture,
  KEEPER_LISTS,
  normalizeKeeperPeakName,
  parseKeeperImportArgs,
  refreshAffectedDestinationAreaLinks,
  resolveKeeperList,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
} from "../import-keeper-lists";

const fixturePath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as KeeperImportFixture;
const resolutionsPath = path.resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/keeper-list-identity-resolutions-2026-08-30.json"
);
const resolutions = JSON.parse(readFileSync(resolutionsPath, "utf8")) as KeeperResolutionFixture;

const testSourceDescriptor = {
  fixtureSource: "test",
  keeperRosterSource: "test-source",
  assertMemberIdentity(_sourceKey: string): void {},
};

const onePeakList: KeeperListDefinition = {
  listId: "test-list",
  sourceKey: "test-source",
  sourceDescriptor: testSourceDescriptor,
  name: "Test List",
  description: "Test",
  expectedCount: 1,
  destinationOverrides: {},
  allowedCountryCodes: ["GB"],
  yearEstablished: null,
  organization: null,
  sourceName: "Keeper",
  sourceUrl: "https://example.test/list",
  region: "Test Region",
};

const onePeakFixture: KeeperImportFixture = {
  schemaVersion: 1,
  generatedAt: "2026-08-30",
  sources: {},
  lists: {
    "test-source": {
      source: "test",
      selection: "reviewed",
      rows: [{
        sourceMemberId: "keeper:1",
        ordinal: 1,
        name: "Pico de Prueba",
        aliases: ["Test Peak"],
        elevationM: 1_000,
        lat: 56,
        lng: -4,
      }],
    },
  },
};

const eligibleCatalogFields: Pick<
  KeeperCatalogPeak,
  "owner" | "destinationType" | "features"
> = {
  owner: "peaks",
  destinationType: "point",
  features: ["summit"],
};

function appliedRepairCatalogFields(
  name: string,
  sourceName: string,
  sourceUrl: string,
  sourceLicense: string | null
): Partial<KeeperCatalogPeak> {
  return {
    searchNameMatchesLowerName: true,
    metadataDisplayName: name,
    catalogAudit: "keeper-lists-2026-08-30",
    keeperIdentityRepairedAt: "2026-08-30",
    keeperRepairSourceName: sourceName,
    keeperRepairSourceUrl: sourceUrl,
    keeperRepairSourceLicense: sourceLicense,
    keeperRepairSourceLicensePresent: true,
  };
}

const catalogPeak: KeeperCatalogPeak = {
  id: "destination-1",
  name: "Test Peak",
  elevationM: 1_010,
  lat: 56.001,
  lng: -4.001,
  countryCode: "GB",
  stateCode: null,
  osmId: null,
  externalIds: {},
  ...eligibleCatalogFields,
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

function fullFixtureCatalogBeforeReview(): KeeperCatalogPeak[] {
  const byId = new Map<string, KeeperCatalogPeak>();
  const add = (peak: KeeperCatalogPeak) => {
    if (!byId.has(peak.id)) byId.set(peak.id, peak);
  };

  for (const repair of resolutions.catalogRepairs ?? []) {
    add(catalogPeakFromFingerprint(repair.destinationId, repair.before));
  }

  for (const definition of KEEPER_LISTS) {
    const reviewedBySourceId = new Map(
      resolutions.lists[definition.sourceKey].rows.map((row) => [row.sourceMemberId, row])
    );
    for (const source of fixture.lists[definition.sourceKey].rows) {
      const reviewed = reviewedBySourceId.get(source.sourceMemberId);
      if (!reviewed) {
        assert.equal(definition.allowedCountryCodes?.length, 1);
        assert.ok(Number.isFinite(source.lat) && Number.isFinite(source.lng));
        add({
          ...eligibleCatalogFields,
          id: `automatic:${source.sourceMemberId}`,
          name: source.name,
          elevationM: source.elevationM,
          lat: source.lat!,
          lng: source.lng!,
          countryCode: definition.allowedCountryCodes![0],
          stateCode: null,
          osmId: null,
          externalIds: {},
        });
        continue;
      }
      if (reviewed.resolution === "curated_destination") continue;
      if (reviewed.resolution === "catalog_repair") {
        add(catalogPeakFromFingerprint(reviewed.destinationId, reviewed.catalogBefore!));
        continue;
      }
      add({
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
      });
    }
  }
  return [...byId.values()];
}

function cloneKeeperFixture(): KeeperImportFixture {
  return JSON.parse(JSON.stringify(fixture)) as KeeperImportFixture;
}

function cloneKeeperResolutions(): KeeperResolutionFixture {
  return JSON.parse(JSON.stringify(resolutions)) as KeeperResolutionFixture;
}

function onePeakCatalogRepairResolution(
  externalIdAdditions: Record<string, string> = {}
): KeeperResolutionFixture {
  return {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: "keeper:1",
          resolution: "catalog_repair",
          destinationId: catalogPeak.id,
          destinationName: catalogPeak.name,
          destinationElevationM: 1_000,
          destinationLat: 56,
          destinationLng: -4,
          destinationOsmNodeId: null,
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationDataSourceName: "Reviewed survey",
          destinationDataSourceUrl: "https://example.test/survey",
          destinationDataLicense: null,
          catalogBefore: {
            name: catalogPeak.name,
            elevationM: catalogPeak.elevationM!,
            lat: catalogPeak.lat,
            lng: catalogPeak.lng,
            osmNodeId: catalogPeak.osmId,
            countryCode: catalogPeak.countryCode,
            stateCode: catalogPeak.stateCode,
            externalIds: catalogPeak.externalIds,
          },
          ...(Object.keys(externalIdAdditions).length > 0
            ? { catalogExternalIdAdditions: externalIdAdditions }
            : {}),
          evidence: ["The catalog point was a lower cairn on the same summit."],
        }],
      },
    },
  };
}

test("parses dry-run and apply modes with an explicit reviewed resolution fixture", () => {
  assert.deepEqual(parseKeeperImportArgs([
    "--input=/tmp/keeper.json",
    "--resolutions=/tmp/resolutions.json",
  ]), {
    input: "/tmp/keeper.json",
    resolutions: "/tmp/resolutions.json",
    apply: false,
  });
  assert.deepEqual(parseKeeperImportArgs([
    "--apply",
    "--input=/tmp/keeper.json",
    "--resolutions=/tmp/resolutions.json",
  ]), {
    input: "/tmp/keeper.json",
    resolutions: "/tmp/resolutions.json",
    apply: true,
  });
  assert.throws(() => parseKeeperImportArgs([]), /--input is required/);
  assert.throws(
    () => parseKeeperImportArgs(["--input=/tmp/keeper.json"]),
    /--resolutions is required/
  );
  assert.throws(
    () => parseKeeperImportArgs([
      "--input=/tmp/keeper.json",
      "--resolutions=/tmp/resolutions.json",
      "--force",
    ]),
    /Unknown option/
  );
});

test("uses stable keeper list IDs outside the Peakbagger namespace", () => {
  assert.equal(
    deterministicKeeperListId("dobih:corbetts"),
    deterministicKeeperListId("dobih:corbetts")
  );
  assert.equal(deterministicKeeperListId("dobih:corbetts").length, 20);
  assert.notEqual(
    deterministicKeeperListId("dobih:corbetts"),
    deterministicKeeperListId("dobih:wainwrights")
  );
  assert.equal(deterministicKeeperDestinationId("dobih:82").length, 20);
  assert.equal(
    deterministicKeeperDestinationId("dobih:82"),
    deterministicKeeperDestinationId("dobih:82")
  );
  assert.notEqual(
    deterministicKeeperDestinationId("dobih:82"),
    deterministicKeeperDestinationId("dobih:413")
  );
});

test("normalizes accents and punctuation without joining words", () => {
  assert.equal(
    normalizeKeeperPeakName("Pico Lézat"),
    normalizeKeeperPeakName("Pico Lezat")
  );
  assert.equal(
    normalizeKeeperPeakName("Dent d’Estibère-Male"),
    normalizeKeeperPeakName("Dent d Estibere Male")
  );
  assert.notEqual(normalizeKeeperPeakName("North Peak"), normalizeKeeperPeakName("Northpeak"));
});

test("keeps Korean letters and digits while folding marks and dashes", () => {
  assert.equal(normalizeKeeperPeakName("한라산"), "한라산");
  assert.equal(normalizeKeeperPeakName("남산(금오산)"), "남산 금오산");
  assert.equal(normalizeKeeperPeakName("백운산 20000004"), "백운산 20000004");
  assert.notEqual(normalizeKeeperPeakName("백운산"), normalizeKeeperPeakName("한라산"));
  assert.equal(
    normalizeKeeperPeakName("Pico Lézat—Nord"),
    normalizeKeeperPeakName("Pico Lezat Nord")
  );
});

test("pins the exact keeper fixture counts and durable identities", () => {
  validateKeeperFixture(fixture, KEEPER_LISTS);
  assert.equal(fixture.lists["dobih-corbetts"].rows.length, 222);
  assert.equal(fixture.lists["dobih-wainwrights"].rows.length, 214);
  assert.equal(fixture.lists["uiaa-pyrenees-main"].rows.length, 129);

  for (const sourceKey of ["dobih-corbetts", "dobih-wainwrights"]) {
    const rows = fixture.lists[sourceKey].rows;
    assert.equal(new Set(rows.map((row) => row.sourceMemberId)).size, rows.length);
    assert.ok(rows.every((row) => row.sourceMemberId === `dobih:${row.dobihNumber}`));
    assert.deepEqual(rows.map((row) => row.ordinal),
      Array.from({ length: rows.length }, (_, index) => index + 1));
  }

  const pyrenees = fixture.lists["uiaa-pyrenees-main"].rows;
  assert.deepEqual(pyrenees.map((row) => row.buyseMainNumber),
    Array.from({ length: 129 }, (_, index) => index + 1));
  assert.equal(pyrenees[71].sourceMemberId, "uiaa-pyrenees-main:072");
  assert.equal(pyrenees[71].name, "Tuca de Llardaneta");
  assert.equal(pyrenees[102].name, "Pico Le Bondidier");
  assert.equal(pyrenees[103].aliases?.[0], "Pico Cordier");
  assert.ok(!pyrenees.some((row) => row.name === "Pico Maubic"));
  assert.ok(!pyrenees.some((row) => row.name === "Punta Gabarró"));

  const pyreneesDefinition = KEEPER_LISTS.find(
    (list) => list.sourceKey === "uiaa-pyrenees-main"
  );
  assert.deepEqual(pyreneesDefinition?.allowedCountryCodes, ["ES", "FR"]);
  assert.doesNotMatch(pyreneesDefinition?.description ?? "", /Andorra/);
  assert.deepEqual(
    Object.fromEntries(
      resolutions.lists["uiaa-pyrenees-main"].rows.reduce((counts, row) => {
        counts.set(
          row.destinationCountryCode,
          (counts.get(row.destinationCountryCode) ?? 0) + 1
        );
        return counts;
      }, new Map<string, number>())
    ),
    { ES: 72, FR: 57 }
  );
});

test("pins official source versions, checksums, and DoBIH license", () => {
  const sources = fixture.sources as Record<string, Record<string, unknown>>;
  assert.equal(sources["dobih-v18.5"].version, "18.5");
  assert.equal(sources["dobih-v18.5"].releasedAt, "2026-07-26");
  assert.equal(sources["dobih-v18.5"].license, "CC BY 4.0");
  assert.equal(
    sources["dobih-v18.5"].archiveSha256,
    "0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021"
  );
  assert.equal(
    sources["uiaa-pyrenees-main"].identitySource,
    "UIAA Bulletin 152 (December 1995)"
  );
});

test("production keeper fixture rejects changed source metadata and list selectors", () => {
  const reorderedSourceKeys = cloneKeeperFixture();
  reorderedSourceKeys.sources = Object.fromEntries(
    Object.entries(reorderedSourceKeys.sources).reverse().map(([key, value]) => [
      key,
      Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()),
    ])
  );
  assert.doesNotThrow(() => validateKeeperFixture(reorderedSourceKeys, KEEPER_LISTS));

  const changedDate = cloneKeeperFixture();
  changedDate.generatedAt = "2026-08-31";
  assert.throws(() => validateKeeperFixture(changedDate, KEEPER_LISTS), /generated date/i);

  const changedSources = cloneKeeperFixture();
  const dobihSource = changedSources.sources["dobih-v18.5"] as Record<string, unknown>;
  dobihSource.csvSha256 = "f".repeat(64);
  assert.throws(
    () => validateKeeperFixture(changedSources, KEEPER_LISTS),
    /source metadata.*checksum/i
  );

  const changedSourceKey = cloneKeeperFixture();
  changedSourceKey.lists["dobih-corbetts"].source = "fabricated-source";
  assert.throws(
    () => validateKeeperFixture(changedSourceKey, KEEPER_LISTS),
    /source selector/i
  );

  const changedSelection = cloneKeeperFixture();
  changedSelection.lists["dobih-wainwrights"].selection = "W=maybe";
  assert.throws(() => validateKeeperFixture(changedSelection, KEEPER_LISTS), /selection/i);
});

test("production keeper fixture rejects reordered and source-inconsistent roster rows", () => {
  const reordered = cloneKeeperFixture();
  [reordered.lists["dobih-corbetts"].rows[0], reordered.lists["dobih-corbetts"].rows[1]] =
    [reordered.lists["dobih-corbetts"].rows[1], reordered.lists["dobih-corbetts"].rows[0]];
  assert.throws(
    () => validateKeeperFixture(reordered, KEEPER_LISTS),
    /ordered roster.*checksum/i
  );

  const wrongDobihIdentity = cloneKeeperFixture();
  wrongDobihIdentity.lists["dobih-corbetts"].rows[0].dobihNumber! += 1;
  assert.throws(
    () => validateKeeperFixture(wrongDobihIdentity, KEEPER_LISTS),
    /DoBIH.*source member ID/i
  );

  const wrongUiaaIdentity = cloneKeeperFixture();
  wrongUiaaIdentity.lists["uiaa-pyrenees-main"].rows[0].buyseMainNumber! += 1;
  assert.throws(
    () => validateKeeperFixture(wrongUiaaIdentity, KEEPER_LISTS),
    /UIAA.*ordinal.*source member ID/i
  );
});

test("credits the licensed data source while naming each British list keeper", () => {
  const bySource = new Map(KEEPER_LISTS.map((list) => [list.sourceKey, list]));
  for (const sourceKey of ["dobih-corbetts", "dobih-wainwrights"]) {
    assert.equal(
      bySource.get(sourceKey)?.sourceName,
      "The Database of British and Irish Hills (CC BY 4.0)"
    );
    assert.equal(
      bySource.get(sourceKey)?.sourceUrl,
      "https://www.hill-bagging.co.uk/dobih/downloads/"
    );
  }
  assert.equal(bySource.get("dobih-corbetts")?.organization, "Scottish Mountaineering Club");
  assert.equal(bySource.get("dobih-wainwrights")?.organization, "The Wainwright Society");
  assert.match(bySource.get("dobih-corbetts")?.description ?? "", /Scottish Mountaineering Club/);
  assert.match(bySource.get("dobih-wainwrights")?.description ?? "", /Wainwright Society/);
});

test("the reviewed identity fixture is complete, bounded, and tied to the source roster", () => {
  validateKeeperResolutionFixture(fixture, resolutions, KEEPER_LISTS);

  const reviewedRows = Object.values(resolutions.lists).flatMap((list) => list.rows);
  assert.equal(
    new Set(reviewedRows.map((row) => `${row.sourceKey}:${row.sourceMemberId}`)).size,
    reviewedRows.length
  );
  assert.ok(reviewedRows.every((row) => row.evidence.length > 0));
  assert.ok(reviewedRows.every((row) => row.destinationCountryCode != null));

  const reviewedCorbetts = reviewedRows
    .filter((row) => row.sourceKey === "dobih-corbetts")
    .map((row) => Number(row.sourceMemberId.slice("dobih:".length)))
    .filter((number) => [82, 413, 415, 596, 633, 744, 903, 1129, 1692, 1835]
      .includes(number))
    .sort((left, right) => left - right);
  assert.deepEqual(reviewedCorbetts, [82, 413, 415, 596, 633, 744, 903, 1129, 1692, 1835]);

  const corbettNew = reviewedRows
    .filter((row) => row.sourceKey === "dobih-corbetts" &&
      row.resolution === "curated_destination")
    .map((row) => Number(row.sourceMemberId.slice("dobih:".length)))
    .sort((left, right) => left - right);
  assert.deepEqual(corbettNew, [82, 413, 596, 744, 1129, 1835]);

  const corbettRepairs = reviewedRows
    .filter((row) => row.sourceKey === "dobih-corbetts" &&
      row.resolution === "catalog_repair")
    .map((row) => Number(row.sourceMemberId.slice("dobih:".length)))
    .sort((left, right) => left - right);
  assert.deepEqual(corbettRepairs, [415, 633, 903, 1692]);

  assert.equal(resolutions.catalogRepairs?.length, 7);
  assert.deepEqual(
    resolutions.catalogRepairs
      ?.filter((repair) => repair.before.name !== repair.after.name)
      .map((repair) => repair.after.name).sort(),
    [
      "Caudale Moor - John Bell's Banner",
      "Graystones (main summit)",
      "Leathad an Taobhain West Top",
      "Sgùrr nan Eugallt East Top",
      "Whinlatter Top",
    ]
  );
  assert.deepEqual(
    resolutions.catalogRepairs
      ?.filter((repair) => repair.externalIdRemovals != null)
      .map((repair) => repair.destinationId).sort(),
    [
      "208FE74EA95F01EE2B9E",
      "3EFC5121CAF83884A60B",
      "ECF3C098585FB14F174B",
      "F0BD492A5E3B8F01EB67",
    ]
  );
  assert.equal(
    resolutions.lists["dobih-wainwrights"].rows
      .find((row) => row.sourceMemberId === "dobih:2496")?.destinationId,
    "208FE74EA95F01EE2B9E"
  );

  const wainwrightNew = reviewedRows
    .filter((row) => row.sourceKey === "dobih-wainwrights" &&
      row.resolution === "curated_destination")
    .map((row) => Number(row.sourceMemberId.slice("dobih:".length)))
    .sort((left, right) => left - right);
  assert.deepEqual(wainwrightNew, [
    2327, 2371, 2413, 2430, 2459, 2477, 2489, 2523, 2543, 2564,
  ]);

  assert.equal(
    reviewedRows.find((row) => row.sourceKey === "dobih-wainwrights" &&
      row.sourceMemberId === "dobih:2528" && row.resolution === "catalog_repair")
      ?.destinationId,
    "lacAhOp5f1m1pnY4oFzT"
  );
  const highStreet = reviewedRows.find((row) => row.sourceMemberId === "dobih:2528");
  assert.deepEqual(highStreet?.catalogBefore?.externalIds, {});
  assert.deepEqual(highStreet?.catalogExternalIdAdditions, {
    osm: "12558883199",
    wikidata: "Q1617866",
  });

  const pyrenees = reviewedRows.filter((row) => row.sourceKey === "uiaa-pyrenees-main");
  assert.equal(pyrenees.length, 129);
  assert.deepEqual(pyrenees.map((row) => row.sourceMemberId),
    Array.from({ length: 129 }, (_, index) =>
      `uiaa-pyrenees-main:${String(index + 1).padStart(3, "0")}`));
});

test("the full reviewed keeper import is idempotent after its first catalog plan", () => {
  const first = catalogWithReviewedKeeperDestinations(
    fullFixtureCatalogBeforeReview(),
    fixture,
    resolutions,
    KEEPER_LISTS
  );
  assert.equal(first.destinationsToAdd.length, 62);
  assert.equal(first.destinationsToRepair.length, 13);

  const second = buildKeeperImportReport(
    fixture,
    resolutions,
    first.catalog,
    [],
    false,
    KEEPER_LISTS
  );
  assert.equal(second.report.complete, true);
  assert.equal(second.destinationsToAdd.length, 0);
  assert.equal(second.destinationsToRepair.length, 0);
  assert.equal(
    second.report.lists.reduce((sum, list) => sum + list.resolvedCount, 0),
    565
  );
});

test("only Peaks-owned point summits can match or receive catalog repairs", () => {
  assert.equal(resolveKeeperList(
    onePeakList,
    onePeakFixture.lists["test-source"],
    [catalogPeak]
  ).members.length, 1);
  for (const mutation of [
    { owner: "user" },
    { destinationType: "region" },
    { features: ["ridge"] },
  ] satisfies Array<Partial<KeeperCatalogPeak>>) {
    const ineligible = { ...catalogPeak, ...mutation };
    const resolved = resolveKeeperList(
      onePeakList,
      onePeakFixture.lists["test-source"],
      [ineligible]
    );
    assert.equal(resolved.members.length, 0);
    assert.equal(resolved.issues.length, 1);
    assert.throws(
      () => catalogWithReviewedKeeperDestinations(
        [ineligible],
        onePeakFixture,
        onePeakCatalogRepairResolution(),
        [onePeakList]
      ),
      /Peaks-owned point summit/
    );
  }
});

test("duplicate catalog OSM identities fail regardless of row order", () => {
  const left = {
    ...catalogPeak,
    id: "destination-a",
    osmId: "123",
    externalIds: { osm: "123" },
  };
  const right = {
    ...catalogPeak,
    id: "destination-b",
    osmId: "123",
    externalIds: { osm: "123" },
  };
  const emptyResolutions: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: { "test-source": { rows: [] } },
  };
  const errors = [[left, right], [right, left]].map((catalog) => {
    let message = "";
    try {
      catalogWithReviewedKeeperDestinations(
        catalog,
        onePeakFixture,
        emptyResolutions,
        [onePeakList]
      );
    } catch (error) {
      message = String(error);
    }
    assert.match(message, /OSM node 123.*destination-a, destination-b/);
    return message;
  });
  assert.equal(errors[0], errors[1]);
});

test("a curated OSM destination cannot reuse a globally owned noneligible OSM ID", () => {
  const reviewed: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: "keeper:1",
          resolution: "curated_destination",
          destinationId: deterministicOsmKeeperDestinationId("123"),
          destinationName: "Pico de Prueba",
          destinationElevationM: 1_000,
          destinationLat: 56,
          destinationLng: -4,
          destinationOsmNodeId: "123",
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationDataSourceName: "Test source",
          destinationDataSourceUrl: "https://example.test/source",
          destinationDataLicense: null,
          evidence: ["Reviewed test source"],
        }],
      },
    },
  };
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [],
      onePeakFixture,
      reviewed,
      [onePeakList],
      [{ destinationId: "noneligible-owner", key: "osm", value: "123" }]
    ),
    /OSM node 123 already belongs to destination noneligible-owner/
  );
});

test("curated destinations keep reviewed external IDs and reject another owner", () => {
  const reviewed: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: "keeper:1",
          resolution: "curated_destination",
          destinationId: deterministicOsmKeeperDestinationId("123"),
          destinationName: "Pico de Prueba",
          destinationElevationM: 1_000,
          destinationLat: 56,
          destinationLng: -4,
          destinationOsmNodeId: "123",
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationExternalIds: { osm: "123", wikidata: "Q123" },
          destinationDataSourceName: "Test source",
          destinationDataSourceUrl: "https://example.test/source",
          destinationDataLicense: null,
          evidence: ["Reviewed test source"],
        }],
      },
    },
  };
  const first = catalogWithReviewedKeeperDestinations(
    [], onePeakFixture, reviewed, [onePeakList]
  );
  assert.deepEqual(first.destinationsToAdd[0].externalIds, {
    osm: "123",
    wikidata: "Q123",
  });
  assert.deepEqual(first.catalog[0].externalIds, { osm: "123", wikidata: "Q123" });
  assert.equal(catalogWithReviewedKeeperDestinations(
    first.catalog, onePeakFixture, reviewed, [onePeakList]
  ).destinationsToAdd.length, 0);
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [],
      onePeakFixture,
      reviewed,
      [onePeakList],
      [{ destinationId: "other", key: "wikidata", value: "Q123" }]
    ),
    /requested external ID wikidata=Q123, but it belongs to other/
  );
});

test("reviewed new destinations are stable, unique, and cannot hide a catalog duplicate", () => {
  const reviewedRows = Object.values(resolutions.lists).flatMap((list) => list.rows);
  const curatedRows = reviewedRows.filter((row) => row.resolution === "curated_destination");
  assert.ok(curatedRows.length >= 19);
  assert.equal(new Set(curatedRows.map((row) => row.destinationId)).size, curatedRows.length);
  for (const row of curatedRows) {
    assert.equal(row.destinationId, row.destinationOsmNodeId == null
      ? deterministicKeeperDestinationId(row.sourceMemberId)
      : deterministicOsmKeeperDestinationId(row.destinationOsmNodeId));
    assert.ok(row.destinationDataSourceName?.trim());
    assert.match(row.destinationDataSourceUrl ?? "", /^https:\/\//);
  }

  const source = onePeakFixture.lists["test-source"].rows[0];
  const reviewed: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: source.sourceMemberId,
          resolution: "curated_destination",
          destinationId: deterministicKeeperDestinationId(source.sourceMemberId),
          destinationName: source.name,
          destinationElevationM: source.elevationM,
          destinationLat: source.lat!,
          destinationLng: source.lng!,
          destinationOsmNodeId: null,
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationDataSourceName: "Test source",
          destinationDataSourceUrl: "https://example.test/source",
          destinationDataLicense: null,
          evidence: ["Reviewed test source"],
        }],
      },
    },
  };
  const duplicate = { ...catalogPeak, name: "Different Alias", lat: source.lat!, lng: source.lng! };
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [duplicate],
      onePeakFixture,
      reviewed,
      [onePeakList]
    ),
    /within 150 m/
  );

  reviewed.lists["test-source"].rows[0].distinctFromDestinationIds = [duplicate.id];
  const distinct = catalogWithReviewedKeeperDestinations(
    [duplicate],
    onePeakFixture,
    reviewed,
    [onePeakList]
  );
  assert.equal(distinct.destinationsToAdd.length, 1);

  const reviewedDestination = distinct.destinationsToAdd[0];
  const exactCatalogAddition = distinct.catalog.find(
    (peak) => peak.id === reviewedDestination.id
  )!;
  assert.deepEqual({
    owner: exactCatalogAddition.owner,
    destinationType: exactCatalogAddition.destinationType,
    features: exactCatalogAddition.features,
    dataSourceName: exactCatalogAddition.dataSourceName,
    dataSourceUrl: exactCatalogAddition.dataSourceUrl,
    dataLicense: exactCatalogAddition.dataLicense,
    keeperRosterSource: exactCatalogAddition.keeperRosterSource,
    metadataDisplayName: exactCatalogAddition.metadataDisplayName,
  }, {
    owner: "peaks",
    destinationType: "point",
    features: ["summit"],
    dataSourceName: reviewedDestination.dataSourceName,
    dataSourceUrl: reviewedDestination.dataSourceUrl,
    dataLicense: reviewedDestination.dataLicense,
    keeperRosterSource: reviewedDestination.keeperRosterSource,
    metadataDisplayName: reviewedDestination.name,
  });
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [{
        ...exactCatalogAddition,
        name: `${reviewedDestination.name}!`,
        elevationM: reviewedDestination.elevationM + 0.5,
        lat: reviewedDestination.lat + 0.00001,
      }],
      onePeakFixture,
      reviewed,
      [onePeakList]
    ),
    /exact reviewed fingerprint/
  );
  for (const mutation of [
    { owner: "user" },
    { destinationType: "area" },
    { features: ["ridge"] },
    { dataSourceName: "Wrong source" },
    { dataSourceUrl: "https://example.test/wrong" },
    { dataLicense: "Wrong license" },
    { keeperRosterSource: "dobih-v18.5" },
    { metadataDisplayName: "Wrong display name" },
  ] satisfies Array<Partial<KeeperCatalogPeak>>) {
    assert.throws(
      () => catalogWithReviewedKeeperDestinations(
        [{ ...exactCatalogAddition, ...mutation }],
        onePeakFixture,
        reviewed,
        [onePeakList]
      ),
      /exact reviewed fingerprint/
    );
  }
});

test("post-conflict destination verification requires the exact reviewed fingerprint", async () => {
  const destination = catalogWithReviewedKeeperDestinations(
    [],
    onePeakFixture,
    {
      schemaVersion: 1,
      reviewedAt: "2026-08-30",
      catalogSnapshotSha256: "a".repeat(64),
      lists: {
        "test-source": {
          rows: [{
            sourceKey: "test-source",
            sourceMemberId: "keeper:1",
            resolution: "curated_destination",
            destinationId: deterministicKeeperDestinationId("keeper:1"),
            destinationName: "Pico de Prueba",
            destinationElevationM: 1_000,
            destinationLat: 56,
            destinationLng: -4,
            destinationOsmNodeId: null,
            destinationCountryCode: "GB",
            destinationStateCode: null,
            destinationDataSourceName: "Test source",
            destinationDataSourceUrl: "https://example.test/source",
            destinationDataLicense: null,
            evidence: ["Reviewed test source"],
          }],
        },
      },
    },
    [onePeakList]
  ).destinationsToAdd[0];
  const clientFor = (row: Record<string, unknown>) => ({
    query: async () => ({
      rows: [row],
      rowCount: 1,
    }),
  });
  const exactPersistedRow = {
    id: destination.id,
    name: destination.name,
    elevation_m: destination.elevationM,
    lat: destination.lat,
    lng: destination.lng,
    osm_id: destination.osmId,
    external_ids: {},
    country_code: destination.countryCode,
    state_code: destination.stateCode,
    owner: "peaks",
    destination_type: "point",
    features: ["summit"],
    metadata_source: destination.dataSourceName,
    metadata_source_url: destination.dataSourceUrl,
    metadata_source_license: destination.dataLicense,
    keeper_roster_source: destination.keeperRosterSource,
    metadata_display_name: destination.name,
  };
  await assert.rejects(
    () => assertReviewedKeeperDestinations(clientFor({
      ...exactPersistedRow,
      name: `${destination.name}!`,
      elevation_m: destination.elevationM + 0.5,
      lat: destination.lat + 0.00001,
    }) as never, [destination]),
    /exact reviewed fingerprint/
  );
  for (const mutation of [
    { owner: "user" },
    { destination_type: "area" },
    { features: ["ridge"] },
    { metadata_source: "Wrong source" },
    { metadata_source_url: "https://example.test/wrong" },
    { metadata_source_license: "Wrong license" },
    { keeper_roster_source: "dobih-v18.5" },
    { metadata_display_name: "Wrong display name" },
  ]) {
    await assert.rejects(
      () => assertReviewedKeeperDestinations(
        clientFor({ ...exactPersistedRow, ...mutation }) as never,
        [destination]
      ),
      /exact reviewed fingerprint/
    );
  }
  await assert.doesNotReject(
    () => assertReviewedKeeperDestinations(
      clientFor(exactPersistedRow) as never,
      [destination]
    )
  );
  for (const claims of [
    [
      { destination_id: "destination-a", key: "osm", value: "123" },
      { destination_id: "destination-b", key: "osm", value: "123" },
    ],
    [
      { destination_id: "destination-b", key: "osm", value: "123" },
      { destination_id: "destination-a", key: "osm", value: "123" },
    ],
  ]) {
    await assert.rejects(
      () => assertReviewedKeeperDestinations({
        query: async (sql: string) => ({
          rows: sql.includes("jsonb_each_text") ? claims : [exactPersistedRow],
          rowCount: sql.includes("jsonb_each_text") ? claims.length : 1,
        }),
      } as never, [destination]),
      /OSM node 123.*destination-a, destination-b/
    );
  }
});

test("all keeper fixture coordinates are bounded before distance checks", () => {
  const invalidSource = JSON.parse(JSON.stringify(onePeakFixture)) as KeeperImportFixture;
  invalidSource.lists["test-source"].rows[0].lat = 91;
  assert.throws(
    () => validateKeeperFixture(invalidSource, [onePeakList]),
    /source coordinates.*bounds/i
  );

  const periodicDestination: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: "keeper:1",
          resolution: "curated_destination",
          destinationId: deterministicKeeperDestinationId("keeper:1"),
          destinationName: "Pico de Prueba",
          destinationElevationM: 1_000,
          destinationLat: 416,
          destinationLng: 356,
          destinationOsmNodeId: null,
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationDataSourceName: "Test source",
          destinationDataSourceUrl: "https://example.test/source",
          destinationDataLicense: null,
          evidence: ["Periodic coordinates must not pass haversine."],
        }],
      },
    },
  };
  assert.throws(
    () => validateKeeperResolutionFixture(
      onePeakFixture,
      periodicDestination,
      [onePeakList]
    ),
    /destination coordinates.*bounds/i
  );

  const invalidAuxiliaryBefore = cloneKeeperResolutions();
  invalidAuxiliaryBefore.catalogRepairs![0].before.lat = 91;
  assert.throws(
    () => validateKeeperResolutionFixture(fixture, invalidAuxiliaryBefore, KEEPER_LISTS),
    /auxiliary.*before coordinates.*bounds/i
  );

  const invalidAuxiliaryAfter = cloneKeeperResolutions();
  invalidAuxiliaryAfter.catalogRepairs![0].after.lng = 181;
  assert.throws(
    () => validateKeeperResolutionFixture(fixture, invalidAuxiliaryAfter, KEEPER_LISTS),
    /auxiliary.*after coordinates.*bounds/i
  );

  const invalidCatalogBefore = cloneKeeperResolutions();
  const catalogRepair = Object.values(invalidCatalogBefore.lists)
    .flatMap((list) => list.rows)
    .find((row) => row.resolution === "catalog_repair")!;
  catalogRepair.catalogBefore!.lat = 91;
  assert.throws(
    () => validateKeeperResolutionFixture(fixture, invalidCatalogBefore, KEEPER_LISTS),
    /catalog-before coordinates.*bounds/i
  );
});

test("malformed resolution strings and external IDs fail with keeper validation errors", () => {
  const numericAuxiliaryExternalId = cloneKeeperResolutions();
  numericAuxiliaryExternalId.catalogRepairs![0].before.externalIds = {
    osm: 123 as unknown as string,
  };
  assert.throws(
    () => validateKeeperResolutionFixture(fixture, numericAuxiliaryExternalId, KEEPER_LISTS),
    /invalid external-ID record/i
  );

  const numericCatalogBeforeExternalId = cloneKeeperResolutions();
  const catalogRepair = Object.values(numericCatalogBeforeExternalId.lists)
    .flatMap((list) => list.rows)
    .find((row) => row.resolution === "catalog_repair")!;
  catalogRepair.catalogBefore!.externalIds = { osm: 123 as unknown as string };
  assert.throws(
    () => validateKeeperResolutionFixture(
      fixture,
      numericCatalogBeforeExternalId,
      KEEPER_LISTS
    ),
    /invalid external-ID record/i
  );

  const numericDestinationName = cloneKeeperResolutions();
  numericDestinationName.lists["dobih-corbetts"].rows[0].destinationName =
    123 as unknown as string;
  assert.throws(
    () => validateKeeperResolutionFixture(fixture, numericDestinationName, KEEPER_LISTS),
    /incomplete destination fingerprint/i
  );
});

test("catalog repairs pin the old identity and keep the same OSM source", () => {
  const repair: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    lists: {
      "test-source": {
        rows: [{
          sourceKey: "test-source",
          sourceMemberId: "keeper:1",
          resolution: "catalog_repair",
          destinationId: catalogPeak.id,
          destinationName: catalogPeak.name,
          destinationElevationM: 1_000,
          destinationLat: 56,
          destinationLng: -4,
          destinationOsmNodeId: null,
          destinationCountryCode: "GB",
          destinationStateCode: null,
          destinationDataSourceName: "Reviewed survey",
          destinationDataSourceUrl: "https://example.test/survey",
          destinationDataLicense: null,
          catalogBefore: {
            name: catalogPeak.name,
            elevationM: catalogPeak.elevationM!,
            lat: catalogPeak.lat,
            lng: catalogPeak.lng,
            osmNodeId: catalogPeak.osmId,
            countryCode: catalogPeak.countryCode!,
            stateCode: catalogPeak.stateCode,
            externalIds: catalogPeak.externalIds,
          },
          evidence: ["The catalog point was a lower cairn on the same summit."],
        }],
      },
    },
  };
  const reviewed = catalogWithReviewedKeeperDestinations(
    [catalogPeak],
    onePeakFixture,
    repair,
    [onePeakList]
  );
  assert.equal(reviewed.destinationsToRepair.length, 1);
  assert.deepEqual(
    reviewed.catalog.find((peak) => peak.id === catalogPeak.id),
    {
      ...catalogPeak,
      elevationM: 1_000,
      lat: 56,
      lng: -4,
      ...appliedRepairCatalogFields(
        catalogPeak.name,
        "Reviewed survey",
        "https://example.test/survey",
        null
      ),
    }
  );
  const rerun = catalogWithReviewedKeeperDestinations(
    reviewed.catalog,
    onePeakFixture,
    repair,
    [onePeakList]
  );
  assert.equal(rerun.destinationsToRepair.length, 0);
  assert.equal(
    rerun.definitions[0].destinationOverrides["keeper:1"],
    catalogPeak.id
  );
  for (const mutation of [
    { searchNameMatchesLowerName: false },
    { metadataDisplayName: "Stale display name" },
    { catalogAudit: "stale-audit" },
    { keeperIdentityRepairedAt: "2026-08-29" },
    { keeperRepairSourceName: "Stale source" },
    { keeperRepairSourceUrl: "https://example.test/stale" },
    { keeperRepairSourceLicense: "Stale license" },
    { keeperRepairSourceLicensePresent: false },
  ] satisfies Array<Partial<KeeperCatalogPeak>>) {
    assert.throws(
      () => catalogWithReviewedKeeperDestinations(
        reviewed.catalog.map((peak) => peak.id === catalogPeak.id
          ? { ...peak, ...mutation }
          : peak),
        onePeakFixture,
        repair,
        [onePeakList]
      ),
      /incomplete applied repair state/
    );
  }
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      reviewed.catalog.map((peak) => peak.id === catalogPeak.id
        ? { ...peak, elevationM: 1_000.5 }
        : peak),
      onePeakFixture,
      repair,
      [onePeakList]
    ),
    /exact reviewed after fingerprint/
  );
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      reviewed.catalog.map((peak) => peak.id === catalogPeak.id
        ? { ...peak, elevationM: 1_002 }
        : peak),
      onePeakFixture,
      repair,
      [onePeakList]
    ),
    /neither its exact reviewed before fingerprint nor exact reviewed after fingerprint/
  );

  repair.lists["test-source"].rows[0].destinationOsmNodeId = "123";
  repair.lists["test-source"].rows[0].catalogExternalIdAdditions = { osm: "123" };
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [catalogPeak, {
        ...catalogPeak,
        id: "other-destination",
        osmId: "123",
        externalIds: { osm: "123" },
      }],
      onePeakFixture,
      repair,
      [onePeakList]
    ),
    /requested external ID osm=123.*other-destination/
  );
  repair.lists["test-source"].rows[0].catalogExternalIdAdditions = undefined;
  assert.throws(
    () => validateKeeperResolutionFixture(onePeakFixture, repair, [onePeakList]),
    /does not pin its after OSM identity/
  );
});

test("catalog repair before-state uses exact fields and a five-metre point bound", () => {
  const repair = onePeakCatalogRepairResolution();
  for (const drift of [
    { name: `${catalogPeak.name}!` },
    { elevationM: catalogPeak.elevationM! + 0.5 },
  ]) {
    assert.throws(
      () => catalogWithReviewedKeeperDestinations(
        [{ ...catalogPeak, ...drift }],
        onePeakFixture,
        repair,
        [onePeakList]
      ),
      /exact reviewed before fingerprint/
    );
  }
  assert.equal(catalogWithReviewedKeeperDestinations(
    [{ ...catalogPeak, lat: catalogPeak.lat + 0.00004 }],
    onePeakFixture,
    repair,
    [onePeakList]
  ).destinationsToRepair.length, 1);
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [{ ...catalogPeak, lat: catalogPeak.lat + 0.00006 }],
      onePeakFixture,
      repair,
      [onePeakList]
    ),
    /reviewed before fingerprint/
  );
});

test("requested external-ID additions reject only owners of the requested value", () => {
  const requested = onePeakCatalogRepairResolution({ wikidata: "Q123" });
  const owner = {
    ...catalogPeak,
    id: "other-destination",
    name: "Other Summit",
    externalIds: { wikidata: "Q123" },
  };
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [catalogPeak, owner],
      onePeakFixture,
      requested,
      [onePeakList]
    ),
    /requested external ID wikidata=Q123.*other-destination/
  );
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [catalogPeak],
      onePeakFixture,
      requested,
      [onePeakList],
      [{ destinationId: "noneligible-owner", key: "wikidata", value: "Q123" }]
    ),
    /requested external ID wikidata=Q123.*noneligible-owner/
  );

  const unrelatedDuplicateOwners = ["duplicate-a", "duplicate-b"].map((id) => ({
    ...owner,
    id,
    externalIds: { wikidata: "Q999" },
  }));
  assert.equal(catalogWithReviewedKeeperDestinations(
    [catalogPeak, ...unrelatedDuplicateOwners],
    onePeakFixture,
    requested,
    [onePeakList]
  ).destinationsToRepair.length, 1);
});

test("external-ID repairs pin exact before and after JSON", () => {
  const peak = {
    ...catalogPeak,
    osmId: "123",
    externalIds: { osm: "123", wikidata: "Q1" },
  };
  const before = {
    name: peak.name,
    elevationM: peak.elevationM!,
    lat: peak.lat,
    lng: peak.lng,
    osmNodeId: peak.osmId,
    countryCode: peak.countryCode!,
    stateCode: peak.stateCode,
    externalIds: peak.externalIds,
  };
  const reviewed: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: "a".repeat(64),
    catalogRepairs: [{
      repairId: "test:wrong-wikidata",
      destinationId: peak.id,
      before,
      after: { ...before, externalIds: { osm: "123" } },
      dataSourceName: "Reviewed source",
      dataSourceUrl: "https://example.test/review",
      dataLicense: null,
      externalIdRemovals: { wikidata: "Q1" },
      evidence: ["Q1 belongs to another physical summit."],
    }],
    lists: { "test-source": { rows: [] } },
  };
  const plan = catalogWithReviewedKeeperDestinations(
    [peak], onePeakFixture, reviewed, [onePeakList]
  );
  assert.deepEqual(plan.destinationsToRepair[0].externalIdRemovals, { wikidata: "Q1" });
  assert.deepEqual(plan.catalog[0].externalIds, { osm: "123" });
  assert.deepEqual(
    {
      searchNameMatchesLowerName: plan.catalog[0].searchNameMatchesLowerName,
      metadataDisplayName: plan.catalog[0].metadataDisplayName,
      catalogAudit: plan.catalog[0].catalogAudit,
      keeperIdentityRepairedAt: plan.catalog[0].keeperIdentityRepairedAt,
      keeperRepairSourceName: plan.catalog[0].keeperRepairSourceName,
      keeperRepairSourceUrl: plan.catalog[0].keeperRepairSourceUrl,
      keeperRepairSourceLicense: plan.catalog[0].keeperRepairSourceLicense,
      keeperRepairSourceLicensePresent: plan.catalog[0].keeperRepairSourceLicensePresent,
    },
    appliedRepairCatalogFields(
      peak.name,
      "Reviewed source",
      "https://example.test/review",
      null
    )
  );
  const rerun = catalogWithReviewedKeeperDestinations(
    plan.catalog, onePeakFixture, reviewed, [onePeakList]
  );
  assert.equal(rerun.destinationsToRepair.length, 0);
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      plan.catalog.map((candidate) => candidate.id === peak.id
        ? { ...candidate, metadataDisplayName: "Stale display name" }
        : candidate),
      onePeakFixture,
      reviewed,
      [onePeakList]
    ),
    /incomplete applied repair state/
  );
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      plan.catalog.map((candidate) => candidate.id === peak.id
        ? { ...candidate, name: `${candidate.name}!` }
        : candidate),
      onePeakFixture,
      reviewed,
      [onePeakList]
    ),
    /exact reviewed after fingerprint/
  );

  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      [{ ...peak, externalIds: { osm: "123", wikidata: "Q2" } }],
      onePeakFixture,
      reviewed,
      [onePeakList]
    ),
    /neither its exact reviewed before fingerprint nor exact reviewed after fingerprint/
  );
  reviewed.catalogRepairs![0].after.externalIds = { osm: "123", wikidata: "Q9" };
  assert.throws(
    () => validateKeeperResolutionFixture(onePeakFixture, reviewed, [onePeakList]),
    /wrong after external-ID set/
  );
});

test("catalog repair apply guards eligibility and verifies persisted state", async () => {
  const plan = catalogWithReviewedKeeperDestinations(
    [catalogPeak],
    onePeakFixture,
    onePeakCatalogRepairResolution({ wikidata: "Q123" }),
    [onePeakList]
  );
  const applyRepairs = (keeperImporter as unknown as {
    applyReviewedKeeperCatalogRepairs?: (
      client: never,
      repairs: typeof plan.destinationsToRepair
    ) => Promise<void>;
  }).applyReviewedKeeperCatalogRepairs;
  assert.equal(typeof applyRepairs, "function");

  const persistedRepair = {
    id: catalogPeak.id,
    external_ids: { wikidata: "Q123" },
    metadata_names: { display: catalogPeak.name },
    name_matches: true,
    elevation_matches: true,
    location_matches: true,
    country_code_matches: true,
    state_code_matches: true,
    osm_id_matches: true,
    owner_matches: true,
    type_matches: true,
    summit_matches: true,
    search_name_matches: true,
    display_name_matches: true,
    catalog_audit_matches: true,
    keeper_identity_repaired_at_matches: true,
    keeper_repair_source_matches: true,
    keeper_repair_source_url_matches: true,
    keeper_repair_source_license_matches: true,
  };
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const clientFor = (row: typeof persistedRepair) => ({
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rowCount: 1, rows: [row] };
    },
  });
  const client = clientFor(persistedRepair);
  await applyRepairs!(client as never, plan.destinationsToRepair);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /owner = 'peaks'/);
  assert.match(queries[0].sql, /type = 'point'/);
  assert.match(queries[0].sql, /'summit'::destination_feature = ANY\(features\)/);
  assert.match(queries[0].sql, /NOT EXISTS[\s\S]*external_ids->>/);

  for (const field of [
    "name_matches",
    "elevation_matches",
    "location_matches",
    "country_code_matches",
    "state_code_matches",
    "osm_id_matches",
    "owner_matches",
    "type_matches",
    "summit_matches",
    "search_name_matches",
    "display_name_matches",
    "catalog_audit_matches",
    "keeper_identity_repaired_at_matches",
    "keeper_repair_source_matches",
    "keeper_repair_source_url_matches",
    "keeper_repair_source_license_matches",
  ] as const) {
    await assert.rejects(
      () => applyRepairs!(
        clientFor({ ...persistedRepair, [field]: false }) as never,
        plan.destinationsToRepair
      ),
      /did not persist its reviewed fingerprint/
    );
  }
  await assert.rejects(
    () => applyRepairs!(
      clientFor({ ...persistedRepair, external_ids: { wikidata: "Q999" } }) as never,
      plan.destinationsToRepair
    ),
    /did not persist its reviewed fingerprint/
  );

  await assert.rejects(
    () => applyRepairs!({
      query: async () => ({ rowCount: 0, rows: [] }),
    } as never, plan.destinationsToRepair),
    /did not persist its reviewed fingerprint/
  );
});

test("keeper import transactions use serializable apply and read-only dry-run modes", async () => {
  const beginTransaction = (keeperImporter as unknown as {
    beginKeeperImportTransaction?: (client: never, apply: boolean) => Promise<void>;
  }).beginKeeperImportTransaction;
  assert.equal(typeof beginTransaction, "function");
  const sql: string[] = [];
  const client = {
    query: async (statement: string) => {
      sql.push(statement);
      return { rows: [], rowCount: 0 };
    },
  };
  await beginTransaction!(client as never, true);
  await beginTransaction!(client as never, false);
  assert.deepEqual(sql, [
    "BEGIN ISOLATION LEVEL SERIALIZABLE",
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  ]);
});

test("refreshes only postgis area links for changed destinations", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
  };
  await refreshAffectedDestinationAreaLinks(
    client as never,
    ["destination-b", "destination-a", "destination-b"]
  );
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /DELETE FROM destination_areas/);
  assert.match(queries[0].sql, /source = 'postgis'/);
  assert.doesNotMatch(queries[0].sql, /source\s*<>/);
  assert.deepEqual(queries[0].values, [["destination-a", "destination-b"]]);
  assert.match(queries[1].sql, /INSERT INTO destination_areas/);
  assert.match(queries[1].sql, /ST_Covers/);
  assert.deepEqual(queries[1].values, [["destination-a", "destination-b"], 50]);
});

test("resolves a reviewed alias only inside the elevation, distance, and country bounds", () => {
  const result = resolveKeeperList(
    onePeakList,
    onePeakFixture.lists["test-source"],
    [catalogPeak]
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.members, [{
    destinationId: "destination-1",
    ordinal: 0,
    sourceMemberId: "keeper:1",
    sourceName: "Pico de Prueba",
  }]);

  assert.equal(resolveKeeperList(
    onePeakList,
    onePeakFixture.lists["test-source"],
    [{ ...catalogPeak, countryCode: "FR" }]
  ).issues.length, 1);
  assert.equal(resolveKeeperList(
    onePeakList,
    onePeakFixture.lists["test-source"],
    [{ ...catalogPeak, lat: 57 }]
  ).issues.length, 1);
  assert.equal(resolveKeeperList(
    onePeakList,
    onePeakFixture.lists["test-source"],
    [{ ...catalogPeak, elevationM: 1_101 }]
  ).issues.length, 1);
});

test("reports all unresolved rows and nearby alias candidates without auto-matching them", () => {
  const twoPeakList = { ...onePeakList, expectedCount: 2 };
  const source = {
    ...onePeakFixture.lists["test-source"],
    rows: [
      onePeakFixture.lists["test-source"].rows[0],
      {
        sourceMemberId: "keeper:2",
        ordinal: 2,
        name: "Another Keeper Name",
        elevationM: 1_020,
        lat: 56.001,
        lng: -4.001,
      },
    ],
  };
  const result = resolveKeeperList(twoPeakList, source, [
    { ...catalogPeak, name: "Nearby Catalog Alias" },
  ]);
  assert.equal(result.members.length, 0);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.issues.map((issue) => issue.sourceMemberId), ["keeper:1", "keeper:2"]);
  assert.ok(result.issues.every((issue) => issue.candidates[0]?.name === "Nearby Catalog Alias"));
});

test("reviewed overrides still obey source geography and height", () => {
  const overridden = {
    ...onePeakList,
    destinationOverrides: { "keeper:1": "destination-1" },
  };
  assert.equal(resolveKeeperList(
    overridden,
    onePeakFixture.lists["test-source"],
    [catalogPeak]
  ).issues.length, 0);
  assert.match(resolveKeeperList(
    overridden,
    onePeakFixture.lists["test-source"],
    [{ ...catalogPeak, lat: 57 }]
  ).issues[0].reason, /250 m/);
  assert.match(resolveKeeperList(
    overridden,
    onePeakFixture.lists["test-source"],
    [{ ...catalogPeak, elevationM: 1_101 }]
  ).issues[0].reason, /100 m/);
  assert.match(resolveKeeperList(
    { ...overridden, destinationOverrides: { "keeper:1": "missing" } },
    onePeakFixture.lists["test-source"],
    [catalogPeak]
  ).issues[0].reason, /is missing/);
});

test("fails closed when two source rows resolve to one destination", () => {
  const duplicateList = { ...onePeakList, expectedCount: 2 };
  const duplicateSource = {
    ...onePeakFixture.lists["test-source"],
    rows: [
      onePeakFixture.lists["test-source"].rows[0],
      {
        ...onePeakFixture.lists["test-source"].rows[0],
        sourceMemberId: "keeper:2",
        ordinal: 2,
      },
    ],
  };
  const result = resolveKeeperList(duplicateList, duplicateSource, [catalogPeak]);
  assert.equal(result.members.length, 0);
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.every((issue) => /two source members/.test(issue.reason)));
});

test("reports an incomplete plan and never relabels it as valid", () => {
  const { report, plans } = buildKeeperImportReport(
    onePeakFixture,
    { schemaVersion: 1, reviewedAt: "2026-08-30", catalogSnapshotSha256: "a".repeat(64),
      lists: { "test-source": { rows: [] } } },
    [],
    [],
    false,
    [onePeakList]
  );
  assert.equal(report.complete, false);
  assert.equal(report.lists[0].expectedCount, 1);
  assert.equal(report.lists[0].resolvedCount, 0);
  assert.equal(report.lists[0].unresolvedCount, 1);
  assert.equal(plans[0].members.length, 0);
});

test("the keeper importer does not write keeper IDs into destination external IDs", () => {
  const source = readFileSync(path.resolve(
    __dirname,
    "../keeper-list-import/core.ts"
  ), "utf8");
  assert.doesNotMatch(source, /jsonb_build_object\(['"]peakbagger/);
  assert.doesNotMatch(source, /destinationPeakbaggerId/);
  assert.match(
    source,
    /FROM destinations[\s\S]*owner = 'peaks'[\s\S]*type = 'point'[\s\S]*ANY\(features\)/
  );
  assert.match(source, /assertReviewedKeeperDestinations/);
  assert.match(source, /did not persist with its exact reviewed fingerprint/);
  assert.match(source, /keeper_roster_source/);
  assert.match(source, /'keeper_roster_source', incoming\.keeper_roster_source/);
  assert.match(source, /osm_id text, external_ids jsonb/);
  assert.match(source, /incoming\.external_ids/);
  assert.doesNotMatch(source, /sourceKey\.startsWith\("dobih-"\)/);
  assert.doesNotMatch(source, /CASE WHEN incoming\.source_key LIKE 'dobih-%'/);
  assert.match(source, /COALESCE\(metadata->'names', '\{\}'::jsonb\)/);
  assert.match(source, /jsonb_build_object\('display', \$2\)/);
  assert.deepEqual(KEEPER_LISTS.map((list) => list.expectedCount), [222, 214, 129]);

  const audit = readFileSync(path.resolve(
    __dirname,
    "../../../../docs/data-audits/keeper-lists-2026-08-30.md"
  ), "utf8");
  assert.doesNotMatch(audit, /exact old names, points, heights/);
  assert.match(audit, /checks old names, heights[\s\S]*exactly[\s\S]*within 5 metres/);
});

test("fixture validation rejects missing, duplicate, and partial source records", () => {
  assert.throws(
    () => validateKeeperFixture(onePeakFixture, [
      onePeakList,
      { ...onePeakList, listId: "other-list" },
    ]),
    /repeated source key/i
  );
  assert.throws(
    () => validateKeeperFixture(onePeakFixture, [
      onePeakList,
      { ...onePeakList, sourceKey: "other-source" },
    ]),
    /repeated list ID/i
  );
  assert.throws(
    () => validateKeeperFixture(
      { ...onePeakFixture, schemaVersion: 2 },
      [onePeakList]
    ),
    /Unsupported keeper fixture schema/
  );
  assert.throws(
    () => validateKeeperFixture({
      ...onePeakFixture,
      lists: {
        "test-source": {
          ...onePeakFixture.lists["test-source"],
          rows: [
            onePeakFixture.lists["test-source"].rows[0],
            onePeakFixture.lists["test-source"].rows[0],
          ],
        },
      },
    }, [{ ...onePeakList, expectedCount: 2 }]),
    /repeats or omits/
  );
  assert.throws(
    () => validateKeeperFixture({
      ...onePeakFixture,
      lists: {
        "test-source": {
          ...onePeakFixture.lists["test-source"],
          rows: [{ ...onePeakFixture.lists["test-source"].rows[0], lng: undefined }],
        },
      },
    }, [onePeakList]),
    /partial coordinates/
  );
  assert.throws(
    () => validateKeeperFixture({
      ...onePeakFixture,
      lists: {
        "test-source": {
          ...onePeakFixture.lists["test-source"],
          rows: [
            onePeakFixture.lists["test-source"].rows[0],
            {
              ...onePeakFixture.lists["test-source"].rows[0],
              sourceMemberId: "keeper:2",
              ordinal: 3,
            },
          ],
        },
      },
    }, [{ ...onePeakList, expectedCount: 2 }]),
    /contiguous/
  );
});
