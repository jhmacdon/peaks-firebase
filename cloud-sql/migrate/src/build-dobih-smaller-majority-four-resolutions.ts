/** Builds the complete reviewed identity fixture for the queued DoBIH smaller-majority four. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseStrictCsv } from "./build-dobih-open-eight-fixture";
import {
  DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS,
  DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY,
  DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS,
} from "./keeper-list-import/bundles/dobih-smaller-majority-four";
import {
  deterministicKeeperDestinationId,
  type KeeperDestinationFingerprint,
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  type KeeperResolutionRow,
  type KeeperSourceMember,
  validateKeeperCrossListConsistency,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
} from "./keeper-list-import/core";

const REVIEWED_AT = "2026-08-31";
const CANDIDATE_SHA256 =
  "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b";
const ANALYSIS_SHA256 =
  "4862036f5fe1149c496af9f4c99af0ab213b02fbcf494307794dfe55fef940f3";
const DOBIH_CSV_SHA256 =
  "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea";
const CATALOG_SHA256 =
  "b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab";
const CRUIM_OSM_EVIDENCE_SHA256 =
  "ddc8e187ae032bc6da89dea02b2ecb8e87940d2d890550eb59c4d2cf5912fd59";
const EXPECTED_CATALOG_ROWS = 2_524;
const EXPECTED_MEMBERSHIPS = 678;
const EXPECTED_IDENTITIES = 648;
const EXPECTED_REUSED = 121;
const EXPECTED_NEW = 527;
const EXPECTED_NEW_AUTOMATIC = 168;
const EXPECTED_OPEN = 359;
const EXPECTED_OPEN_EXISTING = 10;
const EXPECTED_OPEN_REPAIRS = 2;
const EXPECTED_OPEN_CURATED = 347;
const EXPECTED_EXISTING = 290;
const EXPECTED_REPAIRS = 3;
const EXPECTED_CURATED = 355;
const DUPLICATE_GUARD_M = 150;

const DOBIH_SOURCE_NAME = "The Database of British and Irish Hills v18.5";
const DOBIH_SOURCE_LICENSE = "CC BY 4.0";

const SOURCE_KEYS = [
  "dobih-welsh-3000s",
  "dobih-great-britain-submarilyns",
  "dobih-donald-deweys",
  "dobih-england-wales-2000-foot-register",
] as const;

interface CatalogRow {
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  osmNodeId: string | null;
  countryCode: string | null;
  stateCode: string | null;
  externalIds: Record<string, string>;
}

interface AnalysisDestination extends Omit<CatalogRow, "externalIds"> {}

interface AnalysisCatalogCandidate extends AnalysisDestination {
  distanceM: number;
  elevationDeltaM: number;
  normalizedNameMatch: boolean;
}

interface AnalysisIdentity {
  sourceMemberId: string;
  dobihNumber: number;
  name: string;
  aliases: string[];
  elevationM: number;
  lat: number;
  lng: number;
  sourceCountry: string;
  destinationCountryCode: "GB";
  owners: string[];
  sourceUrl: string;
}

interface ReusedAnalysisIdentity extends AnalysisIdentity {
  status: "reused_explicit" | "reused_automatic" | "reused_needs_review";
  destination: AnalysisDestination | null;
  reviewedResolution: Omit<KeeperResolutionRow, "sourceKey"> | null;
  reviewedResolutionSha256: string | null;
  requiredAuxiliaryRepairId: string | null;
}

interface NewAnalysisIdentity extends AnalysisIdentity {
  status: "catalog_auto_match" | "needs_review";
  destination: AnalysisDestination | null;
  automaticCandidates: AnalysisCatalogCandidate[];
  nearbyCandidates: AnalysisCatalogCandidate[];
  closeCatalogNeighbors: AnalysisCatalogCandidate[];
  blockingReasons: string[];
}

interface IdentityAnalysis {
  schemaVersion: 1;
  generatedAt: string;
  reviewedAt: string;
  identityReviewComplete: boolean;
  publicationReady: false;
  inputs: Record<string, string>;
  sourceProvenance: Record<string, unknown>;
  catalogSnapshot: { sha256: string; rows: number; transaction: string };
  counts: Record<string, number>;
  accessBlocks: typeof DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS;
  sourceNeighborPairs: unknown[];
  requiredPriorAuxiliaryRepairs: unknown[];
  reusedIdentities: ReusedAnalysisIdentity[];
  newIdentities: NewAnalysisIdentity[];
}

interface RawDobihEvidence {
  number: number;
  name: string;
  metres: number;
  lat: number;
  lng: number;
  country: string;
  feature: string;
  observations: string;
  survey: string;
  comments: string;
}

interface CruimOsmEvidence {
  schemaVersion: 1;
  reviewedAt: string;
  sourceUrl: string;
  sourcePageUrl: string;
  license: string;
  licenseUrl: string;
  node: {
    type: string;
    id: number;
    lat: number;
    lon: number;
    version: number;
    timestamp: string;
    tags: Record<string, string>;
  };
}

export interface DobihSmallerMajorityFourResolutionInputs {
  candidateBytes: Buffer;
  analysisBytes: Buffer;
  dobihCsvBytes: Buffer;
  catalogBytes: Buffer;
  cruimOsmEvidenceBytes: Buffer;
}

interface BuildArgs {
  candidates: string;
  analysis: string;
  dobihCsv: string;
  catalog: string;
  cruimOsmEvidence: string;
  output: string;
}

interface NearExactReview {
  destinationId: string;
  sourceName: string;
  destinationName: string;
  distanceM: number;
  elevationDeltaM: number;
  nameEvidence: string;
}

export const DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS:
  Record<string, NearExactReview> = {
    "dobih:886": {
      destinationId: "52DE809AB1BA1A592906",
      sourceName: "Sgurr Fhuar-thuill",
      destinationName: "Sgurr Fuar-thuill",
      distanceM: 3,
      elevationDeltaM: 0.9928335426293415,
      nameEvidence: "The catalog spelling omits the source's second h in Fhuar.",
    },
    "dobih:1004": {
      destinationId: "1F047C2D57CC6FA5E79B",
      sourceName: "An Teallach - Sgurr Fiona",
      destinationName: "Sgurr Fiona",
      distanceM: 5,
      elevationDeltaM: 1.2999999999999545,
      nameEvidence: "The catalog uses the summit part of the source's parent-qualified name.",
    },
    "dobih:2013": {
      destinationId: "315C82D37714B3D4D7C9",
      sourceName: "Creigiau Gleision",
      destinationName: "Creigau Gleision",
      distanceM: 5,
      elevationDeltaM: 2.1000000000000227,
      nameEvidence: "The catalog has the same summit with a one-letter spelling difference.",
    },
    "dobih:2098": {
      destinationId: "A186D7949B1DE027F673",
      sourceName: "Pen y Brynnfforchog",
      destinationName: "Pen y Brynfforchog",
      distanceM: 5,
      elevationDeltaM: 0.20000000000004547,
      nameEvidence: "The catalog has the same summit with one fewer n in Brynfforchog.",
    },
    "dobih:2117": {
      destinationId: "F13F112E0E1FFEB3F6A2",
      sourceName: "Cefn Dylif",
      destinationName: "Pen Bwlch Llandrillo",
      distanceM: 4,
      elevationDeltaM: 2.5,
      nameEvidence: "DoBIH's exact alias 'Pen Bwlch Llandrillo Top' names the catalog summit.",
    },
    "dobih:2137": {
      destinationId: "924E1424345A32DABFC1",
      sourceName: "Cadair Idris - Penygadair",
      destinationName: "Cadair Idris",
      distanceM: 3,
      elevationDeltaM: 0.2999999999999545,
      nameEvidence: "The catalog uses the mountain name while DoBIH adds its summit name.",
    },
    "dobih:2145": {
      destinationId: "A8CB50D94959D5EA2784",
      sourceName: "Maesglase",
      destinationName: "Maesglase (Craig Rhiw-erch)",
      distanceM: 2,
      elevationDeltaM: 0.5,
      nameEvidence: "The catalog appends the reviewed summit qualifier to the same name.",
    },
    "dobih:2178": {
      destinationId: "50D6E65DF0B624FBE4B8",
      sourceName: "Great Rhos",
      destinationName: "Rhos Fawr",
      distanceM: 14,
      elevationDeltaM: 0,
      nameEvidence: "The source and catalog use the English and Welsh names of the same summit.",
    },
    "dobih:2236": {
      destinationId: "87F6450C01D7CE41F0F9",
      sourceName: "Bannau Sir Gaer - Picws Du",
      destinationName: "Picws Du",
      distanceM: 2,
      elevationDeltaM: 0.10000000000002274,
      nameEvidence: "The catalog uses the summit part of the source's parent-qualified name.",
    },
    "dobih:2242": {
      destinationId: "B1136F356AA244BF4B52",
      sourceName: "Black Mountain",
      destinationName: "Twyn Llech",
      distanceM: 30,
      elevationDeltaM: 0.03899999999998727,
      nameEvidence: "Black Mountain and Twyn Llech are the source and catalog names for this point.",
    },
    "dobih:2791": {
      destinationId: "5Fmpn5fM3oxvOEYhwErB",
      sourceName: "Yockenthwaite Moor",
      destinationName: "Yockenthwaite Moor",
      distanceM: 7,
      elevationDeltaM: 0,
      nameEvidence: "The source and catalog names and elevations are exact.",
    },
  };

interface SemanticDistinctReview {
  destinationName: string;
  distinct: Array<{ destinationId: string; name: string; distanceM: number }>;
  supportDobihNumbers: number[];
  evidence: string;
}

export const DOBIH_SMALLER_MAJORITY_FOUR_SEMANTIC_DISTINCT_REVIEWS:
  Record<string, SemanticDistinctReview> = {
    "dobih:2017": {
      destinationName: "Ysgafell Wen North Top",
      distinct: [{
        destinationId: "5094CABC181B6C84652E",
        name: "Ysgafell Wen",
        distanceM: 540,
      }],
      supportDobihNumbers: [2016],
      evidence: "DoBIH lists the North Top separately from the 672.2 m main summit.",
    },
    "dobih:2377": {
      destinationName: "Black Crag",
      distinct: [
        { destinationId: "2421175BA06042AD07C9", name: "Scoat Fell", distanceM: 710 },
        { destinationId: "60D9BEA86E6F534E7C4D", name: "Steeple", distanceM: 846 },
      ],
      supportDobihNumbers: [2373, 2379],
      evidence: "DoBIH lists Black Crag between, but apart from, Scoat Fell and Steeple.",
    },
    "dobih:2415": {
      destinationName: "Whiteside East Top",
      distinct: [
        {
          destinationId: "BF1064CD70CA2339E8DE",
          name: "Whiteside-Gasgale Crags Summit",
          distanceM: 331,
        },
        { destinationId: "680B49B98EE61FCDEB6B", name: "Whiteside", distanceM: 501 },
      ],
      supportDobihNumbers: [3732, 2418],
      evidence: "DoBIH gives the 719.4 m East Top apart from both lower Whiteside points.",
    },
    "dobih:2446": {
      destinationName: "Seathwaite Fell (Great Slack summit)",
      distinct: [{
        destinationId: "024C40E4C11DDF4D2C7C",
        name: "Seathwaite Fell",
        distanceM: 494,
      }],
      supportDobihNumbers: [2448, 2456],
      evidence:
        "DoBIH marks the 631 m Great Slack summit as distinct from the 601.1 m Wainwright summit.",
    },
    "dobih:5603": {
      destinationName: "Fan Brycheiniog - Twr y Fan Foel",
      distinct: [{
        destinationId: "658D0E0744E8B7EAACAB",
        name: "Fan Brycheiniog",
        distanceM: 289,
      }],
      supportDobihNumbers: [2230],
      evidence:
        "DoBIH says the Twr y Fan Foel cairn is 0.75 m higher than the old trig-point top.",
    },
  };

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertSha256(bytes: Buffer, expected: string, label: string): void {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${label} checksum ${actual} does not match ${expected}`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded == null) throw new Error("Identity input contains a non-JSON value");
  return encoded;
}

function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${String(error)}`);
  }
}

function parseFinite(value: string, label: string): number {
  if (value.trim().length === 0 || !Number.isFinite(Number(value))) {
    throw new Error(`${label} is not a finite number`);
  }
  return Number(value);
}

function parseCsvRecords(bytes: Buffer, label: string): Array<Record<string, string>> {
  const matrix = parseStrictCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (matrix.length < 2) throw new Error(`${label} has no data rows`);
  const headers = matrix[0].map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error(`${label} has empty or repeated headers`);
  }
  return matrix.slice(1).map((row, index) => {
    if (row.length !== headers.length) {
      throw new Error(`${label} row ${index + 2} has ${row.length} fields; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, row[column]]));
  });
}

function parseCatalog(bytes: Buffer): Map<string, CatalogRow> {
  const expectedHeaders = [
    "id", "name", "elevation", "lat", "lng", "country_code", "state_code",
    "external_ids", "credited_cover", "active_peaks_routes",
  ].sort();
  const records = parseCsvRecords(bytes, "Catalog snapshot");
  const actualHeaders = Object.keys(records[0] ?? {}).sort();
  if (canonicalJson(actualHeaders) !== canonicalJson(expectedHeaders)) {
    throw new Error(`Catalog snapshot headers changed: ${actualHeaders.join(", ")}`);
  }
  const rows = new Map<string, CatalogRow>();
  for (const [index, record] of records.entries()) {
    const id = record.id.trim();
    const name = record.name.trim();
    if (!id || !name || rows.has(id)) {
      throw new Error(`Catalog row ${index + 2} repeats or omits its identity`);
    }
    let externalIds: unknown;
    try {
      externalIds = JSON.parse(record.external_ids);
    } catch {
      throw new Error(`Catalog destination ${id} has malformed external IDs`);
    }
    if (externalIds == null || typeof externalIds !== "object" || Array.isArray(externalIds) ||
        Object.entries(externalIds).some(([key, value]) =>
          !key.trim() || typeof value !== "string" || !value.trim())) {
      throw new Error(`Catalog destination ${id} has invalid external IDs`);
    }
    const normalizedExternalIds = sortedRecord(externalIds as Record<string, string>);
    const osmNodeId = normalizedExternalIds.osm ?? null;
    if (osmNodeId != null && !/^\d+$/.test(osmNodeId)) {
      throw new Error(`Catalog destination ${id} has an invalid OSM ID`);
    }
    rows.set(id, {
      id,
      name,
      elevationM: parseFinite(record.elevation, `Catalog destination ${id} elevation`),
      lat: parseFinite(record.lat, `Catalog destination ${id} latitude`),
      lng: parseFinite(record.lng, `Catalog destination ${id} longitude`),
      osmNodeId,
      countryCode: record.country_code.trim() || null,
      stateCode: record.state_code.trim() || null,
      externalIds: normalizedExternalIds,
    });
  }
  if (rows.size !== EXPECTED_CATALOG_ROWS) {
    throw new Error(`Catalog snapshot has ${rows.size} rows; expected ${EXPECTED_CATALOG_ROWS}`);
  }
  return rows;
}

function parseRawDobihEvidence(bytes: Buffer): Map<number, RawDobihEvidence> {
  const rows = new Map<number, RawDobihEvidence>();
  for (const [index, record] of parseCsvRecords(bytes, "DoBIH CSV").entries()) {
    if (!/^[1-9][0-9]*$/.test(record.Number)) {
      throw new Error(`DoBIH row ${index + 2} has an invalid Number`);
    }
    const number = Number(record.Number);
    if (rows.has(number)) throw new Error(`DoBIH CSV repeats Number ${number}`);
    rows.set(number, {
      number,
      name: record.Name.trim(),
      metres: parseFinite(record.Metres, `DoBIH ${number} elevation`),
      lat: parseFinite(record.Latitude, `DoBIH ${number} latitude`),
      lng: parseFinite(record.Longitude, `DoBIH ${number} longitude`),
      country: record.Country.trim(),
      feature: record.Feature.trim(),
      observations: record.Observations.trim(),
      survey: record.Survey.trim(),
      comments: record.Comments.trim(),
    });
  }
  return rows;
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const latDelta = rightLat - leftLat;
  const lngDelta = radians(right.lng - left.lng);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sourceNumber(sourceMemberId: string): number {
  const match = /^dobih:([1-9][0-9]*)$/.exec(sourceMemberId);
  if (match == null) throw new Error(`Invalid DoBIH source ID ${sourceMemberId}`);
  return Number(match[1]);
}

function dobihUrl(sourceMemberIdOrNumber: string | number): string {
  const number = typeof sourceMemberIdOrNumber === "number"
    ? sourceMemberIdOrNumber
    : sourceNumber(sourceMemberIdOrNumber);
  return `https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${number}`;
}

function catalogFingerprint(row: CatalogRow): KeeperDestinationFingerprint {
  return {
    name: row.name,
    elevationM: row.elevationM,
    lat: row.lat,
    lng: row.lng,
    osmNodeId: row.osmNodeId,
    countryCode: row.countryCode,
    stateCode: row.stateCode,
    externalIds: sortedRecord(row.externalIds),
  };
}

function candidateIndex(fixture: KeeperImportFixture): {
  members: Map<string, KeeperSourceMember>;
  owners: Map<string, string[]>;
  memberships: number;
} {
  const members = new Map<string, KeeperSourceMember>();
  const owners = new Map<string, string[]>();
  let memberships = 0;
  for (const sourceKey of SOURCE_KEYS) {
    const list = fixture.lists[sourceKey];
    if (list == null) throw new Error(`Candidate fixture is missing ${sourceKey}`);
    for (const member of list.rows) {
      memberships += 1;
      const previous = members.get(member.sourceMemberId);
      const { ordinal: _ordinal, ...identity } = member;
      if (previous == null) {
        members.set(member.sourceMemberId, member);
      } else {
        const { ordinal: _previousOrdinal, ...previousIdentity } = previous;
        if (canonicalJson(identity) !== canonicalJson(previousIdentity)) {
          throw new Error(`Candidate ${member.sourceMemberId} changes between lists`);
        }
      }
      owners.set(member.sourceMemberId, [
        ...(owners.get(member.sourceMemberId) ?? []),
        sourceKey,
      ]);
    }
  }
  return { members, owners, memberships };
}

function assertAnalysis(
  analysis: IdentityAnalysis,
  members: Map<string, KeeperSourceMember>,
  owners: Map<string, string[]>
): Map<string, ReusedAnalysisIdentity | NewAnalysisIdentity> {
  if (analysis.schemaVersion !== 1 || analysis.generatedAt !== REVIEWED_AT ||
      analysis.reviewedAt !== REVIEWED_AT || analysis.identityReviewComplete !== false ||
      analysis.publicationReady !== false ||
      analysis.catalogSnapshot.sha256 !== CATALOG_SHA256 ||
      analysis.catalogSnapshot.rows !== EXPECTED_CATALOG_ROWS ||
      analysis.catalogSnapshot.transaction !== "REPEATABLE READ READ ONLY" ||
      analysis.counts.memberships !== EXPECTED_MEMBERSHIPS ||
      analysis.counts.identities !== EXPECTED_IDENTITIES ||
      analysis.counts.reusedIdentities !== EXPECTED_REUSED ||
      analysis.counts.newIdentities !== EXPECTED_NEW ||
      analysis.counts.newCatalogAutoMatches !== EXPECTED_NEW_AUTOMATIC ||
      analysis.counts.newNeedsReview !== EXPECTED_OPEN ||
      analysis.counts.sourceNeighborPairsWithin150M !== 0 ||
      analysis.counts.publicationAccessBlocks !== 4 ||
      analysis.sourceNeighborPairs.length !== 0 ||
      analysis.requiredPriorAuxiliaryRepairs.length !== 0 ||
      canonicalJson(analysis.accessBlocks) !==
        canonicalJson(DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS)) {
    throw new Error("Smaller-majority-four analysis boundary changed");
  }
  if (analysis.inputs["DoBIH_v18_5.csv"] !== DOBIH_CSV_SHA256 ||
      analysis.inputs["small-majority-catalog-20260831.csv"] !== CATALOG_SHA256 ||
      analysis.sourceProvenance.name !== DOBIH_SOURCE_NAME ||
      analysis.sourceProvenance.license !== DOBIH_SOURCE_LICENSE) {
    throw new Error("Smaller-majority-four source provenance changed");
  }
  const all = [...analysis.reusedIdentities, ...analysis.newIdentities];
  if (analysis.reusedIdentities.length !== EXPECTED_REUSED ||
      analysis.newIdentities.length !== EXPECTED_NEW || all.length !== EXPECTED_IDENTITIES) {
    throw new Error("Smaller-majority-four analysis identity count changed");
  }
  const indexed = new Map<string, ReusedAnalysisIdentity | NewAnalysisIdentity>();
  for (const row of all) {
    const member = members.get(row.sourceMemberId);
    if (member == null || member.lat == null || member.lng == null ||
        indexed.has(row.sourceMemberId) || row.dobihNumber !== sourceNumber(row.sourceMemberId) ||
        row.name !== member.name || row.elevationM !== member.elevationM ||
        row.lat !== member.lat || row.lng !== member.lng || row.destinationCountryCode !== "GB" ||
        row.sourceUrl !== dobihUrl(row.sourceMemberId) ||
        canonicalJson(row.aliases) !== canonicalJson(member.aliases ?? []) ||
        canonicalJson(row.owners) !== canonicalJson(owners.get(row.sourceMemberId) ?? [])) {
      throw new Error(`Analysis source ${row.sourceMemberId} changed from the candidate fixture`);
    }
    indexed.set(row.sourceMemberId, row);
  }
  return indexed;
}

function assertAnalysisDestination(
  sourceMemberId: string,
  analysisDestination: AnalysisDestination,
  catalog: CatalogRow
): void {
  const expected = {
    id: catalog.id,
    name: catalog.name,
    elevationM: catalog.elevationM,
    lat: catalog.lat,
    lng: catalog.lng,
    osmNodeId: catalog.osmNodeId,
    countryCode: catalog.countryCode,
    stateCode: catalog.stateCode,
  };
  if (canonicalJson(analysisDestination) !== canonicalJson(expected)) {
    throw new Error(`Analysis destination ${sourceMemberId} changed from the catalog snapshot`);
  }
}

function existingResolution(
  row: AnalysisIdentity,
  destination: CatalogRow,
  evidence: string[]
): KeeperResolutionRow {
  if (destination.countryCode !== "GB") {
    throw new Error(`Existing destination ${destination.id} is not pinned to GB`);
  }
  return {
    sourceKey: "projection",
    sourceMemberId: row.sourceMemberId,
    resolution: "existing_destination",
    destinationId: destination.id,
    destinationName: destination.name,
    destinationElevationM: destination.elevationM,
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    destinationOsmNodeId: destination.osmNodeId,
    destinationCountryCode: destination.countryCode,
    destinationStateCode: destination.stateCode,
    destinationExternalIds: sortedRecord(destination.externalIds),
    evidence,
  };
}

function automaticExistingResolution(
  row: ReusedAnalysisIdentity | NewAnalysisIdentity,
  catalog: Map<string, CatalogRow>
): KeeperResolutionRow {
  if (row.destination == null) {
    throw new Error(`Automatic identity ${row.sourceMemberId} has no destination`);
  }
  const destination = catalog.get(row.destination.id);
  if (destination == null) throw new Error(`Catalog destination ${row.destination.id} is missing`);
  assertAnalysisDestination(row.sourceMemberId, row.destination, destination);
  const distanceM = Math.round(haversineMeters(row, destination));
  const elevationDeltaM = Math.abs(row.elevationM - destination.elevationM);
  return existingResolution(row, destination, [
    `The pinned analysis has one reviewed catalog destination ${distanceM} m from DoBIH ` +
      `${row.dobihNumber}, with ${elevationDeltaM} m elevation difference.`,
    `Reviewed source: ${row.sourceUrl}`,
  ]);
}

function nearExactExistingResolution(
  row: NewAnalysisIdentity,
  catalog: Map<string, CatalogRow>
): KeeperResolutionRow {
  const review = DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS[row.sourceMemberId];
  if (review == null || row.status !== "needs_review" || row.destination != null ||
      row.name !== review.sourceName || row.closeCatalogNeighbors.length !== 1) {
    throw new Error(`Near-exact source ${row.sourceMemberId} changed`);
  }
  const candidate = row.closeCatalogNeighbors[0];
  const destination = catalog.get(review.destinationId);
  if (destination == null || candidate.id !== review.destinationId ||
      destination.name !== review.destinationName ||
      Math.round(haversineMeters(row, destination)) !== review.distanceM ||
      Math.abs(row.elevationM - destination.elevationM) !== review.elevationDeltaM ||
      candidate.distanceM !== review.distanceM ||
      candidate.elevationDeltaM !== review.elevationDeltaM) {
    throw new Error(`Near-exact review ${row.sourceMemberId} changed its pinned evidence`);
  }
  return existingResolution(row, destination, [
    `${review.nameEvidence} The points are ${review.distanceM} m apart and their elevations ` +
      `differ by ${review.elevationDeltaM} m.`,
    `Reviewed source: ${row.sourceUrl}`,
  ]);
}

function yockenthwaiteRepair(
  row: NewAnalysisIdentity,
  catalog: Map<string, CatalogRow>
): KeeperResolutionRow {
  const review = DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS[row.sourceMemberId];
  const destination = catalog.get(review.destinationId);
  if (destination == null || destination.name !== "Yockenthwaite Moor" ||
      destination.elevationM !== 643 || destination.lat !== 54.225506 ||
      destination.lng !== -2.140927 || destination.countryCode !== null ||
      destination.stateCode !== null || destination.osmNodeId !== null ||
      canonicalJson(destination.externalIds) !== "{}" || review.distanceM !== 7 ||
      row.name !== destination.name || row.elevationM !== destination.elevationM ||
      Math.round(haversineMeters(row, destination)) !== 7) {
    throw new Error("Yockenthwaite Moor repair evidence changed");
  }
  return {
    sourceKey: "projection",
    sourceMemberId: row.sourceMemberId,
    resolution: "catalog_repair",
    destinationId: destination.id,
    destinationName: destination.name,
    destinationElevationM: destination.elevationM,
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    destinationOsmNodeId: null,
    destinationCountryCode: "GB",
    destinationStateCode: null,
    destinationDataSourceName: DOBIH_SOURCE_NAME,
    destinationDataSourceUrl: row.sourceUrl,
    destinationDataLicense: DOBIH_SOURCE_LICENSE,
    catalogBefore: catalogFingerprint(destination),
    evidence: [
      "The catalog and DoBIH names and 643 m elevations are exact; their points are 7 m apart. " +
        "Keep the catalog point and repair only its missing GB country code.",
      "The catalog row owns no external IDs before or after this repair.",
      `Reviewed source: ${row.sourceUrl}`,
    ],
  };
}

function assertCruimOsmEvidence(evidence: CruimOsmEvidence): void {
  if (evidence.schemaVersion !== 1 || evidence.reviewedAt !== REVIEWED_AT ||
      evidence.sourceUrl !== "https://api.openstreetmap.org/api/0.6/node/2781920981.json" ||
      evidence.sourcePageUrl !== "https://www.openstreetmap.org/node/2781920981" ||
      evidence.license !== "ODbL 1.0" ||
      evidence.licenseUrl !== "https://opendatacommons.org/licenses/odbl/1-0/" ||
      evidence.node.type !== "node" || evidence.node.id !== 2_781_920_981 ||
      evidence.node.lat !== 56.8795609 || evidence.node.lon !== -5.0137955 ||
      evidence.node.version !== 1 || evidence.node.timestamp !== "2014-04-10T18:21:03Z" ||
      canonicalJson(evidence.node.tags) !== canonicalJson({
        corbett: "no",
        description: "Crooked slope",
        ele: "232",
        graham: "no",
        marilyn: "yes",
        munro: "no",
        name: "Cruim Leacainn",
        natural: "peak",
        prominence: "150",
      })) {
    throw new Error("Cruim Leacainn OSM evidence changed");
  }
}

function cruimLeacainnRepair(
  row: NewAnalysisIdentity,
  catalog: Map<string, CatalogRow>,
  rawRows: Map<number, RawDobihEvidence>,
  osmEvidence: CruimOsmEvidence
): KeeperResolutionRow {
  const destination = catalog.get("D32B52D720CF6A0BD155");
  const raw = rawRows.get(344);
  if (destination == null || raw == null || row.sourceMemberId !== "dobih:344" ||
      row.name !== "Cruim Leacainn" || row.elevationM !== 231.1 ||
      row.lat !== 56.88175 || row.lng !== -5.010484 ||
      destination.name !== "Cruim Leacainn" || destination.elevationM !== 232 ||
      destination.lat !== 56.8795609 || destination.lng !== -5.0137955 ||
      destination.countryCode !== "GB" || destination.stateCode !== null ||
      destination.osmNodeId !== "2781920981" ||
      canonicalJson(destination.externalIds) !== canonicalJson({ osm: "2781920981" }) ||
      Math.round(haversineMeters(row, destination)) !== 316 ||
      Math.abs(row.elevationM - destination.elevationM) !== 0.9000000000000057 ||
      raw.name !== "Cruim Leacainn" || raw.metres !== 231.1 ||
      raw.lat !== row.lat || raw.lng !== row.lng || raw.country !== "S" ||
      raw.feature !== "knoll 300m NE of trig point" ||
      raw.observations !== "trig point is at NN 16462 80519 and about 2.5m lower" ||
      raw.survey !== "Abney level/Leica RX1250" ||
      raw.comments !== "Reclassified as Submarilyn April 2014" ||
      osmEvidence.node.id.toString() !== destination.osmNodeId) {
    throw new Error("Cruim Leacainn repair evidence changed");
  }
  return {
    sourceKey: "projection",
    sourceMemberId: row.sourceMemberId,
    resolution: "catalog_repair",
    destinationId: destination.id,
    destinationName: row.name,
    destinationElevationM: row.elevationM,
    destinationLat: row.lat,
    destinationLng: row.lng,
    destinationOsmNodeId: null,
    destinationCountryCode: "GB",
    destinationStateCode: null,
    destinationDataSourceName:
      "The Database of British and Irish Hills v18.5 and OpenStreetMap contributors",
    destinationDataSourceUrl: row.sourceUrl,
    destinationDataLicense: "CC BY 4.0; ODbL 1.0",
    catalogBefore: catalogFingerprint(destination),
    catalogExternalIdRemovals: { osm: "2781920981" },
    evidence: [
      "DoBIH places the surveyed 231.1 m summit on the knoll 300 m northeast of the trig " +
        "point and says the trig point is about 2.5 m lower.",
      "The catalog point is 316 m from the DoBIH summit and 0.9 m higher; it owns the sole " +
        "catalog reference to OSM node 2781920981, which remains at that old 232 m point.",
      "Repair the existing mountain identity to the DoBIH point and remove the stale, " +
        "coordinate-bound OSM ID; do not create or spatially infer a second identity.",
      `Reviewed source: ${row.sourceUrl}`,
      `Reviewed source: ${osmEvidence.sourcePageUrl}`,
    ],
  };
}

function curatedResolution(
  row: NewAnalysisIdentity,
  rawRows: Map<number, RawDobihEvidence>,
  catalog: Map<string, CatalogRow>
): KeeperResolutionRow {
  if (row.status !== "needs_review" || row.destination != null ||
      row.automaticCandidates.length !== 0 || row.closeCatalogNeighbors.length !== 0) {
    throw new Error(`Curated source ${row.sourceMemberId} is not a pinned open identity`);
  }
  const raw = rawRows.get(row.dobihNumber);
  if (raw == null || raw.metres !== row.elevationM || raw.lat !== row.lat || raw.lng !== row.lng ||
      !["E", "ES", "S", "W"].includes(raw.country)) {
    throw new Error(`Curated source ${row.sourceMemberId} changed from DoBIH`);
  }
  const review = DOBIH_SMALLER_MAJORITY_FOUR_SEMANTIC_DISTINCT_REVIEWS[row.sourceMemberId];
  const evidence = [
    `DoBIH v18.5 lists this GB summit at ${row.elevationM} m, ${row.lat}, ${row.lng}; ` +
      "the pinned catalog analysis found no valid catalog identity and no summit within the " +
      `${DUPLICATE_GUARD_M} m duplicate guard.`,
  ];
  let distinctFromDestinationIds: string[] | undefined;
  let destinationName = row.name;
  if (review != null) {
    destinationName = review.destinationName;
    distinctFromDestinationIds = review.distinct.map((candidate) => candidate.destinationId).sort();
    evidence.push(review.evidence);
    for (const distinct of review.distinct) {
      const destination = catalog.get(distinct.destinationId);
      if (destination == null || destination.name !== distinct.name ||
          Math.round(haversineMeters(row, destination)) !== distinct.distanceM) {
        throw new Error(`Semantic neighbor ${row.sourceMemberId}/${distinct.destinationId} changed`);
      }
      evidence.push(
        `Reviewed as distinct from ${destination.id}:${destination.name}, ${distinct.distanceM} m away.`
      );
    }
    for (const supportNumber of review.supportDobihNumbers) {
      const support = rawRows.get(supportNumber);
      if (support == null) throw new Error(`DoBIH support ${supportNumber} is missing`);
      evidence.push(
        `DoBIH ${supportNumber} lists the separate ${support.name} at ${support.metres} m. ` +
          `Reviewed source: ${dobihUrl(supportNumber)}`
      );
    }
  }
  evidence.push(`Reviewed source: ${row.sourceUrl}`);
  return {
    sourceKey: "projection",
    sourceMemberId: row.sourceMemberId,
    resolution: "curated_destination",
    destinationId: deterministicKeeperDestinationId(row.sourceMemberId),
    destinationName,
    destinationElevationM: row.elevationM,
    destinationLat: row.lat,
    destinationLng: row.lng,
    destinationOsmNodeId: null,
    destinationCountryCode: "GB",
    destinationStateCode: null,
    destinationExternalIds: {},
    destinationDataSourceName: DOBIH_SOURCE_NAME,
    destinationDataSourceUrl: row.sourceUrl,
    destinationDataLicense: DOBIH_SOURCE_LICENSE,
    ...(distinctFromDestinationIds == null ? {} : { distinctFromDestinationIds }),
    evidence,
  };
}

function assertOsmOwnership(
  catalog: Map<string, CatalogRow>,
  osmNodeId: string,
  expectedDestinationId: string
): void {
  const owners = [...catalog.values()].filter((row) => row.externalIds.osm === osmNodeId);
  if (owners.length !== 1 || owners[0].id !== expectedDestinationId) {
    throw new Error(
      `OSM node ${osmNodeId} owners changed: ${owners.map((owner) => owner.id).join(", ")}`
    );
  }
}

function assertResolutionCollisions(
  rowsBySourceId: Map<string, KeeperResolutionRow>,
  catalog: Map<string, CatalogRow>
): void {
  const sourceByDestination = new Map<string, string>();
  for (const row of rowsBySourceId.values()) {
    const prior = sourceByDestination.get(row.destinationId);
    if (prior != null && prior !== row.sourceMemberId) {
      throw new Error(`Destination ${row.destinationId} is assigned to ${prior} and ${row.sourceMemberId}`);
    }
    sourceByDestination.set(row.destinationId, row.sourceMemberId);
    if (row.destinationCountryCode !== "GB" || row.destinationStateCode !== null ||
        row.destinationElevationM < 0 || row.destinationElevationM > 1_500 ||
        row.destinationLat < 49 || row.destinationLat > 61 ||
        row.destinationLng < -11 || row.destinationLng > 3) {
      throw new Error(`Resolution ${row.sourceMemberId} is outside the pinned GB bounds`);
    }
  }
  if (sourceByDestination.size !== EXPECTED_IDENTITIES) {
    throw new Error(`Resolution fixture has ${sourceByDestination.size} unique destinations`);
  }

  const uniqueRows = [...rowsBySourceId.values()];
  for (const row of uniqueRows.filter((candidate) =>
    candidate.resolution === "curated_destination"
  )) {
    if (catalog.has(row.destinationId)) {
      throw new Error(
        `Curated ${row.sourceMemberId} collides with catalog destination ID ${row.destinationId}`
      );
    }
    const guards = new Set(row.distinctFromDestinationIds ?? []);
    for (const destination of catalog.values()) {
      const distanceM = haversineMeters(
        { lat: row.destinationLat, lng: row.destinationLng },
        destination
      );
      if (distanceM <= DUPLICATE_GUARD_M && !guards.has(destination.id)) {
        throw new Error(
          `Curated ${row.sourceMemberId} is ${Math.round(distanceM)} m from unreviewed catalog ` +
          destination.id
        );
      }
    }
    for (const other of uniqueRows) {
      if (other.sourceMemberId === row.sourceMemberId || other.destinationId === row.destinationId) {
        continue;
      }
      const distanceM = haversineMeters(
        { lat: row.destinationLat, lng: row.destinationLng },
        { lat: other.destinationLat, lng: other.destinationLng }
      );
      if (distanceM <= DUPLICATE_GUARD_M && !guards.has(other.destinationId)) {
        throw new Error(
          `Curated ${row.sourceMemberId} is ${Math.round(distanceM)} m from unreviewed accepted ` +
          other.sourceMemberId
        );
      }
    }
  }
}

function existingProjectionOfRepair(row: KeeperResolutionRow, sourceKey: string): KeeperResolutionRow {
  return {
    sourceKey,
    sourceMemberId: row.sourceMemberId,
    resolution: "existing_destination",
    destinationId: row.destinationId,
    destinationName: row.destinationName,
    destinationElevationM: row.destinationElevationM,
    destinationLat: row.destinationLat,
    destinationLng: row.destinationLng,
    destinationOsmNodeId: row.destinationOsmNodeId,
    destinationCountryCode: row.destinationCountryCode,
    destinationStateCode: row.destinationStateCode,
    evidence: row.evidence,
  };
}

export function buildDobihSmallerMajorityFourResolutions(
  inputs: DobihSmallerMajorityFourResolutionInputs
): KeeperResolutionFixture {
  assertSha256(inputs.candidateBytes, CANDIDATE_SHA256, "Candidate fixture");
  assertSha256(inputs.analysisBytes, ANALYSIS_SHA256, "Identity analysis");
  assertSha256(inputs.dobihCsvBytes, DOBIH_CSV_SHA256, "DoBIH CSV");
  assertSha256(inputs.catalogBytes, CATALOG_SHA256, "Catalog snapshot");
  assertSha256(
    inputs.cruimOsmEvidenceBytes,
    CRUIM_OSM_EVIDENCE_SHA256,
    "Cruim Leacainn OSM evidence"
  );

  const fixture = parseJson<KeeperImportFixture>(inputs.candidateBytes, "Candidate fixture");
  const analysis = parseJson<IdentityAnalysis>(inputs.analysisBytes, "Identity analysis");
  const catalog = parseCatalog(inputs.catalogBytes);
  const rawRows = parseRawDobihEvidence(inputs.dobihCsvBytes);
  const osmEvidence = parseJson<CruimOsmEvidence>(
    inputs.cruimOsmEvidenceBytes,
    "Cruim Leacainn OSM evidence"
  );
  assertCruimOsmEvidence(osmEvidence);
  validateKeeperFixture(fixture, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
  const { members, owners, memberships } = candidateIndex(fixture);
  if (memberships !== EXPECTED_MEMBERSHIPS || members.size !== EXPECTED_IDENTITIES) {
    throw new Error(`Candidate scope is ${memberships}/${members.size}; expected 678/648`);
  }
  const analysisBySourceId = assertAnalysis(analysis, members, owners);

  const reused = analysis.reusedIdentities.filter((row) =>
    row.status === "reused_explicit" || row.status === "reused_automatic"
  );
  const automatic = analysis.newIdentities.filter((row) => row.status === "catalog_auto_match");
  const open = analysis.newIdentities.filter((row) => row.status === "needs_review");
  if (reused.length !== EXPECTED_REUSED || automatic.length !== EXPECTED_NEW_AUTOMATIC ||
      open.length !== EXPECTED_OPEN ||
      analysis.reusedIdentities.some((row) => row.status === "reused_needs_review")) {
    throw new Error("Pinned analysis decision groups changed");
  }

  const specialExistingIds = new Set(
    Object.keys(DOBIH_SMALLER_MAJORITY_FOUR_NEAR_EXACT_REVIEWS).filter((sourceMemberId) =>
      sourceMemberId !== "dobih:2791"
    )
  );
  const repairIds = new Set(["dobih:344", "dobih:2791"]);
  if (specialExistingIds.size !== EXPECTED_OPEN_EXISTING || repairIds.size !== EXPECTED_OPEN_REPAIRS) {
    throw new Error("Reviewed open-decision tables changed");
  }

  const rowsBySourceId = new Map<string, KeeperResolutionRow>();
  for (const row of analysis.reusedIdentities) {
    let resolution: KeeperResolutionRow;
    if (row.status === "reused_explicit") {
      if (row.reviewedResolution == null || row.reviewedResolutionSha256 == null ||
          canonicalSha256(row.reviewedResolution) !== row.reviewedResolutionSha256 ||
          row.requiredAuxiliaryRepairId !== null) {
        throw new Error(`Prior explicit resolution ${row.sourceMemberId} changed`);
      }
      resolution = { ...row.reviewedResolution, sourceKey: "projection" };
    } else if (row.status === "reused_automatic") {
      if (row.reviewedResolution != null || row.reviewedResolutionSha256 != null) {
        throw new Error(`Prior automatic resolution ${row.sourceMemberId} gained an explicit row`);
      }
      resolution = automaticExistingResolution(row, catalog);
    } else {
      throw new Error(`Prior source ${row.sourceMemberId} remains unresolved`);
    }
    rowsBySourceId.set(row.sourceMemberId, resolution);
  }
  for (const row of automatic) {
    rowsBySourceId.set(row.sourceMemberId, automaticExistingResolution(row, catalog));
  }
  for (const row of open) {
    let resolution: KeeperResolutionRow;
    if (specialExistingIds.has(row.sourceMemberId)) {
      resolution = nearExactExistingResolution(row, catalog);
    } else if (row.sourceMemberId === "dobih:2791") {
      resolution = yockenthwaiteRepair(row, catalog);
    } else if (row.sourceMemberId === "dobih:344") {
      resolution = cruimLeacainnRepair(row, catalog, rawRows, osmEvidence);
    } else {
      resolution = curatedResolution(row, rawRows, catalog);
    }
    rowsBySourceId.set(row.sourceMemberId, resolution);
  }
  if (rowsBySourceId.size !== EXPECTED_IDENTITIES ||
      [...analysisBySourceId.keys()].some((sourceMemberId) => !rowsBySourceId.has(sourceMemberId))) {
    throw new Error("Full identity decision table is incomplete");
  }

  const openKinds = open.reduce((counts, row) => {
    const kind = rowsBySourceId.get(row.sourceMemberId)!.resolution;
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const fullKinds = [...rowsBySourceId.values()].reduce((counts, row) => {
    counts[row.resolution] = (counts[row.resolution] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  if (openKinds.existing_destination !== EXPECTED_OPEN_EXISTING ||
      openKinds.catalog_repair !== EXPECTED_OPEN_REPAIRS ||
      openKinds.curated_destination !== EXPECTED_OPEN_CURATED ||
      fullKinds.existing_destination !== EXPECTED_EXISTING ||
      fullKinds.catalog_repair !== EXPECTED_REPAIRS ||
      fullKinds.curated_destination !== EXPECTED_CURATED) {
    throw new Error(
      `Identity decision counts changed: open=${canonicalJson(openKinds)} ` +
      `full=${canonicalJson(fullKinds)}`
    );
  }

  assertOsmOwnership(catalog, "2781920981", "D32B52D720CF6A0BD155");
  const yockOwners = [...catalog.values()].filter((row) =>
    Object.values(row.externalIds).some((value) => value === "5Fmpn5fM3oxvOEYhwErB")
  );
  if (yockOwners.length !== 0) throw new Error("Yockenthwaite repair gained an external-ID owner");
  assertResolutionCollisions(rowsBySourceId, catalog);

  const lists = Object.fromEntries(SOURCE_KEYS.map((sourceKey) => [sourceKey, { rows: [] }])) as
    KeeperResolutionFixture["lists"];
  const assignedRepairs = new Set<string>();
  for (const sourceKey of SOURCE_KEYS) {
    for (const member of fixture.lists[sourceKey].rows) {
      const identity = rowsBySourceId.get(member.sourceMemberId);
      if (identity == null) throw new Error(`No resolution for ${sourceKey}/${member.sourceMemberId}`);
      let projection: KeeperResolutionRow;
      if (identity.resolution === "catalog_repair" && assignedRepairs.has(identity.sourceMemberId)) {
        projection = existingProjectionOfRepair(identity, sourceKey);
      } else {
        projection = { ...identity, sourceKey };
        if (identity.resolution === "catalog_repair") assignedRepairs.add(identity.sourceMemberId);
      }
      lists[sourceKey].rows.push(projection);
    }
  }

  const result: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: REVIEWED_AT,
    catalogSnapshotSha256: CATALOG_SHA256,
    catalogSnapshots: {
      "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json": CANDIDATE_SHA256,
      "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json":
        ANALYSIS_SHA256,
      "DoBIH_v18_5.csv": DOBIH_CSV_SHA256,
      "small-majority-catalog-20260831.csv": CATALOG_SHA256,
      "dobih-smaller-majority-four-cruim-leacainn-osm-evidence-2026-08-31.json":
        CRUIM_OSM_EVIDENCE_SHA256,
    },
    catalogRepairs: [],
    lists,
  };
  const resultRows = Object.values(lists).flatMap((list) => list.rows);
  if (resultRows.length !== EXPECTED_MEMBERSHIPS ||
      DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY !== false ||
      DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS.length !== 4 ||
      DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS.some((block) =>
        block.routePublicationAllowed !== false || !rowsBySourceId.has(block.sourceMemberId))) {
    throw new Error("Resolution fixture lost its publication boundary or access blocks");
  }
  validateKeeperResolutionFixture(fixture, result, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
  validateKeeperCrossListConsistency(fixture, result, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
  return result;
}

function parseArgs(argv: string[]): BuildArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args: BuildArgs = {
    candidates: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
    ),
    analysis: path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json"
    ),
    dobihCsv: "/private/tmp/dobih-v18.5/DoBIH_v18_5.csv",
    catalog: "/private/tmp/small-majority-catalog-20260831.csv",
    cruimOsmEvidence: path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "dobih-smaller-majority-four-cruim-leacainn-osm-evidence-2026-08-31.json"
    ),
    output: path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-dobih-smaller-majority-four-identity-resolutions-2026-08-31.json"
    ),
  };
  const options: Array<[string, keyof BuildArgs]> = [
    ["--candidates=", "candidates"],
    ["--analysis=", "analysis"],
    ["--dobih-csv=", "dobihCsv"],
    ["--catalog=", "catalog"],
    ["--cruim-osm-evidence=", "cruimOsmEvidence"],
    ["--output=", "output"],
  ];
  const seen = new Set<keyof BuildArgs>();
  for (const argument of argv) {
    const option = options.find(([prefix]) => argument.startsWith(prefix));
    if (option == null) throw new Error(`Unknown option: ${argument}`);
    const [prefix, key] = option;
    const value = argument.slice(prefix.length).trim();
    if (!value || seen.has(key)) throw new Error(`${prefix.slice(0, -1)} is missing or repeated`);
    args[key] = path.resolve(value);
    seen.add(key);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [candidateBytes, analysisBytes, dobihCsvBytes, catalogBytes, cruimOsmEvidenceBytes] =
    await Promise.all([
      fs.readFile(args.candidates),
      fs.readFile(args.analysis),
      fs.readFile(args.dobihCsv),
      fs.readFile(args.catalog),
      fs.readFile(args.cruimOsmEvidence),
    ]);
  const result = buildDobihSmallerMajorityFourResolutions({
    candidateBytes,
    analysisBytes,
    dobihCsvBytes,
    catalogBytes,
    cruimOsmEvidenceBytes,
  });
  await fs.writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Wrote ${Object.values(result.lists).flatMap((list) => list.rows).length} memberships ` +
      `to ${args.output}\n`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
