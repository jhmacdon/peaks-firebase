import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildKfs100Fixture,
  kfsNormalizedOrderedRosterSha256,
} from "../build-kfs-100-famous-mountains-fixture";
import {
  buildKfs100Resolutions,
} from "../build-kfs-100-famous-mountains-resolutions";
import * as kfsCommand from "../import-kfs-100-famous-mountains";
import {
  KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS,
  KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256,
} from "../keeper-list-import/bundles/kfs-100-famous-mountains";
import {
  deterministicKeeperListId,
  deterministicOsmKeeperDestinationId,
  buildKeeperImportReport,
  catalogWithReviewedKeeperDestinations,
  type KeeperCatalogPeak,
  type KeeperImportFixture,
  type KeeperImportReport,
  type KeeperResolutionFixture,
  validateKeeperCrossListConsistency,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
} from "../keeper-list-import/core";
import { KFS_100_FAMOUS_MOUNTAINS_SOURCE } from "../keeper-list-import/sources";

const fixtureDir = path.resolve(__dirname, "../../../../docs/data-audits/fixtures");
const sourceCrosswalkPath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-source-crosswalk-2026-08-30.json"
);
const coordinateCrosswalkPath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-coordinate-crosswalk-2026-08-30.json"
);
const rightsEvidencePath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-data-rights-2026-08-31.json"
);
const fixturePath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-candidates-2026-08-30.json"
);
const resolutionPath = path.join(
  fixtureDir,
  "keeper-list-kfs-100-famous-mountains-identity-resolutions-2026-08-30.json"
);

const sourceCrosswalkBytes = readFileSync(sourceCrosswalkPath);
const coordinateCrosswalkBytes = readFileSync(coordinateCrosswalkPath);
const rightsEvidenceBytes = readFileSync(rightsEvidencePath);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as KeeperImportFixture;
const resolutionText = readFileSync(resolutionPath, "utf8");
const resolutions = JSON.parse(resolutionText) as KeeperResolutionFixture;
const sourceCrosswalk = JSON.parse(sourceCrosswalkBytes.toString("utf8")) as {
  schemaVersion: number;
  effectiveDate: string;
  registryId: string;
  sourceKeyRule: string;
  rows: Array<{
    ordinal: number;
    sourceMemberId: string;
    mntnId: string;
    name: string;
    liveName: string;
    hanjaName: string | null;
    elevationM: number;
  }>;
};
const coordinateCrosswalk = JSON.parse(coordinateCrosswalkBytes.toString("utf8")) as {
  schemaVersion: number;
  reviewedAt: string;
  registryId: string;
  rowCount: number;
  inputSha256: Record<string, string>;
  summary: {
    productionResolutions: Record<string, number>;
    identityStatuses: Record<string, number>;
    unresolved: number;
    documentedSourceConflicts: number;
    productionNeighborLinksWithin150m: number;
    kfsPointPairsWithin150m: number;
    falseSameNameProductionCandidatesRejected: number;
  };
  invariantChecks: Array<{ name: string; passed: boolean; value: unknown }>;
  manualOverrides: Array<{
    ordinal: number;
    sourceMemberId: string;
    selectedOsmNodeId: number;
    notSelectedOsmNodeIds: number[];
  }>;
  rows: Array<{
    ordinal: number;
    sourceMemberId: string;
    mntnId: string;
    kfs: { name: string; elevationM: number };
    reviewedSummitPoint: { osmNodeId: number };
    identityReview: { status: string; flags: string[] };
    productionNeighborsWithin150m: Array<{ destinationId: string }>;
    kfsSummitNeighborsWithin150m: Array<{ sourceMemberId: string }>;
    productionResolution: string;
    destination: {
      destinationId: string;
      name: string;
      elevationM: number;
      lat: number;
      lng: number;
      osmNodeId: number;
      countryCode: string;
      stateCode: string | null;
      externalIds: Record<string, string>;
    };
  }>;
};
const migratePackage = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
) as { scripts: Record<string, string> };

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

