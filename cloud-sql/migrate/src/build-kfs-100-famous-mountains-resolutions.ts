/** Builds the reviewed KFS 100 Famous Mountains identity fixture offline. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deterministicOsmKeeperDestinationId,
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  type KeeperResolutionRow,
  validateKeeperCrossListConsistency,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
} from "./keeper-list-import/core";
import {
  KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS,
} from "./keeper-list-import/bundles/kfs-100-famous-mountains";

const SOURCE_KEY = "kfs-100-famous-mountains";
const COORDINATE_SHA256 =
  "949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636";
const SOURCE_SHA256 =
  "b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735";
const CATALOG_SHA256 =
  "f0824ae26adfa1e0c6f35071a593fe4bbf6729bd465fb04ae728e801b0adbe9d";
const CURATED_WIKIDATA_IDS: Readonly<Record<string, string>> = Object.freeze({
  "kfs:20000028": "Q5521102",
  "kfs:20000138": "Q5208296",
  "kfs:20000165": "Q5316834",
  "kfs:20000370": "Q7451509",
  "kfs:20000543": "Q6154017",
  "kfs:20000548": "Q8533740",
  "kfs:20000606": "Q626656",
  "kfs:20000661": "Q494645",
  "kfs:20000699": "Q5701198",
});
const REVIEW_INPUT_SHA256: Record<string, string> = {
  "kfs-100-crosswalk-2026-08-30.json": SOURCE_SHA256,
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
  "kfs-100-production-catalog-2026-08-30.csv": CATALOG_SHA256,
  "kfs-100-wikidata-Q494645-2026-08-30.json":
    "51b317cac3cf121b733750335a442571c9cb2bea9a6c7959391e3293d3fa9c89",
  "kfs-copyright-policy.html":
    "19d446eb3c37fc75eedc1395b19f9c16a6c1260cec5a66f715ba1f1e2bdd419e",
};

interface CoordinateRow {
  ordinal: number;
  sourceMemberId: string;
  mntnId: string;
  kfs: {
    name: string;
    elevationM: number;
    location: string;
  };
  reviewedSummitPoint: {
    lat: number;
    lng: number;
    osmNodeId: number;
    osmUrl: string;
    osmNatural: string;
    osmName: string;
    wikidataId: string | null;
    coordinateSource: string;
    coordinateLicense: string;
  };
  identityReview: {
    status: string;
    note: string;
    flags: string[];
  };
  productionNeighborsWithin150m: Array<{
    destinationId: string;
    name: string;
    elevationM: number;
    lat: number;
    lng: number;
    osmNodeId: number;
    distanceM: number;
  }>;
  kfsSummitNeighborsWithin150m: unknown[];
  productionResolution: "existing_destination" | "curated_destination";
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
    dataSourceName?: string;
    dataSourceUrl?: string;
    dataLicense?: string;
  };
}

interface CoordinateCrosswalk {
  schemaVersion: number;
  reviewedAt: string;
  registryId: string;
  rowCount: number;
  sourceKeyRule: string;
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
  invariantChecks: Array<{ name: string; passed: boolean }>;
  manualOverrides: unknown[];
  kfsPointPairsWithin150m: unknown[];
  rows: CoordinateRow[];
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sortedEntries(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function assertCoordinateCrosswalk(value: unknown): asserts value is CoordinateCrosswalk {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("KFS coordinate crosswalk is not an object");
  }
  const review = value as Partial<CoordinateCrosswalk>;
  const resolutions = review.summary?.productionResolutions;
  const statuses = review.summary?.identityStatuses;
  if (review.schemaVersion !== 1 || review.reviewedAt !== "2026-08-30" ||
      review.registryId !== SOURCE_KEY || review.rowCount !== 100 ||
      review.sourceKeyRule !== "kfs:<mntnId>" ||
      review.inputSha256 == null ||
      JSON.stringify(sortedEntries(review.inputSha256)) !==
        JSON.stringify(sortedEntries(REVIEW_INPUT_SHA256)) ||
      resolutions?.existing_destination !== 38 || resolutions.catalog_repair !== 0 ||
      resolutions.curated_destination !== 62 || statuses?.confirmed !== 95 ||
      statuses.confirmed_with_documented_source_conflict !== 5 ||
      review.summary?.unresolved !== 0 ||
      review.summary.documentedSourceConflicts !== 5 ||
      review.summary.productionNeighborLinksWithin150m !== 38 ||
      review.summary.kfsPointPairsWithin150m !== 0 ||
      review.summary.falseSameNameProductionCandidatesRejected !== 4 ||
      !Array.isArray(review.invariantChecks) || review.invariantChecks.length < 15 ||
      review.invariantChecks.some((check) => check.passed !== true) ||
      !Array.isArray(review.manualOverrides) || review.manualOverrides.length !== 6 ||
      !Array.isArray(review.kfsPointPairsWithin150m) ||
      review.kfsPointPairsWithin150m.length !== 0 ||
      !Array.isArray(review.rows) || review.rows.length !== 100) {
    throw new Error("KFS coordinate crosswalk does not match the reviewed 100-row audit");
  }
}

function resolutionRow(row: CoordinateRow): KeeperResolutionRow {
  const osmNodeId = String(row.reviewedSummitPoint.osmNodeId);
  const curatedWikidataId = CURATED_WIKIDATA_IDS[row.sourceMemberId];
  const externalIdKeys = Object.keys(row.destination.externalIds).sort();
  const allowedExternalIdKeys = row.reviewedSummitPoint.wikidataId == null
    ? ["osm"]
    : ["osm", "wikidata"];
  if (row.destination.countryCode !== "KR" || row.destination.stateCode != null ||
      row.destination.osmNodeId !== row.reviewedSummitPoint.osmNodeId ||
      row.destination.externalIds.osm !== osmNodeId ||
      JSON.stringify(externalIdKeys) !== JSON.stringify(allowedExternalIdKeys) ||
      (row.reviewedSummitPoint.wikidataId != null &&
        row.destination.externalIds.wikidata !== row.reviewedSummitPoint.wikidataId) ||
      row.kfsSummitNeighborsWithin150m.length !== 0) {
    throw new Error(`KFS coordinate row ${row.sourceMemberId} has a changed destination point`);
  }
  if (row.productionResolution === "existing_destination") {
    const neighbor = row.productionNeighborsWithin150m[0];
    if (row.productionNeighborsWithin150m.length !== 1 || neighbor == null ||
        neighbor.destinationId !== row.destination.destinationId ||
        neighbor.name !== row.destination.name ||
        neighbor.elevationM !== row.destination.elevationM ||
        neighbor.lat !== row.destination.lat || neighbor.lng !== row.destination.lng ||
        neighbor.osmNodeId !== row.destination.osmNodeId || neighbor.distanceM > 150) {
      throw new Error(`KFS existing row ${row.sourceMemberId} has no exact catalog neighbor`);
    }
  } else {
    if (row.destination.lat !== row.reviewedSummitPoint.lat ||
        row.destination.lng !== row.reviewedSummitPoint.lng ||
        row.productionNeighborsWithin150m.length !== 0 ||
        row.destination.destinationId !== deterministicOsmKeeperDestinationId(osmNodeId) ||
        typeof row.destination.dataSourceName !== "string" ||
        typeof row.destination.dataSourceUrl !== "string" ||
        typeof row.destination.dataLicense !== "string") {
      throw new Error(`KFS curated row ${row.sourceMemberId} has changed reviewed provenance`);
    }
  }
  if (curatedWikidataId != null &&
      (row.productionResolution !== "curated_destination" ||
       row.reviewedSummitPoint.wikidataId !== curatedWikidataId ||
       row.destination.externalIds.wikidata !== curatedWikidataId)) {
    throw new Error(
      `KFS curated row ${row.sourceMemberId} does not match Wikidata ${curatedWikidataId}`
    );
  }
  return {
    sourceKey: SOURCE_KEY,
    sourceMemberId: row.sourceMemberId,
    resolution: row.productionResolution,
    destinationId: row.destination.destinationId,
    destinationName: row.destination.name,
    destinationElevationM: row.destination.elevationM,
    destinationLat: row.destination.lat,
    destinationLng: row.destination.lng,
    destinationOsmNodeId: osmNodeId,
    destinationCountryCode: "KR",
    destinationStateCode: null,
    ...(row.productionResolution === "existing_destination" ? {
      destinationExternalIds: { ...row.destination.externalIds },
    } : {}),
    ...(curatedWikidataId == null ? {} : {
      destinationExternalIds: {
        osm: osmNodeId,
        wikidata: curatedWikidataId,
      },
    }),
    ...(row.productionResolution === "curated_destination" ? {
      destinationDataSourceName: row.destination.dataSourceName,
      destinationDataSourceUrl: row.destination.dataSourceUrl,
      destinationDataLicense: row.destination.dataLicense,
    } : {}),
    evidence: [
      `KFS ${row.mntnId} names ${row.kfs.name} at ${row.kfs.elevationM} m in ` +
        `${row.kfs.location}.`,
      `Reviewed OSM ${row.reviewedSummitPoint.osmNatural} node ${osmNodeId} at the ` +
        `saved point under ${row.reviewedSummitPoint.coordinateLicense}.`,
      row.identityReview.note,
    ],
  };
}

export function buildKfs100Resolutions(
  fixture: KeeperImportFixture,
  coordinateBytes: Buffer
): KeeperResolutionFixture {
  const actualSha = sha256(coordinateBytes);
  if (actualSha !== COORDINATE_SHA256) {
    throw new Error(
      `KFS coordinate crosswalk checksum ${actualSha} does not match ${COORDINATE_SHA256}`
    );
  }
  const review = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(coordinateBytes)
  );
  assertCoordinateCrosswalk(review);
  const sourceRows = fixture.lists[SOURCE_KEY]?.rows;
  if (!sourceRows || sourceRows.length !== 100) {
    throw new Error("KFS source fixture is missing its 100 rows");
  }
  const sourceById = new Map(sourceRows.map((row) => [row.sourceMemberId, row]));
  const destinationIds = new Set<string>();
  const osmNodeIds = new Set<number>();
  for (const [index, row] of review.rows.entries()) {
    const source = sourceById.get(row.sourceMemberId);
    if (row.ordinal !== index + 1 || source == null || source.ordinal !== row.ordinal ||
        source.kfsMntnId !== row.mntnId || source.name !== row.kfs.name ||
        source.elevationM !== row.kfs.elevationM ||
        destinationIds.has(row.destination.destinationId) ||
        osmNodeIds.has(row.reviewedSummitPoint.osmNodeId)) {
      throw new Error(`KFS coordinate row ${row.sourceMemberId} changed source identity`);
    }
    destinationIds.add(row.destination.destinationId);
    osmNodeIds.add(row.reviewedSummitPoint.osmNodeId);
  }
  const rows = review.rows.map(resolutionRow);
  const emittedCuratedWikidataIds = Object.fromEntries(rows
    .filter((row) => row.resolution === "curated_destination" &&
      row.destinationExternalIds?.wikidata != null)
    .map((row) => [row.sourceMemberId, row.destinationExternalIds!.wikidata]));
  if (JSON.stringify(sortedEntries(emittedCuratedWikidataIds)) !==
      JSON.stringify(sortedEntries(CURATED_WIKIDATA_IDS))) {
    throw new Error("KFS curated Wikidata allowlist was not emitted exactly");
  }
  const output: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: "2026-08-30",
    catalogSnapshotSha256: CATALOG_SHA256,
    lists: {
      [SOURCE_KEY]: {
        rows,
      },
    },
  };
  validateKeeperFixture(fixture, KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS);
  validateKeeperResolutionFixture(
    fixture,
    output,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  validateKeeperCrossListConsistency(
    fixture,
    output,
    KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
  );
  return output;
}

interface BuildArgs {
  fixture: string;
  coordinates: string;
  checkedCoordinates: string;
  output: string;
}

function parseArgs(argv: string[]): BuildArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const fixtureDir = path.join(repoRoot, "docs/data-audits/fixtures");
  const value = (name: string, fallback: string): string =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const known = new Set(["fixture", "coordinates", "checked-coordinates", "output"]);
  const unknown = argv.find((arg) => !arg.startsWith("--") ||
    !known.has(arg.slice(2).split("=", 1)[0]));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  return {
    fixture: value("fixture", path.join(
      fixtureDir,
      "keeper-list-kfs-100-famous-mountains-candidates-2026-08-30.json"
    )),
    coordinates: value(
      "coordinates",
      "/private/tmp/kfs-100-reviewed-coordinate-crosswalk-2026-08-30.json"
    ),
    checkedCoordinates: value("checked-coordinates", path.join(
      fixtureDir,
      "keeper-list-kfs-100-famous-mountains-coordinate-crosswalk-2026-08-30.json"
    )),
    output: value("output", path.join(
      fixtureDir,
      "keeper-list-kfs-100-famous-mountains-identity-resolutions-2026-08-30.json"
    )),
  };
}

export async function runKfs100ResolutionBuilder(
  argv = process.argv.slice(2)
): Promise<void> {
  const args = parseArgs(argv);
  const [fixtureText, coordinateBytes] = await Promise.all([
    fs.readFile(args.fixture, "utf8"),
    fs.readFile(args.coordinates),
  ]);
  const fixture = JSON.parse(fixtureText) as KeeperImportFixture;
  const output = buildKfs100Resolutions(fixture, coordinateBytes);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.checkedCoordinates, coordinateBytes);
  await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  runKfs100ResolutionBuilder().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
