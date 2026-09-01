/** Builds a fail-closed identity analysis for the queued DoBIH smaller-majority-four rosters. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DOBIH_CSV_SHA256,
  buildDobihSourceMember,
  parseDobihRows,
  parseStrictCsv,
  type ParsedDobihRow,
} from "./build-dobih-open-eight-fixture";
import { BASE_THREE_KEEPER_LISTS } from "./keeper-list-import/bundles/base-three";
import {
  DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS,
  DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_WELSH_3000S_NUMBERS,
} from "./keeper-list-import/bundles/dobih-smaller-majority-four";
import {
  DOBIH_OPEN_EIGHT_KEEPER_LISTS,
} from "./keeper-list-import/bundles/dobih-open-eight";
import {
  normalizeKeeperPeakName,
  resolveKeeperList,
  validateKeeperCrossListConsistency,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
  type KeeperAuxiliaryCatalogRepair,
  type KeeperCatalogPeak,
  type KeeperDestinationFingerprint,
  type KeeperImportFixture,
  type KeeperListDefinition,
  type KeeperResolutionFixture,
  type KeeperResolutionRow,
  type KeeperSourceMember,
} from "./keeper-list-import/core";

const GENERATED_AT = "2026-08-31";
const REVIEWED_AT = "2026-08-31";
const CATALOG_FILE = "small-majority-catalog-20260831.csv";
const INPUT_SHA256 = {
  majorityCandidates:
    "4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b",
  baseCandidates:
    "d29c543e4362c95a6ec6b4bd9b8bffe281a9e967096228a887aea158a5b53a7d",
  baseResolutions:
    "326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77",
  openEightCandidates:
    "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae",
  openEightResolutions:
    "bca584753ca3eb8c3b321354cc4e6728f3dcd8d5f5293544fb4ca1efa7ceedb1",
  dobihCsv: DOBIH_CSV_SHA256,
  catalog:
    "b53e49b3077203e57b657b2a53743cc58504d9ceabd35c22d1664d2b618f5fab",
} as const;

const EXPECTED_CATALOG_ROWS = 2_524;
const EXPECTED_MEMBERSHIPS = 678;
const EXPECTED_IDENTITIES = 648;
const EXPECTED_PRIOR_IDENTITIES = 121;
const EXPECTED_PRIOR_EXPLICIT = 27;
const EXPECTED_NEW_IDENTITIES = 527;
const EXPECTED_SOURCE_NEIGHBOR_PAIRS = 0;
const MAX_AUTOMATIC_DISTANCE_M = 250;
const MAX_AUTOMATIC_ELEVATION_DELTA_M = 100;
const MAX_NEARBY_DISTANCE_M = 5_000;
const DISTINCT_NEIGHBOR_DISTANCE_M = 150;

const DOBIH_SOURCE_NAME = "The Database of British and Irish Hills v18.5";
const DOBIH_SOURCE_URL = "https://www.hill-bagging.co.uk/dobih/downloads/";
const DOBIH_SOURCE_LICENSE = "CC BY 4.0";

const ACCESS_BLOCKS = DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS;
const WELSH_3000S_NUMBER_SET = new Set<number>(DOBIH_WELSH_3000S_NUMBERS);

type PriorFixtureName = "base-three" | "open-eight";
type NewIdentityStatus = "catalog_auto_match" | "needs_review";

interface CatalogRow extends KeeperCatalogPeak {
  elevationM: number;
}

interface PriorContext {
  name: PriorFixtureName;
  fixture: KeeperImportFixture;
  resolutions: KeeperResolutionFixture;
  definitions: KeeperListDefinition[];
}

interface PriorOwner {
  fixture: PriorFixtureName;
  sourceKey: string;
  member: KeeperSourceMember;
  definition: KeeperListDefinition;
  resolution: KeeperResolutionRow | null;
}

interface DestinationIdentity {
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  osmNodeId: string | null;
  countryCode: string | null;
  stateCode: string | null;
}

interface CatalogCandidate extends DestinationIdentity {
  distanceM: number;
  elevationDeltaM: number;
  normalizedNameMatch: boolean;
}

interface SourceIdentity {
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

interface ReusedIdentityAnalysis extends SourceIdentity {
  status: "reused_explicit" | "reused_automatic" | "reused_needs_review";
  destination: DestinationIdentity | null;
  automaticCandidates: CatalogCandidate[];
  blockingReasons: string[];
  priorOwners: Array<{
    fixture: PriorFixtureName;
    sourceKey: string;
    mode: "automatic" | KeeperResolutionRow["resolution"];
  }>;
  reviewedResolution: Omit<KeeperResolutionRow, "sourceKey"> | null;
  reviewedResolutionSha256: string | null;
  requiredAuxiliaryRepairId: string | null;
}

interface NewIdentityAnalysis extends SourceIdentity {
  status: NewIdentityStatus;
  destination: DestinationIdentity | null;
  automaticCandidates: CatalogCandidate[];
  nearbyCandidates: CatalogCandidate[];
  closeCatalogNeighbors: CatalogCandidate[];
  blockingReasons: string[];
}

interface SourceNeighborPair {
  leftSourceMemberId: string;
  leftName: string;
  rightSourceMemberId: string;
  rightName: string;
  distanceM: number;
}

export interface DobihSmallerMajorityFourIdentityAnalysis {
  schemaVersion: 1;
  generatedAt: string;
  reviewedAt: string;
  identityReviewComplete: boolean;
  publicationReady: false;
  inputs: Record<string, string>;
  sourceProvenance: Record<string, unknown>;
  catalogSnapshot: {
    file: string;
    sha256: string;
    rows: number;
    transaction: "REPEATABLE READ READ ONLY";
    selection: string;
  };
  matchingRules: {
    automatic: string;
    nearby: string;
    duplicateGuard: string;
  };
  counts: {
    memberships: number;
    identities: number;
    reusedIdentities: number;
    reusedExplicitIdentities: number;
    reusedAutomaticIdentities: number;
    reusedNeedsReview: number;
    reusedAutomaticIdentityCollisions: number;
    newIdentities: number;
    newCatalogAutoMatches: number;
    newNeedsReview: number;
    newAutomaticIdentityCollisions: number;
    sourceNeighborPairsWithin150M: number;
    publicationAccessBlocks: number;
    curatedDestinations: 0;
  };
  accessBlocks: Array<(typeof ACCESS_BLOCKS)[number]>;
  sourceNeighborPairs: SourceNeighborPair[];
  requiredPriorAuxiliaryRepairs: KeeperAuxiliaryCatalogRepair[];
  reusedIdentities: ReusedIdentityAnalysis[];
  newIdentities: NewIdentityAnalysis[];
}

export interface DobihSmallerMajorityFourIdentityAnalysisInputs {
  majorityCandidateBytes: Buffer;
  baseCandidateBytes: Buffer;
  baseResolutionBytes: Buffer;
  openEightCandidateBytes: Buffer;
  openEightResolutionBytes: Buffer;
  dobihCsvBytes: Buffer;
  catalogBytes: Buffer;
}

interface BuildArgs {
  candidates: string;
  baseCandidates: string;
  baseResolutions: string;
  openEightCandidates: string;
  openEightResolutions: string;
  dobihCsv: string;
  catalog: string;
  output: string;
  allowIncomplete: boolean;
}

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
  if (encoded == null) throw new Error("Identity analysis contains a non-JSON value");
  return encoded;
}

function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

function parseJson<T>(bytes: Buffer, label: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseFinite(value: string, label: string): number {
  if (value.trim().length === 0) throw new Error(`${label} is missing`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not finite`);
  return parsed;
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function parseCatalog(bytes: Buffer): CatalogRow[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const matrix = parseStrictCsv(text);
  const expectedHeaders = [
    "id", "name", "elevation", "lat", "lng", "country_code", "state_code",
    "external_ids", "credited_cover", "active_peaks_routes",
  ];
  if (canonicalJson(matrix[0]) !== canonicalJson(expectedHeaders)) {
    throw new Error("Catalog snapshot headers changed");
  }
  const ids = new Set<string>();
  const rows = matrix.slice(1).map((values, index): CatalogRow => {
    if (values.length !== expectedHeaders.length) {
      throw new Error(`Catalog row ${index + 2} has the wrong field count`);
    }
    const record = Object.fromEntries(expectedHeaders.map((header, column) => [
      header,
      values[column],
    ]));
    const id = record.id.trim();
    const name = record.name.trim();
    if (!id || !name || ids.has(id)) {
      throw new Error(`Catalog row ${index + 2} repeats or omits its identity`);
    }
    ids.add(id);
    let externalIds: unknown;
    try {
      externalIds = JSON.parse(record.external_ids);
    } catch {
      throw new Error(`Catalog destination ${id} has malformed external IDs`);
    }
    if (externalIds == null || typeof externalIds !== "object" ||
        Array.isArray(externalIds) || Object.entries(externalIds).some(([key, value]) =>
          key.trim().length === 0 || typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(`Catalog destination ${id} has invalid external IDs`);
    }
    const normalizedExternalIds = sortedRecord(externalIds as Record<string, string>);
    if (!/^[0-9]+$/.test(record.credited_cover) ||
        !/^[0-9]+$/.test(record.active_peaks_routes)) {
      throw new Error(`Catalog destination ${id} has invalid coverage counts`);
    }
    const osmId = normalizedExternalIds.osm ?? null;
    const lat = parseFinite(record.lat, `Catalog destination ${id} latitude`);
    const lng = parseFinite(record.lng, `Catalog destination ${id} longitude`);
    if (lat < 49 || lat > 61 || lng < -11 || lng > 3) {
      throw new Error(`Catalog destination ${id} is outside the pinned snapshot bounds`);
    }
    return {
      id,
      name,
      elevationM: parseFinite(record.elevation, `Catalog destination ${id} elevation`),
      lat,
      lng,
      countryCode: record.country_code.trim() || null,
      stateCode: record.state_code.trim() || null,
      osmId,
      externalIds: normalizedExternalIds,
      owner: "peaks",
      destinationType: "point",
      features: ["summit"],
    };
  });
  if (rows.length !== EXPECTED_CATALOG_ROWS) {
    throw new Error(`Catalog snapshot has ${rows.length} rows; expected ${EXPECTED_CATALOG_ROWS}`);
  }
  return rows;
}

function sourceNumber(sourceMemberId: string): number {
  const match = /^dobih:([1-9][0-9]*)$/.exec(sourceMemberId);
  if (match == null) throw new Error(`Invalid DoBIH source member ID ${sourceMemberId}`);
  return Number(match[1]);
}

function sourceUrl(sourceMemberId: string): string {
  return `https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${sourceNumber(sourceMemberId)}`;
}

function memberIdentity(member: KeeperSourceMember): Omit<KeeperSourceMember, "ordinal"> {
  const { ordinal: _ordinal, ...identity } = member;
  return identity;
}

function resolutionWithoutSourceKey(
  row: KeeperResolutionRow
): Omit<KeeperResolutionRow, "sourceKey"> {
  const { sourceKey: _sourceKey, ...resolution } = row;
  return resolution;
}

function destinationFromResolution(row: KeeperResolutionRow): DestinationIdentity {
  return {
    id: row.destinationId,
    name: row.destinationName,
    elevationM: row.destinationElevationM,
    lat: row.destinationLat,
    lng: row.destinationLng,
    osmNodeId: row.destinationOsmNodeId,
    countryCode: row.destinationCountryCode,
    stateCode: row.destinationStateCode,
  };
}

function destinationFromCatalog(row: CatalogRow): DestinationIdentity {
  return {
    id: row.id,
    name: row.name,
    elevationM: row.elevationM,
    lat: row.lat,
    lng: row.lng,
    osmNodeId: row.osmId,
    countryCode: row.countryCode,
    stateCode: row.stateCode,
  };
}

function destinationIdentity(row: DestinationIdentity): DestinationIdentity {
  return {
    id: row.id,
    name: row.name,
    elevationM: row.elevationM,
    lat: row.lat,
    lng: row.lng,
    osmNodeId: row.osmNodeId,
    countryCode: row.countryCode,
    stateCode: row.stateCode,
  };
}

function catalogFingerprint(row: CatalogRow): KeeperDestinationFingerprint {
  return {
    name: row.name,
    elevationM: row.elevationM,
    lat: row.lat,
    lng: row.lng,
    osmNodeId: row.osmId,
    countryCode: row.countryCode,
    stateCode: row.stateCode,
    externalIds: sortedRecord(row.externalIds),
  };
}

function fingerprintWithoutExternalIds(
  value: KeeperDestinationFingerprint
): Omit<KeeperDestinationFingerprint, "externalIds"> {
  const { externalIds: _externalIds, ...fingerprint } = value;
  return fingerprint;
}

function resolutionFingerprint(
  row: KeeperResolutionRow
): Omit<KeeperDestinationFingerprint, "externalIds"> {
  return {
    name: row.destinationName,
    elevationM: row.destinationElevationM,
    lat: row.destinationLat,
    lng: row.destinationLng,
    osmNodeId: row.destinationOsmNodeId,
    countryCode: row.destinationCountryCode,
    stateCode: row.destinationStateCode,
  };
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const latitudeDelta = rightLat - leftLat;
  const longitudeDelta = radians(right.lng - left.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function catalogCandidate(
  source: KeeperSourceMember,
  catalog: CatalogRow
): CatalogCandidate {
  const sourceNames = new Set([source.name, ...(source.aliases ?? [])].map(
    normalizeKeeperPeakName
  ));
  return {
    ...destinationFromCatalog(catalog),
    distanceM: Math.round(haversineMeters(source as Required<Pick<
      KeeperSourceMember,
      "lat" | "lng"
    >>, catalog)),
    elevationDeltaM: Math.abs(source.elevationM - catalog.elevationM),
    normalizedNameMatch: sourceNames.has(normalizeKeeperPeakName(catalog.name)),
  };
}

function sortCatalogCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  return candidates.sort((left, right) => left.distanceM - right.distanceM ||
    left.elevationDeltaM - right.elevationDeltaM || left.id.localeCompare(right.id));
}

function automaticCandidates(
  source: KeeperSourceMember,
  definition: KeeperListDefinition,
  catalog: CatalogRow[]
): CatalogCandidate[] {
  const sourceNames = new Set([source.name, ...(source.aliases ?? [])].map(
    normalizeKeeperPeakName
  ));
  return sortCatalogCandidates(catalog.filter((peak) =>
    sourceNames.has(normalizeKeeperPeakName(peak.name)) &&
    Math.abs(peak.elevationM - source.elevationM) <= MAX_AUTOMATIC_ELEVATION_DELTA_M &&
    (definition.allowedCountryCodes == null ||
      (peak.countryCode != null && definition.allowedCountryCodes.includes(peak.countryCode))) &&
    (definition.allowedStateCodes == null ||
      (peak.stateCode != null && definition.allowedStateCodes.includes(peak.stateCode))) &&
    haversineMeters(source as Required<Pick<KeeperSourceMember, "lat" | "lng">>, peak) <=
      MAX_AUTOMATIC_DISTANCE_M
  ).map((peak) => catalogCandidate(source, peak)));
}

function assertCoreAutomaticResult(
  source: KeeperSourceMember,
  definition: KeeperListDefinition,
  catalog: CatalogRow[],
  candidates: CatalogCandidate[]
): void {
  if (Object.keys(definition.destinationOverrides).length !== 0) {
    throw new Error(`Prior list ${definition.sourceKey} unexpectedly has destination overrides`);
  }
  const result = resolveKeeperList(
    definition,
    {
      source: definition.sourceDescriptor.fixtureSource,
      selection: "identity-analysis",
      rows: [{ ...source, ordinal: 1 }],
    },
    catalog
  );
  const resolvedIds = result.members.map((member) => member.destinationId);
  const expectedIds = candidates.length === 1 ? [candidates[0].id] : [];
  if (canonicalJson(resolvedIds) !== canonicalJson(expectedIds) ||
      (candidates.length === 1 ? result.issues.length !== 0 : result.issues.length !== 1)) {
    throw new Error(`Automatic analysis drifted from keeper resolution for ${source.sourceMemberId}`);
  }
}

function sourceIdentity(
  member: KeeperSourceMember,
  owners: string[],
  raw: ParsedDobihRow
): SourceIdentity {
  if (member.lat == null || member.lng == null || member.dobihNumber == null) {
    throw new Error(`DoBIH candidate ${member.sourceMemberId} has incomplete source identity`);
  }
  return {
    sourceMemberId: member.sourceMemberId,
    dobihNumber: member.dobihNumber,
    name: member.name,
    aliases: member.aliases ?? [],
    elevationM: member.elevationM,
    lat: member.lat,
    lng: member.lng,
    sourceCountry: raw.country,
    destinationCountryCode: "GB",
    owners,
    sourceUrl: sourceUrl(member.sourceMemberId),
  };
}

function sourceSelectionAllows(sourceKey: string, row: ParsedDobihRow): boolean {
  if (sourceKey === "dobih-welsh-3000s") {
    return WELSH_3000S_NUMBER_SET.has(row.number);
  }
  if (sourceKey === "dobih-great-britain-submarilyns") {
    return row.flags.sMa && ["E", "ES", "S", "W"].includes(row.country);
  }
  if (sourceKey === "dobih-donald-deweys") return row.flags.DDew;
  if (sourceKey === "dobih-england-wales-2000-foot-register") {
    return row.flags.Hew && ["E", "ES", "W"].includes(row.country);
  }
  return false;
}

function indexMajorityMembers(fixture: KeeperImportFixture): {
  members: Map<string, KeeperSourceMember>;
  owners: Map<string, string[]>;
} {
  const members = new Map<string, KeeperSourceMember>();
  const owners = new Map<string, string[]>();
  for (const definition of DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS) {
    for (const member of fixture.lists[definition.sourceKey].rows) {
      const previous = members.get(member.sourceMemberId);
      if (previous != null && canonicalJson(memberIdentity(previous)) !==
          canonicalJson(memberIdentity(member))) {
        throw new Error(`Smaller majority-four source identity ${member.sourceMemberId} changed`);
      }
      members.set(member.sourceMemberId, member);
      owners.set(member.sourceMemberId, [
        ...(owners.get(member.sourceMemberId) ?? []),
        definition.sourceKey,
      ]);
    }
  }
  return { members, owners };
}

function priorOwners(contexts: PriorContext[]): Map<string, PriorOwner[]> {
  const indexed = new Map<string, PriorOwner[]>();
  for (const context of contexts) {
    const definitionBySource = new Map(context.definitions.map((definition) => [
      definition.sourceKey,
      definition,
    ]));
    for (const [sourceKey, list] of Object.entries(context.fixture.lists)) {
      const definition = definitionBySource.get(sourceKey);
      if (definition == null) throw new Error(`Prior list ${sourceKey} has no definition`);
      const resolutionById = new Map(
        (context.resolutions.lists[sourceKey]?.rows ?? []).map((row) => [
          row.sourceMemberId,
          row,
        ])
      );
      for (const member of list.rows) {
        if (!member.sourceMemberId.startsWith("dobih:")) continue;
        indexed.set(member.sourceMemberId, [
          ...(indexed.get(member.sourceMemberId) ?? []),
          {
            fixture: context.name,
            sourceKey,
            member,
            definition,
            resolution: resolutionById.get(member.sourceMemberId) ?? null,
          },
        ]);
      }
    }
  }
  return indexed;
}

function auxiliaryRepairs(contexts: PriorContext[]): {
  byDestination: Map<string, KeeperAuxiliaryCatalogRepair>;
  byId: Map<string, KeeperAuxiliaryCatalogRepair>;
} {
  const byDestination = new Map<string, KeeperAuxiliaryCatalogRepair>();
  const byId = new Map<string, KeeperAuxiliaryCatalogRepair>();
  for (const context of contexts) {
    for (const repair of context.resolutions.catalogRepairs ?? []) {
      const priorById = byId.get(repair.repairId);
      const priorByDestination = byDestination.get(repair.destinationId);
      if ((priorById != null && canonicalJson(priorById) !== canonicalJson(repair)) ||
          (priorByDestination != null && canonicalJson(priorByDestination) !==
            canonicalJson(repair))) {
        throw new Error(`Prior auxiliary repair ${repair.repairId} changed between fixtures`);
      }
      byId.set(repair.repairId, repair);
      byDestination.set(repair.destinationId, repair);
    }
  }
  return { byDestination, byId };
}

function assertExplicitResolutionGroup(
  sourceMemberId: string,
  rows: KeeperResolutionRow[],
  catalogById: Map<string, CatalogRow>,
  auxiliaryByDestination: Map<string, KeeperAuxiliaryCatalogRepair>
): { template: Omit<KeeperResolutionRow, "sourceKey">; auxiliaryRepairId: string | null } {
  const destinations = new Set(rows.map((row) => canonicalJson(destinationFromResolution(row))));
  if (destinations.size !== 1) {
    throw new Error(`Prior resolution ${sourceMemberId} changes destination identity`);
  }
  const kinds = new Set(rows.map((row) => row.resolution));
  if (kinds.has("curated_destination") && kinds.size !== 1) {
    throw new Error(`Prior curated resolution ${sourceMemberId} changes kind`);
  }
  for (const kind of kinds) {
    const sameKind = rows.filter((row) => row.resolution === kind).map(
      resolutionWithoutSourceKey
    );
    if (new Set(sameKind.map(canonicalJson)).size !== 1) {
      throw new Error(`Prior ${kind} decision ${sourceMemberId} changes between fixtures`);
    }
  }
  const chosen = rows.find((row) => row.resolution === "catalog_repair") ?? rows[0];
  const catalog = catalogById.get(chosen.destinationId);
  const auxiliary = auxiliaryByDestination.get(chosen.destinationId);
  if (chosen.resolution === "catalog_repair") {
    if (catalog == null || canonicalJson(catalogFingerprint(catalog)) !==
        canonicalJson(chosen.catalogBefore)) {
      throw new Error(`Prior catalog repair ${sourceMemberId} has stale catalog state`);
    }
  } else if (auxiliary != null) {
    if (catalog == null || canonicalJson(catalogFingerprint(catalog)) !==
        canonicalJson(auxiliary.before) ||
        canonicalJson(resolutionFingerprint(chosen)) !==
        canonicalJson(fingerprintWithoutExternalIds(auxiliary.after))) {
      throw new Error(`Prior auxiliary repair dependency ${sourceMemberId} changed`);
    }
  } else if (chosen.resolution === "existing_destination") {
    if (catalog == null || canonicalJson(resolutionFingerprint(chosen)) !==
        canonicalJson(fingerprintWithoutExternalIds(catalogFingerprint(catalog)))) {
      throw new Error(`Prior existing destination ${sourceMemberId} changed in the catalog`);
    }
  } else if (catalog != null && canonicalJson(resolutionFingerprint(chosen)) !==
      canonicalJson(fingerprintWithoutExternalIds(catalogFingerprint(catalog)))) {
    throw new Error(`Prior curated destination ${sourceMemberId} conflicts with the catalog`);
  }
  return {
    template: resolutionWithoutSourceKey(chosen),
    auxiliaryRepairId: auxiliary?.repairId ?? null,
  };
}

function nearbyCandidates(source: KeeperSourceMember, catalog: CatalogRow[]): CatalogCandidate[] {
  return sortCatalogCandidates(catalog.filter((peak) => peak.countryCode === "GB" &&
    Math.abs(peak.elevationM - source.elevationM) <= MAX_AUTOMATIC_ELEVATION_DELTA_M &&
    haversineMeters(source as Required<Pick<KeeperSourceMember, "lat" | "lng">>, peak) <=
      MAX_NEARBY_DISTANCE_M
  ).map((peak) => catalogCandidate(source, peak))).slice(0, 5);
}

function closeCatalogNeighbors(
  source: KeeperSourceMember,
  catalog: CatalogRow[]
): CatalogCandidate[] {
  return sortCatalogCandidates(catalog.filter((peak) =>
    haversineMeters(source as Required<Pick<KeeperSourceMember, "lat" | "lng">>, peak) <=
      DISTINCT_NEIGHBOR_DISTANCE_M
  ).map((peak) => catalogCandidate(source, peak)));
}

function buildSourceNeighborPairs(
  members: Map<string, KeeperSourceMember>
): SourceNeighborPair[] {
  const ordered = [...members.values()].sort((left, right) =>
    sourceNumber(left.sourceMemberId) - sourceNumber(right.sourceMemberId)
  );
  const pairs: SourceNeighborPair[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex];
      const right = ordered[rightIndex];
      const distanceM = Math.round(haversineMeters(
        left as Required<Pick<KeeperSourceMember, "lat" | "lng">>,
        right as Required<Pick<KeeperSourceMember, "lat" | "lng">>
      ));
      if (distanceM <= DISTINCT_NEIGHBOR_DISTANCE_M) {
        pairs.push({
          leftSourceMemberId: left.sourceMemberId,
          leftName: left.name,
          rightSourceMemberId: right.sourceMemberId,
          rightName: right.name,
          distanceM,
        });
      }
    }
  }
  return pairs;
}

export function buildDobihSmallerMajorityFourIdentityAnalysis(
  inputs: DobihSmallerMajorityFourIdentityAnalysisInputs
): DobihSmallerMajorityFourIdentityAnalysis {
  assertSha256(inputs.majorityCandidateBytes, INPUT_SHA256.majorityCandidates,
    "Smaller majority-four candidate fixture");
  assertSha256(inputs.baseCandidateBytes, INPUT_SHA256.baseCandidates,
    "Base-three candidate fixture");
  assertSha256(inputs.baseResolutionBytes, INPUT_SHA256.baseResolutions,
    "Base-three resolution fixture");
  assertSha256(inputs.openEightCandidateBytes, INPUT_SHA256.openEightCandidates,
    "Open-eight candidate fixture");
  assertSha256(inputs.openEightResolutionBytes, INPUT_SHA256.openEightResolutions,
    "Open-eight resolution fixture");
  assertSha256(inputs.dobihCsvBytes, INPUT_SHA256.dobihCsv, "DoBIH CSV");
  assertSha256(inputs.catalogBytes, INPUT_SHA256.catalog, "Catalog snapshot");

  const majorityFixture = parseJson<KeeperImportFixture>(
    inputs.majorityCandidateBytes,
    "Smaller majority-four candidate fixture"
  );
  const contexts: PriorContext[] = [
    {
      name: "base-three",
      fixture: parseJson<KeeperImportFixture>(inputs.baseCandidateBytes,
        "Base-three candidate fixture"),
      resolutions: parseJson<KeeperResolutionFixture>(inputs.baseResolutionBytes,
        "Base-three resolution fixture"),
      definitions: BASE_THREE_KEEPER_LISTS,
    },
    {
      name: "open-eight",
      fixture: parseJson<KeeperImportFixture>(inputs.openEightCandidateBytes,
        "Open-eight candidate fixture"),
      resolutions: parseJson<KeeperResolutionFixture>(inputs.openEightResolutionBytes,
        "Open-eight resolution fixture"),
      definitions: DOBIH_OPEN_EIGHT_KEEPER_LISTS,
    },
  ];
  validateKeeperFixture(majorityFixture, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
  for (const context of contexts) {
    validateKeeperFixture(context.fixture, context.definitions);
    validateKeeperResolutionFixture(context.fixture, context.resolutions, context.definitions);
    validateKeeperCrossListConsistency(context.fixture, context.resolutions, context.definitions);
  }

  const sourceProvenance = majorityFixture.sources["dobih-v18.5"] as Record<string, unknown>;
  if (sourceProvenance?.name !== DOBIH_SOURCE_NAME ||
      sourceProvenance.url !== DOBIH_SOURCE_URL ||
      sourceProvenance.license !== DOBIH_SOURCE_LICENSE ||
      sourceProvenance.csvSha256 !== DOBIH_CSV_SHA256) {
    throw new Error("Smaller majority-four DoBIH source provenance changed");
  }
  for (const context of contexts) {
    if (canonicalJson(context.fixture.sources["dobih-v18.5"]) !==
        canonicalJson(sourceProvenance)) {
      throw new Error(`${context.name} DoBIH source provenance changed`);
    }
  }

  const rawRows = parseDobihRows(new TextDecoder("utf-8", { fatal: true }).decode(
    inputs.dobihCsvBytes
  ));
  const rawByNumber = new Map(rawRows.map((row) => [row.number, row]));
  const catalog = parseCatalog(inputs.catalogBytes);
  const catalogById = new Map(catalog.map((row) => [row.id, row]));
  const { members, owners } = indexMajorityMembers(majorityFixture);
  const membershipCount = Object.values(majorityFixture.lists).reduce(
    (total, list) => total + list.rows.length,
    0
  );
  if (membershipCount !== EXPECTED_MEMBERSHIPS || members.size !== EXPECTED_IDENTITIES) {
    throw new Error(
      `Smaller majority-four scope is ${membershipCount}/${members.size}; expected ` +
      `${EXPECTED_MEMBERSHIPS}/${EXPECTED_IDENTITIES}`
    );
  }
  for (const [sourceMemberId, member] of members) {
    const raw = rawByNumber.get(sourceNumber(sourceMemberId));
    if (raw == null || raw.country === "I" ||
        canonicalJson(memberIdentity(member)) !==
          canonicalJson(memberIdentity(buildDobihSourceMember(raw, member.ordinal)))) {
      throw new Error(
        `Smaller majority-four source ${sourceMemberId} changed from the pinned DoBIH CSV`
      );
    }
    for (const sourceKey of owners.get(sourceMemberId) ?? []) {
      if (!sourceSelectionAllows(sourceKey, raw)) {
        throw new Error(
          `Smaller majority-four source ${sourceMemberId} fails ${sourceKey}'s country rule`
        );
      }
    }
  }

  const priorBySource = priorOwners(contexts);
  const reusedIds = [...members.keys()].filter((sourceId) => priorBySource.has(sourceId));
  if (reusedIds.length !== EXPECTED_PRIOR_IDENTITIES) {
    throw new Error(
      `Prior overlap has ${reusedIds.length} identities; expected ${EXPECTED_PRIOR_IDENTITIES}`
    );
  }
  const auxiliary = auxiliaryRepairs(contexts);
  const usedAuxiliaryIds = new Set<string>();
  const reusedIdentities: ReusedIdentityAnalysis[] = [];
  const prospectivePriorDestinations = new Map<string, string[]>();

  for (const sourceMemberId of reusedIds.sort((left, right) =>
    sourceNumber(left) - sourceNumber(right))) {
    const member = members.get(sourceMemberId)!;
    const raw = rawByNumber.get(sourceNumber(sourceMemberId))!;
    const prior = priorBySource.get(sourceMemberId)!;
    for (const owner of prior) {
      if (canonicalJson(memberIdentity(owner.member)) !== canonicalJson(memberIdentity(member))) {
        throw new Error(`Prior source ${sourceMemberId} changed before smaller-majority-four reuse`);
      }
    }
    const explicitRows = prior.flatMap((owner) => owner.resolution == null
      ? []
      : [owner.resolution]);
    const ownerDestinations: DestinationIdentity[] = [];
    const priorOwnerReport: ReusedIdentityAnalysis["priorOwners"] = [];
    for (const owner of prior) {
      if (owner.resolution != null) {
        ownerDestinations.push(destinationFromResolution(owner.resolution));
        priorOwnerReport.push({
          fixture: owner.fixture,
          sourceKey: owner.sourceKey,
          mode: owner.resolution.resolution,
        });
        continue;
      }
      const candidates = automaticCandidates(owner.member, owner.definition, catalog);
      assertCoreAutomaticResult(owner.member, owner.definition, catalog, candidates);
      if (candidates.length !== 1) {
        throw new Error(`Prior automatic identity ${sourceMemberId} no longer resolves exactly`);
      }
      ownerDestinations.push(destinationIdentity(candidates[0]));
      priorOwnerReport.push({
        fixture: owner.fixture,
        sourceKey: owner.sourceKey,
        mode: "automatic",
      });
    }
    if (new Set(ownerDestinations.map(canonicalJson)).size !== 1) {
      throw new Error(`Prior source ${sourceMemberId} changes destination between lists`);
    }
    let template: Omit<KeeperResolutionRow, "sourceKey"> | null = null;
    let auxiliaryRepairId: string | null = null;
    if (explicitRows.length > 0) {
      const reviewed = assertExplicitResolutionGroup(
        sourceMemberId,
        explicitRows,
        catalogById,
        auxiliary.byDestination
      );
      template = reviewed.template;
      auxiliaryRepairId = reviewed.auxiliaryRepairId;
      if (auxiliaryRepairId != null) usedAuxiliaryIds.add(auxiliaryRepairId);
    }
    const destination = ownerDestinations[0];
    prospectivePriorDestinations.set(destination.id, [
      ...(prospectivePriorDestinations.get(destination.id) ?? []),
      sourceMemberId,
    ]);
    reusedIdentities.push({
      ...sourceIdentity(member, owners.get(sourceMemberId)!, raw),
      status: explicitRows.length > 0 ? "reused_explicit" : "reused_automatic",
      destination,
      automaticCandidates: explicitRows.length > 0
        ? []
        : automaticCandidates(member, prior[0].definition, catalog),
      blockingReasons: [],
      priorOwners: priorOwnerReport.sort((left, right) =>
        left.fixture.localeCompare(right.fixture) || left.sourceKey.localeCompare(right.sourceKey)
      ),
      reviewedResolution: template,
      reviewedResolutionSha256: template == null ? null : canonicalSha256(template),
      requiredAuxiliaryRepairId: auxiliaryRepairId,
    });
  }

  const explicitReuseCount = reusedIdentities.filter((row) =>
    row.status === "reused_explicit"
  ).length;
  if (explicitReuseCount !== EXPECTED_PRIOR_EXPLICIT) {
    throw new Error(`Prior explicit reuse has ${explicitReuseCount} identities; expected 120`);
  }
  const priorDestinationConflicts = [...prospectivePriorDestinations.entries()].filter(
    ([, sourceIds]) => new Set(sourceIds).size > 1
  );
  let reusedAutomaticIdentityCollisions = 0;
  for (const [destinationId, sourceIds] of priorDestinationConflicts) {
    const rows = sourceIds.map((sourceId) => reusedIdentities.find((row) =>
      row.sourceMemberId === sourceId
    )!);
    const explicitRows = rows.filter((row) => row.status === "reused_explicit");
    if (explicitRows.length > 1) {
      throw new Error(
        `Prior explicit decisions collide at ${destinationId}: ${sourceIds.join(", ")}`
      );
    }
    for (const row of rows) {
      if (row.status !== "reused_automatic") continue;
      reusedAutomaticIdentityCollisions += 1;
      row.status = "reused_needs_review";
      row.destination = null;
      row.blockingReasons.push(
        `automatic destination ${destinationId} is also assigned to ${sourceIds
          .filter((sourceId) => sourceId !== row.sourceMemberId).join(", ")}`
      );
    }
  }

  const assignedPriorDestinations = new Map<string, string[]>();
  for (const row of reusedIdentities) {
    if (row.destination == null) continue;
    assignedPriorDestinations.set(row.destination.id, [
      ...(assignedPriorDestinations.get(row.destination.id) ?? []),
      row.sourceMemberId,
    ]);
  }

  const newIds = [...members.keys()].filter((sourceId) => !priorBySource.has(sourceId)).sort(
    (left, right) => sourceNumber(left) - sourceNumber(right)
  );
  if (newIds.length !== EXPECTED_NEW_IDENTITIES) {
    throw new Error(
      `New identity scope has ${newIds.length} rows; expected ${EXPECTED_NEW_IDENTITIES}`
    );
  }
  const newIdentities: NewIdentityAnalysis[] = [];
  for (const sourceMemberId of newIds) {
    const member = members.get(sourceMemberId)!;
    const raw = rawByNumber.get(sourceNumber(sourceMemberId))!;
    const ownerKeys = owners.get(sourceMemberId)!;
    const ownerCandidates = ownerKeys.map((sourceKey) => {
      const definition = DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS.find((candidate) =>
        candidate.sourceKey === sourceKey
      );
      if (definition == null) throw new Error(`Missing smaller-majority-four definition ${sourceKey}`);
      const candidates = automaticCandidates(member, definition, catalog);
      assertCoreAutomaticResult(member, definition, catalog, candidates);
      return candidates;
    });
    if (new Set(ownerCandidates.map(canonicalJson)).size !== 1) {
      throw new Error(`New automatic candidates ${sourceMemberId} change between owner lists`);
    }
    const candidates = ownerCandidates[0];
    newIdentities.push({
      ...sourceIdentity(member, ownerKeys, raw),
      status: candidates.length === 1 ? "catalog_auto_match" : "needs_review",
      destination: candidates.length === 1 ? destinationIdentity(candidates[0]) : null,
      automaticCandidates: candidates,
      nearbyCandidates: nearbyCandidates(member, catalog),
      closeCatalogNeighbors: closeCatalogNeighbors(member, catalog),
      blockingReasons: candidates.length === 0
        ? ["no unique exact scoped catalog match"]
        : candidates.length > 1
          ? [`${candidates.length} exact scoped catalog matches need review`]
          : [],
    });
  }

  const prospectiveDestinations = new Map<string, Set<string>>();
  for (const [destinationId, sourceIds] of assignedPriorDestinations) {
    prospectiveDestinations.set(destinationId, new Set(sourceIds));
  }
  for (const row of newIdentities) {
    if (row.destination == null) continue;
    const sourceIds = prospectiveDestinations.get(row.destination.id) ?? new Set<string>();
    sourceIds.add(row.sourceMemberId);
    prospectiveDestinations.set(row.destination.id, sourceIds);
  }
  let automaticIdentityCollisions = 0;
  for (const row of newIdentities) {
    if (row.destination == null) continue;
    const sourceIds = [...(prospectiveDestinations.get(row.destination.id) ?? [])].sort(
      (left, right) => sourceNumber(left) - sourceNumber(right)
    );
    if (sourceIds.length <= 1) continue;
    automaticIdentityCollisions += 1;
    row.status = "needs_review";
    row.blockingReasons.push(
      `catalog destination ${row.destination.id} is also assigned to ${sourceIds
        .filter((sourceId) => sourceId !== row.sourceMemberId).join(", ")}`
    );
    row.destination = null;
  }

  const sourceNeighborPairs = buildSourceNeighborPairs(members);
  if (sourceNeighborPairs.length !== EXPECTED_SOURCE_NEIGHBOR_PAIRS) {
    throw new Error(
      `Smaller majority-four source neighbor review has ${sourceNeighborPairs.length} ` +
      `pairs; expected ${EXPECTED_SOURCE_NEIGHBOR_PAIRS}`
    );
  }
  const accessBlocks = ACCESS_BLOCKS.map((block) => {
    const member = members.get(block.sourceMemberId);
    if (member?.name !== block.name || priorBySource.has(block.sourceMemberId)) {
      throw new Error(`Publication block ${block.sourceMemberId} changed`);
    }
    return { ...block };
  });
  const newCatalogAutoMatches = newIdentities.filter((row) =>
    row.status === "catalog_auto_match"
  ).length;
  const newNeedsReview = newIdentities.length - newCatalogAutoMatches;
  const reusedNeedsReview = reusedIdentities.filter((row) =>
    row.status === "reused_needs_review"
  ).length;
  const identityReviewComplete = reusedNeedsReview === 0 && newNeedsReview === 0;

  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    reviewedAt: REVIEWED_AT,
    identityReviewComplete,
    publicationReady: false,
    inputs: {
      "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json":
        INPUT_SHA256.majorityCandidates,
      "keeper-list-candidates-2026-08-30.json": INPUT_SHA256.baseCandidates,
      "keeper-list-identity-resolutions-2026-08-30.json": INPUT_SHA256.baseResolutions,
      "keeper-list-dobih-open-eight-candidates-2026-08-30.json":
        INPUT_SHA256.openEightCandidates,
      "keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json":
        INPUT_SHA256.openEightResolutions,
      "DoBIH_v18_5.csv": INPUT_SHA256.dobihCsv,
      [CATALOG_FILE]: INPUT_SHA256.catalog,
    },
    sourceProvenance,
    catalogSnapshot: {
      file: `/private/tmp/${CATALOG_FILE}`,
      sha256: INPUT_SHA256.catalog,
      rows: catalog.length,
      transaction: "REPEATABLE READ READ ONLY",
      selection:
        "Peaks-owned point summits with coordinates inside longitude -11..3 and latitude " +
        "49..61, ordered by destination ID; includes missing and non-GB country codes for " +
        "duplicate guards.",
    },
    matchingRules: {
      automatic:
        "One normalized name-or-alias match, at most 100 m elevation difference, at most " +
        "250 m source distance, and inside each list's country bounds; cross-checked against " +
        "resolveKeeperList.",
      nearby:
        "Up to five GB catalog summits within 5 km and 100 m elevation difference, ordered " +
        "by distance, elevation difference, and destination ID.",
      duplicateGuard:
        "Every catalog summit and every other smaller-majority-four source identity within 150 m is " +
        "listed for explicit reuse, repair, or distinctFrom review.",
    },
    counts: {
      memberships: membershipCount,
      identities: members.size,
      reusedIdentities: reusedIdentities.length,
      reusedExplicitIdentities: explicitReuseCount,
      reusedAutomaticIdentities:
        reusedIdentities.length - explicitReuseCount - reusedNeedsReview,
      reusedNeedsReview,
      reusedAutomaticIdentityCollisions,
      newIdentities: newIdentities.length,
      newCatalogAutoMatches,
      newNeedsReview,
      newAutomaticIdentityCollisions: automaticIdentityCollisions,
      sourceNeighborPairsWithin150M: sourceNeighborPairs.length,
      publicationAccessBlocks: accessBlocks.length,
      curatedDestinations: 0,
    },
    accessBlocks,
    sourceNeighborPairs,
    requiredPriorAuxiliaryRepairs: [...usedAuxiliaryIds].sort().map((repairId) => {
      const repair = auxiliary.byId.get(repairId);
      if (repair == null) throw new Error(`Missing prior auxiliary repair ${repairId}`);
      return repair;
    }),
    reusedIdentities,
    newIdentities,
  };
}

function parseArgs(argv: string[]): BuildArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args: BuildArgs = {
    candidates: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
    ),
    baseCandidates: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json"
    ),
    baseResolutions: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-identity-resolutions-2026-08-30.json"
    ),
    openEightCandidates: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json"
    ),
    openEightResolutions: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json"
    ),
    dobihCsv: "/private/tmp/dobih-v18.5/DoBIH_v18_5.csv",
    catalog: `/private/tmp/${CATALOG_FILE}`,
    output: path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-dobih-smaller-majority-four-identity-analysis-2026-08-31.json"
    ),
    allowIncomplete: false,
  };
  const options: Array<[string, keyof Omit<BuildArgs, "allowIncomplete">]> = [
    ["--candidates=", "candidates"],
    ["--base-candidates=", "baseCandidates"],
    ["--base-resolutions=", "baseResolutions"],
    ["--open-eight-candidates=", "openEightCandidates"],
    ["--open-eight-resolutions=", "openEightResolutions"],
    ["--dobih-csv=", "dobihCsv"],
    ["--catalog=", "catalog"],
    ["--output=", "output"],
  ];
  const seen = new Set<keyof Omit<BuildArgs, "allowIncomplete">>();
  for (const argument of argv) {
    if (argument === "--allow-incomplete") {
      if (args.allowIncomplete) throw new Error("--allow-incomplete was provided twice");
      args.allowIncomplete = true;
      continue;
    }
    const option = options.find(([prefix]) => argument.startsWith(prefix));
    if (option == null) throw new Error(`Unknown option: ${argument}`);
    const [prefix, key] = option;
    const value = argument.slice(prefix.length).trim();
    if (!value) throw new Error(`${prefix.slice(0, -1)} requires a path`);
    if (seen.has(key)) throw new Error(`${prefix.slice(0, -1)} was provided twice`);
    args[key] = path.resolve(value);
    seen.add(key);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [
    majorityCandidateBytes,
    baseCandidateBytes,
    baseResolutionBytes,
    openEightCandidateBytes,
    openEightResolutionBytes,
    dobihCsvBytes,
    catalogBytes,
  ] = await Promise.all([
    fs.readFile(args.candidates),
    fs.readFile(args.baseCandidates),
    fs.readFile(args.baseResolutions),
    fs.readFile(args.openEightCandidates),
    fs.readFile(args.openEightResolutions),
    fs.readFile(args.dobihCsv),
    fs.readFile(args.catalog),
  ]);
  const analysis = buildDobihSmallerMajorityFourIdentityAnalysis({
    majorityCandidateBytes,
    baseCandidateBytes,
    baseResolutionBytes,
    openEightCandidateBytes,
    openEightResolutionBytes,
    dobihCsvBytes,
    catalogBytes,
  });
  if (!analysis.identityReviewComplete && !args.allowIncomplete) {
    throw new Error(
      `Identity review is incomplete: ${analysis.counts.reusedNeedsReview} reused and ` +
      `${analysis.counts.newNeedsReview} new identities still need review. Pass ` +
      "--allow-incomplete only to write the checked analysis report."
    );
  }
  const output = `${JSON.stringify(analysis, null, 2)}\n`;
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, output, "utf8");
  console.log(`Wrote ${args.output}`);
  console.log(`SHA-256 ${sha256(output)}`);
  console.log(JSON.stringify(analysis.counts));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