test("pins the exact KFS definition and production manifest", () => {
  assert.equal(KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS.length, 1);
  const definition = KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS[0];
  assert.equal(definition.sourceDescriptor, KFS_100_FAMOUS_MOUNTAINS_SOURCE);
  assert.equal(definition.sourceKey, "kfs-100-famous-mountains");
  assert.equal(definition.listId, "39F59B1A26E9B0818EBE");
  assert.equal(definition.listId, deterministicKeeperListId("kfs:100-famous-mountains"));
  assert.equal(definition.name, "Korea Forest Service 100 Famous Mountains");
  assert.equal(definition.expectedCount, 100);
  assert.deepEqual(definition.allowedCountryCodes, ["KR"]);
  assert.equal(definition.region, "South Korea");
  assert.equal(definition.organization, "Korea Forest Service");
  assert.equal(definition.yearEstablished, 2002);
  assert.equal(definition.sourceName, "Korea Forest Service");
  assert.match(definition.sourceUrl, /^https:\/\/www\.forest\.go\.kr\//);
  assert.equal(
    definition.description,
    "The Korea Forest Service selected these 100 mountains for their scenery, " +
      "history, culture, ecology, and public interest. This roster follows the " +
      "official KFS list as of January 1, 2022."
  );
  assert.deepEqual(definition.productionManifest, {
    generatedAt: "2026-08-30",
    sourcesSha256: canonicalSha256(fixture.sources),
    selection: "KFS official 100 Famous Mountains roster, 2022-01-01",
    rosterSha256: canonicalSha256(fixture.lists[definition.sourceKey].rows),
  });
  assert.equal(
    KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256,
    sha256(resolutionText)
  );
  assert.equal(kfsCommand.KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS);
});

test("exposes separate KFS build and dry-run import commands", () => {
  assert.equal(
    migratePackage.scripts["build:keeper-list-fixture:kfs-100-famous-mountains"],
    "tsx src/build-kfs-100-famous-mountains-fixture.ts"
  );
  assert.equal(
    migratePackage.scripts["build:keeper-list-resolutions:kfs-100-famous-mountains"],
    "tsx src/build-kfs-100-famous-mountains-resolutions.ts"
  );
  assert.equal(
    migratePackage.scripts["import:keeper-lists:kfs-100-famous-mountains"],
    "tsx src/import-kfs-100-famous-mountains.ts"
  );
});

test("pins the official source crosswalk and builds the checked source fixture", () => {
  assert.equal(sha256(sourceCrosswalkBytes),
    "b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735");
  assert.equal(sourceCrosswalk.schemaVersion, 1);
  assert.equal(sourceCrosswalk.effectiveDate, "2022-01-01");
  assert.equal(sourceCrosswalk.registryId, "kfs-100-famous-mountains");
  assert.equal(sourceCrosswalk.sourceKeyRule, "kfs:<mntnId>");
  assert.equal(sourceCrosswalk.rows.length, 100);

  assert.equal(
    sha256(rightsEvidenceBytes),
    "8cb839b56ad7804a4b49c47f5ade3b7f2c65428b4e4915cfda5089c549c7d79a"
  );
  const rightsEvidence = JSON.parse(rightsEvidenceBytes.toString("utf8")) as {
    sourceUrl: string;
    rawPageSha256: string;
    coverageEvidence: string;
    licenseScope: string;
  };
  assert.equal(rightsEvidence.sourceUrl,
    "https://www.data.go.kr/data/15058662/openapi.do");
  assert.equal(rightsEvidence.rawPageSha256,
    "a47c620cd929e92f4ea747f1f9cb2573c93fa0049b51a36b9b1284ff691fadb8");
  assert.equal(rightsEvidence.coverageEvidence, "100대 명산");
  assert.equal(rightsEvidence.licenseScope, "이용허락범위 제한 없음");
  const built = buildKfs100Fixture(sourceCrosswalkBytes, rightsEvidenceBytes);
  assert.deepEqual(built, fixture);
  validateKeeperFixture(fixture, KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS);
  const rows = fixture.lists["kfs-100-famous-mountains"].rows;
  assert.equal(rows.length, 100);
  assert.deepEqual(rows.map((row) => row.ordinal),
    Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(new Set(rows.map((row) => row.sourceMemberId)).size, 100);
  assert.equal(new Set(rows.map((row) => row.kfsMntnId)).size, 100);
  assert.ok(rows.every((row) =>
    row.sourceMemberId === `kfs:${row.kfsMntnId}` &&
    /^\d{8}$/.test(row.kfsMntnId ?? "") &&
    row.lat == null && row.lng == null
  ));
  assert.equal(canonicalSha256(rows),
    "ae12c4574d5fc99078aa0367cc88c4128ef102bb94d62ac74e65888cc4bee44b");
  const sourceMetadata = fixture.sources[
    "kfs-100-famous-mountains-2022-01-01"
  ] as Record<string, unknown>;
  assert.equal(
    sourceMetadata.dataRightsUrl,
    "https://www.data.go.kr/data/15058662/openapi.do"
  );
  assert.equal(sourceMetadata.dataRights, "No restriction on use");
  assert.equal(sourceMetadata.dataRightsCheckedAt, "2026-08-31");
  assert.equal(sourceMetadata.dataRightsPageSha256,
    rightsEvidence.rawPageSha256);
  assert.equal(sourceMetadata.dataRightsEvidenceSha256,
    sha256(rightsEvidenceBytes));
  assert.equal(
    sourceMetadata.normalizedOrderedRosterSha256,
    "b26e7aca4881529e65b41ad29626eba4d0b370426b6db9dc6edce0bbbfd903a2"
  );
  assert.equal(
    sourceMetadata.normalizedOrderedRosterSha256,
    kfsNormalizedOrderedRosterSha256(sourceCrosswalk.rows)
  );
});

test("pins the complete coordinate review and builds 100 explicit decisions", () => {
  assert.equal(sha256(coordinateCrosswalkBytes),
    "949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636");
  assert.equal(coordinateCrosswalk.schemaVersion, 1);
  assert.equal(coordinateCrosswalk.reviewedAt, "2026-08-30");
  assert.equal(coordinateCrosswalk.registryId, "kfs-100-famous-mountains");
  assert.equal(coordinateCrosswalk.rowCount, 100);
  assert.deepEqual(coordinateCrosswalk.inputSha256, {
    "kfs-100-crosswalk-2026-08-30.json":
      "b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735",
    "kfs-100-famous-mountains-official-list.xlsx":
      "6edeed758c174580b8152cf0c74b1b5b8b29735314f1d3e8139f7bf160339c60",
    "kfs-100-famous-mountains-official-list.zip":
      "0785a8fd37ae0bb671c774dd833c9e0849ee453c531211efdc51f92173f5d38a",
    "kfs-100-live-canonical-2026-08-30.html":
      "e4fddd46b6e3330dc01d0f621ddca8d5703e626bd4fcf19337a2b30d89a5a1f4",
    "kfs-100-osm-hallasan-node-8334051398-2026-08-30.json":
      "81555ca3d807090015823e94ab83b7341ee496bde36d5f859cda20ce1b453575",
    "kfs-100-osm-peaks-2026-08-30.json":
      "6275b316fa55d2f6a183ee92397564d51316fad78cf89239bad866d0ab95beba",
    "kfs-100-osm-peaks.overpassql":
      "3b0177b5cdb2b30f3b3ebe39ffc8610c4b00573587146e1ec7e5b589374df1b7",
    "kfs-100-production-catalog-2026-08-30.csv":
      "f0824ae26adfa1e0c6f35071a593fe4bbf6729bd465fb04ae728e801b0adbe9d",
    "kfs-100-wikidata-Q494645-2026-08-30.json":
      "51b317cac3cf121b733750335a442571c9cb2bea9a6c7959391e3293d3fa9c89",
    "kfs-copyright-policy.html":
      "19d446eb3c37fc75eedc1395b19f9c16a6c1260cec5a66f715ba1f1e2bdd419e",
  });
  assert.deepEqual(coordinateCrosswalk.summary.productionResolutions, {
    existing_destination: 38,
    catalog_repair: 0,
    curated_destination: 62,
  });
  assert.deepEqual(coordinateCrosswalk.summary.identityStatuses, {
    confirmed: 95,
    confirmed_with_documented_source_conflict: 5,
  });
  assert.equal(coordinateCrosswalk.summary.unresolved, 0);
  assert.equal(coordinateCrosswalk.summary.documentedSourceConflicts, 5);
  assert.equal(coordinateCrosswalk.summary.productionNeighborLinksWithin150m, 38);
  assert.equal(coordinateCrosswalk.summary.kfsPointPairsWithin150m, 0);
  assert.equal(coordinateCrosswalk.summary.falseSameNameProductionCandidatesRejected, 4);
  assert.ok(coordinateCrosswalk.invariantChecks.length >= 15);
  assert.ok(coordinateCrosswalk.invariantChecks.every((check) => check.passed));

  const built = buildKfs100Resolutions(fixture, coordinateCrosswalkBytes);
  assert.deepEqual(built, resolutions);
  validateKeeperResolutionFixture(
    fixture,
    resolutions,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  validateKeeperCrossListConsistency(
    fixture,
    resolutions,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  const rows = resolutions.lists["kfs-100-famous-mountains"].rows;
  assert.equal(rows.length, 100);
  assert.deepEqual(
    Object.fromEntries(
      ["existing_destination", "catalog_repair", "curated_destination"].map((kind) => [
        kind,
        rows.filter((row) => row.resolution === kind).length,
      ])
    ),
    { existing_destination: 38, catalog_repair: 0, curated_destination: 62 }
  );
  assert.equal(new Set(rows.map((row) => row.destinationId)).size, 100);
  assert.equal(new Set(rows.map((row) => row.destinationOsmNodeId)).size, 100);
  assert.ok(rows.every((row) => row.destinationCountryCode === "KR"));
  assert.ok(rows.every((row) => row.destinationStateCode == null));
});

test("keeps the route join exact and keeps KFS source IDs out of destination external IDs", () => {
  const fixtureRows = new Map(
    fixture.lists["kfs-100-famous-mountains"].rows.map((row) => [
      row.sourceMemberId,
      row,
    ])
  );
  const resolutionRows = new Map(
    resolutions.lists["kfs-100-famous-mountains"].rows.map((row) => [
      row.sourceMemberId,
      row,
    ])
  );
  assert.equal(fixtureRows.size, 100);
  assert.equal(resolutionRows.size, 100);
  for (const reviewed of coordinateCrosswalk.rows) {
    const source = fixtureRows.get(reviewed.sourceMemberId)!;
    const resolution = resolutionRows.get(reviewed.sourceMemberId)!;
    assert.equal(source.ordinal, reviewed.ordinal);
    assert.equal(source.kfsMntnId, reviewed.mntnId);
    assert.equal(source.name, reviewed.kfs.name);
    assert.equal(source.elevationM, reviewed.kfs.elevationM);
    assert.equal(resolution.destinationId, reviewed.destination.destinationId);
    assert.equal(resolution.destinationOsmNodeId,
      String(reviewed.reviewedSummitPoint.osmNodeId));
    assert.equal(
      reviewed.destination.externalIds.osm,
      String(reviewed.reviewedSummitPoint.osmNodeId)
    );
    assert.equal("kfs" in reviewed.destination.externalIds, false);
    if (reviewed.productionResolution === "curated_destination") {
      assert.equal(
        resolution.destinationId,
        deterministicOsmKeeperDestinationId(String(reviewed.reviewedSummitPoint.osmNodeId))
      );
      assert.equal(reviewed.productionNeighborsWithin150m.length, 0);
    } else {
      assert.equal(reviewed.productionResolution, "existing_destination");
      assert.equal(reviewed.productionNeighborsWithin150m.length, 1);
      assert.equal(reviewed.productionNeighborsWithin150m[0].destinationId,
        resolution.destinationId);
    }
    assert.equal(reviewed.kfsSummitNeighborsWithin150m.length, 0);
  }
});

test("plans 62 additions once and a fully unchanged second import", () => {
  const catalog: KeeperCatalogPeak[] = coordinateCrosswalk.rows
    .filter((row) => row.productionResolution === "existing_destination")
    .map((row) => ({
      id: row.destination.destinationId,
      name: row.destination.name,
      elevationM: row.destination.elevationM,
      lat: row.destination.lat,
      lng: row.destination.lng,
      countryCode: row.destination.countryCode,
      stateCode: row.destination.stateCode,
      osmId: String(row.destination.osmNodeId),
      externalIds: { ...row.destination.externalIds },
      owner: "peaks",
      destinationType: "point",
      features: ["summit"],
    }));
  const first = catalogWithReviewedKeeperDestinations(
    catalog,
    fixture,
    resolutions,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  assert.equal(first.destinationsToAdd.length, 62);
  assert.equal(first.destinationsToRepair.length, 0);
  assert.equal(first.catalog.length, 100);
  assert.equal(new Set(first.catalog.map((row) => row.id)).size, 100);

  const firstRun = buildKeeperImportReport(
    fixture,
    resolutions,
    catalog,
    [],
    false,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  assert.equal(firstRun.report.complete, true);
  assert.equal(firstRun.report.destinationsToAdd.length, 62);
  assert.equal(firstRun.report.destinationsToRepair.length, 0);
  assert.equal(firstRun.report.lists[0].added.length, 100);
  assert.equal(firstRun.report.lists[0].removed.length, 0);
  assert.equal(firstRun.report.lists[0].reorderedCount, 0);
  assert.equal(firstRun.report.lists[0].issues.length, 0);
  const current = firstRun.plans.flatMap((plan) => plan.members.map((member) => ({
    listId: plan.list.listId,
    destinationId: member.destinationId,
    ordinal: member.ordinal,
  })));
  assert.equal(current.length, 100);

  const second = buildKeeperImportReport(
    fixture,
    resolutions,
    first.catalog,
    current,
    false,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  assert.equal(second.destinationsToAdd.length, 0);
  assert.equal(second.destinationsToRepair.length, 0);
  assert.equal(second.report.complete, true);
  assert.equal(second.report.lists[0].resolvedCount, 100);
  assert.equal(second.report.lists[0].unresolvedCount, 0);
  assert.equal(second.report.lists[0].added.length, 0);
  assert.equal(second.report.lists[0].removed.length, 0);
  assert.equal(second.report.lists[0].reorderedCount, 0);
  assert.equal(second.report.lists[0].issues.length, 0);
});

test("pins every reviewed external ID on existing KFS destinations", () => {
  const catalog: KeeperCatalogPeak[] = coordinateCrosswalk.rows
    .filter((row) => row.productionResolution === "existing_destination")
    .map((row) => ({
      id: row.destination.destinationId,
      name: row.destination.name,
      elevationM: row.destination.elevationM,
      lat: row.destination.lat,
      lng: row.destination.lng,
      countryCode: row.destination.countryCode,
      stateCode: row.destination.stateCode,
      osmId: String(row.destination.osmNodeId),
      externalIds: { ...row.destination.externalIds },
      owner: "peaks",
      destinationType: "point",
      features: ["summit"],
    }));
  const reviewed = resolutions.lists["kfs-100-famous-mountains"].rows.filter(
    (row) => row.resolution === "existing_destination"
  );
  assert.equal(reviewed.length, 38);
  assert.ok(reviewed.every((row) => row.destinationExternalIds?.osm ===
    row.destinationOsmNodeId));
  const rowWithWikidata = reviewed.find((row) =>
    row.destinationExternalIds?.wikidata != null
  );
  assert.ok(rowWithWikidata);
  const changedCatalog = catalog.map((row) => row.id !== rowWithWikidata.destinationId
    ? row
    : { ...row, externalIds: { osm: row.externalIds.osm } });
  assert.throws(
    () => catalogWithReviewedKeeperDestinations(
      changedCatalog,
      fixture,
      resolutions,
      KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
    ),
    /pinned fingerprint/i
  );
});

test("pins the six manual point choices and five documented source conflicts", () => {
  assert.deepEqual(
    coordinateCrosswalk.manualOverrides.map((row) => [
      row.ordinal,
      row.sourceMemberId,
      row.selectedOsmNodeId,
      row.notSelectedOsmNodeIds,
    ]),
    [
      [17, "kfs:20000108", 5376919634, [8566947054, 288169256]],
      [31, "kfs:20000176", 9684280383, [10230534291]],
      [46, "kfs:20000775", 10250409125, [5515194626]],
      [56, "kfs:20000399", 1862839218, [10252764073]],
      [93, "kfs:20000661", 8334051398, [7036109099]],
      [94, "kfs:20000679", 11637337293, [5429893547, 7972716230]],
    ]
  );
  assert.deepEqual(
    coordinateCrosswalk.rows
      .filter((row) => row.identityReview.status ===
        "confirmed_with_documented_source_conflict")
      .map((row) => row.sourceMemberId),
    ["kfs:20000775", "kfs:20000422", "kfs:20001322", "kfs:20000628", "kfs:20000679"]
  );
});

test("keeps Wikidata tags as checked evidence rather than curated write fields", () => {
  const rowsWithWikidata = coordinateCrosswalk.rows.filter((row) =>
    row.destination.externalIds.wikidata != null
  );
  assert.equal(rowsWithWikidata.length, 49);
  const hallasan = rowsWithWikidata.find((row) => row.sourceMemberId === "kfs:20000661");
  assert.equal(hallasan?.destination.externalIds.wikidata, "Q494645");
  const resolution = resolutions.lists["kfs-100-famous-mountains"].rows.find(
    (row) => row.sourceMemberId === "kfs:20000661"
  );
  assert.equal(resolution?.destinationOsmNodeId, "8334051398");
  assert.equal("catalogExternalIdAdditions" in (resolution ?? {}), false);
});

test("rejects changed pinned inputs before producing either fixture", () => {
  const changedSource = Buffer.from(sourceCrosswalkBytes);
  changedSource[changedSource.length - 2] ^= 1;
  assert.throws(
    () => buildKfs100Fixture(changedSource, rightsEvidenceBytes),
    /checksum/i
  );

  const changedRightsEvidence = Buffer.from(rightsEvidenceBytes);
  changedRightsEvidence[changedRightsEvidence.length - 2] ^= 1;
  assert.throws(
    () => buildKfs100Fixture(sourceCrosswalkBytes, changedRightsEvidence),
    /checksum/i
  );

  const changedCoordinates = Buffer.from(coordinateCrosswalkBytes);
  changedCoordinates[changedCoordinates.length - 2] ^= 1;
  assert.throws(
    () => buildKfs100Resolutions(fixture, changedCoordinates),
    /checksum/i
  );
});

test("runs the KFS command boundary with exact definitions and cleanup", async () => {
  const report: KeeperImportReport = {
    apply: false,
    complete: true,
    destinationsToAdd: [],
    destinationsToRepair: [],
    lists: [],
  };
  const calls: unknown[][] = [];
  const output: string[] = [];
  let releases = 0;
  let ends = 0;
  const client = { release: () => { releases += 1; } };
  const exitCode = await kfsCommand.runKfs100Command([
    "--input=/tmp/kfs-input.json",
    "--resolutions=/tmp/kfs-resolutions.json",
  ], {
    readFile: async (filePath) => filePath.includes("resolutions")
      ? resolutionText
      : JSON.stringify(fixture),
    connect: async () => client as never,
    end: async () => { ends += 1; },
    runKeeperImport: async (...args) => {
      calls.push(args);
      return report;
    },
    writeLine: (line) => output.push(line),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], client);
  assert.deepEqual(calls[0][1], fixture);
  assert.deepEqual(calls[0][2], resolutions);
  assert.equal(calls[0][3], false);
  assert.equal(calls[0][4], KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS);
  assert.deepEqual(output, [JSON.stringify(report, null, 2)]);
  assert.equal(releases, 1);
  assert.equal(ends, 1);
});

test("rejects a changed resolution artifact before opening the database", async () => {
  const changed = JSON.parse(resolutionText) as KeeperResolutionFixture;
  changed.lists["kfs-100-famous-mountains"].rows[0].destinationLat += 0.001;
  let connects = 0;
  let imports = 0;
  await assert.rejects(
    kfsCommand.runKfs100Command([
      "--input=/tmp/kfs-input.json",
      "--resolutions=/tmp/kfs-resolutions.json",
    ], {
      readFile: async (filePath) => filePath.includes("resolutions")
        ? JSON.stringify(changed)
        : JSON.stringify(fixture),
      connect: async () => {
        connects += 1;
        return {} as never;
      },
      runKeeperImport: async () => {
        imports += 1;
        throw new Error("must not import");
      },
    }),
    /resolution fixture checksum/i
  );
  assert.equal(connects, 0);
  assert.equal(imports, 0);
});
