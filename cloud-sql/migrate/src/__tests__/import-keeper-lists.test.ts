import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
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

const onePeakList: KeeperListDefinition = {
  listId: "test-list",
  sourceKey: "test-source",
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
};

function catalogPeakFromFingerprint(
  id: string,
  fingerprint: KeeperDestinationFingerprint
): KeeperCatalogPeak {
  return {
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

test("pins the exact keeper fixture counts and durable identities", () => {
  validateKeeperFixture(fixture);
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
  assert.doesNotThrow(() => validateKeeperFixture(reorderedSourceKeys));

  const changedDate = cloneKeeperFixture();
  changedDate.generatedAt = "2026-08-31";
  assert.throws(() => validateKeeperFixture(changedDate), /generated date/i);

  const changedSources = cloneKeeperFixture();
  const dobihSource = changedSources.sources["dobih-v18.5"] as Record<string, unknown>;
  dobihSource.csvSha256 = "f".repeat(64);
  assert.throws(() => validateKeeperFixture(changedSources), /source metadata.*checksum/i);

  const changedSourceKey = cloneKeeperFixture();
  changedSourceKey.lists["dobih-corbetts"].source = "fabricated-source";
  assert.throws(() => validateKeeperFixture(changedSourceKey), /source selector/i);

  const changedSelection = cloneKeeperFixture();
  changedSelection.lists["dobih-wainwrights"].selection = "W=maybe";
  assert.throws(() => validateKeeperFixture(changedSelection), /selection/i);
});

test("production keeper fixture rejects reordered and source-inconsistent roster rows", () => {
  const reordered = cloneKeeperFixture();
  [reordered.lists["dobih-corbetts"].rows[0], reordered.lists["dobih-corbetts"].rows[1]] =
    [reordered.lists["dobih-corbetts"].rows[1], reordered.lists["dobih-corbetts"].rows[0]];
  assert.throws(() => validateKeeperFixture(reordered), /ordered roster.*checksum/i);

  const wrongDobihIdentity = cloneKeeperFixture();
  wrongDobihIdentity.lists["dobih-corbetts"].rows[0].dobihNumber! += 1;
  assert.throws(() => validateKeeperFixture(wrongDobihIdentity), /DoBIH.*source member ID/i);

  const wrongUiaaIdentity = cloneKeeperFixture();
  wrongUiaaIdentity.lists["uiaa-pyrenees-main"].rows[0].buyseMainNumber! += 1;
  assert.throws(
    () => validateKeeperFixture(wrongUiaaIdentity),
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
  validateKeeperResolutionFixture(fixture, resolutions);

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
    resolutions
  );
  assert.equal(first.destinationsToAdd.length, 62);
  assert.equal(first.destinationsToRepair.length, 13);

  const second = buildKeeperImportReport(
    fixture,
    resolutions,
    first.catalog,
    [],
    false
  );
  assert.equal(second.report.complete, true);
  assert.equal(second.destinationsToAdd.length, 0);
  assert.equal(second.destinationsToRepair.length, 0);
  assert.equal(
    second.report.lists.reduce((sum, list) => sum + list.resolvedCount, 0),
    565
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
    { ...catalogPeak, elevationM: 1_000, lat: 56, lng: -4 }
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
    /neither its reviewed before nor after fingerprint/
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
    /would reuse OSM node 123/
  );
  repair.lists["test-source"].rows[0].catalogExternalIdAdditions = undefined;
  assert.throws(
    () => validateKeeperResolutionFixture(onePeakFixture, repair, [onePeakList]),
    /does not pin its after OSM identity/
  );
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
  const rerun = catalogWithReviewedKeeperDestinations(
    plan.catalog, onePeakFixture, reviewed, [onePeakList]
  );
  assert.equal(rerun.destinationsToRepair.length, 0);
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
    /neither its reviewed before nor after fingerprint/
  );
  reviewed.catalogRepairs![0].after.externalIds = { osm: "123", wikidata: "Q9" };
  assert.throws(
    () => validateKeeperResolutionFixture(onePeakFixture, reviewed, [onePeakList]),
    /wrong after external-ID set/
  );
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
  const source = readFileSync(path.resolve(__dirname, "../import-keeper-lists.ts"), "utf8");
  assert.doesNotMatch(source, /jsonb_build_object\(['"]peakbagger/);
  assert.doesNotMatch(source, /SET\s+external_ids\s*=/);
  assert.doesNotMatch(source, /destinationPeakbaggerId/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /assertReviewedKeeperDestinations/);
  assert.match(source, /did not persist with its full fingerprint/);
  assert.match(source, /keeper_roster_source/);
  assert.match(source, /COALESCE\(metadata->'names', '\{\}'::jsonb\)/);
  assert.match(source, /jsonb_build_object\('display', \$2\)/);
  assert.deepEqual(KEEPER_LISTS.map((list) => list.expectedCount), [222, 214, 129]);
});

test("fixture validation rejects missing, duplicate, and partial source records", () => {
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
