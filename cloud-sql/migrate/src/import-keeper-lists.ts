/**
 * Imports reviewed peak lists from saved keeper-source fixtures.
 *
 * Unlike import-peakbagger-lists.ts, this importer never writes a source
 * member ID into destinations.external_ids. DoBIH Numbers and UIAA main IDs
 * identify fixture rows only.
 *
 * Dry-run is the default. A dry run opens a read-only transaction and reports
 * every unresolved identity. Apply refuses to write unless every list resolves
 * to its full, unique membership.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { PoolClient } from "pg";
import db from "./db";

export interface KeeperImportArgs {
  input: string;
  resolutions: string;
  apply: boolean;
}

export interface KeeperSourceMember {
  sourceMemberId: string;
  ordinal: number;
  name: string;
  aliases?: string[];
  elevationM: number;
  lat?: number;
  lng?: number;
  dobihNumber?: number;
  buyseMainNumber?: number;
  zone?: number;
}

export interface KeeperSourceList {
  source: string;
  selection: string;
  rows: KeeperSourceMember[];
}

export interface KeeperImportFixture {
  schemaVersion: number;
  generatedAt: string;
  sources: Record<string, unknown>;
  lists: Record<string, KeeperSourceList>;
}

export interface KeeperListDefinition {
  listId: string;
  sourceKey: string;
  name: string;
  description: string;
  expectedCount: number;
  destinationOverrides: Record<string, string>;
  allowedCountryCodes?: string[];
  allowedStateCodes?: string[];
  yearEstablished: number | null;
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export interface KeeperCatalogPeak {
  id: string;
  name: string;
  elevationM: number | null;
  lat: number;
  lng: number;
  countryCode: string | null;
  stateCode: string | null;
  osmId: string | null;
  externalIds: Record<string, string>;
  owner?: string | null;
  destinationType?: string | null;
  features?: string[];
  dataSourceName?: string | null;
  dataSourceUrl?: string | null;
  dataLicense?: string | null;
  keeperRosterSource?: string | null;
  metadataDisplayName?: string | null;
}

export interface KeeperExternalIdOwner {
  destinationId: string;
  key: string;
  value: string;
}

export type KeeperResolutionKind =
  | "existing_destination"
  | "catalog_repair"
  | "curated_destination";

export interface KeeperDestinationFingerprint {
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  osmNodeId: string | null;
  countryCode: string | null;
  stateCode: string | null;
  externalIds?: Record<string, string>;
}

export interface KeeperResolutionRow {
  sourceKey: string;
  sourceMemberId: string;
  resolution: KeeperResolutionKind;
  destinationId: string;
  destinationName: string;
  destinationElevationM: number;
  destinationLat: number;
  destinationLng: number;
  destinationOsmNodeId: string | null;
  destinationCountryCode: string;
  destinationStateCode: string | null;
  destinationDataSourceName?: string;
  destinationDataSourceUrl?: string;
  destinationDataLicense?: string | null;
  distinctFromDestinationIds?: string[];
  catalogExternalIdAdditions?: Record<string, string>;
  catalogExternalIdRemovals?: Record<string, string>;
  catalogBefore?: KeeperDestinationFingerprint;
  evidence: string[];
}

interface KeeperResolutionList {
  rows: KeeperResolutionRow[];
}

export interface KeeperAuxiliaryCatalogRepair {
  repairId: string;
  destinationId: string;
  before: KeeperDestinationFingerprint;
  after: KeeperDestinationFingerprint;
  dataSourceName: string;
  dataSourceUrl: string;
  dataLicense: string | null;
  externalIdRemovals?: Record<string, string>;
  evidence: string[];
}

export interface KeeperResolutionFixture {
  schemaVersion: number;
  reviewedAt: string;
  catalogSnapshotSha256: string;
  catalogSnapshots?: Record<string, string>;
  catalogRepairs?: KeeperAuxiliaryCatalogRepair[];
  lists: Record<string, KeeperResolutionList>;
}

export interface ReviewedKeeperDestination {
  sourceKey: string;
  sourceMemberId: string;
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  countryCode: string;
  stateCode: string | null;
  osmId: string | null;
  dataSourceName: string;
  dataSourceUrl: string;
  dataLicense: string | null;
}

export interface ReviewedKeeperCatalogRepair extends ReviewedKeeperDestination {
  before: KeeperDestinationFingerprint;
  externalIdAdditions: Record<string, string>;
  externalIdRemovals: Record<string, string>;
}

export interface ResolvedKeeperMember {
  destinationId: string;
  ordinal: number;
  sourceMemberId: string;
  sourceName: string;
}

export interface KeeperResolutionIssue {
  sourceMemberId: string;
  sourceName: string;
  reason: string;
  candidates: Array<{
    id: string;
    name: string;
    elevationM: number | null;
    distanceM?: number;
  }>;
}

interface CurrentListMember {
  listId: string;
  destinationId: string;
  ordinal: number;
}

export interface KeeperListResolution {
  list: KeeperListDefinition;
  members: ResolvedKeeperMember[];
  issues: KeeperResolutionIssue[];
  addedDestinationIds: string[];
  removedDestinationIds: string[];
  reorderedDestinationIds: string[];
}

export interface KeeperImportReport {
  apply: boolean;
  complete: boolean;
  destinationsToAdd: Array<{
    sourceMemberId: string;
    id: string;
    name: string;
    osmId: string | null;
  }>;
  destinationsToRepair: Array<{
    sourceMemberId: string;
    id: string;
    beforeName: string;
    name: string;
  }>;
  lists: Array<{
    id: string;
    sourceKey: string;
    name: string;
    sourceName: string;
    sourceUrl: string;
    expectedCount: number;
    resolvedCount: number;
    unresolvedCount: number;
    issues: KeeperResolutionIssue[];
    added: Array<{ id: string; name: string | null }>;
    removed: Array<{ id: string; name: string | null }>;
    reorderedCount: number;
  }>;
}

const MAX_ELEVATION_DELTA_M = 100;
const MAX_SOURCE_DISTANCE_M = 250;
const NEARBY_AUDIT_DISTANCE_M = 5_000;
const MAX_REVIEWED_SOURCE_DISTANCE_M = 250;
const MAX_CURATED_SOURCE_DISTANCE_M = 250;
const REVIEWED_DUPLICATE_DISTANCE_M = 150;
const CATALOG_FINGERPRINT_DISTANCE_M = 5;
const CATALOG_FINGERPRINT_ELEVATION_M = 1;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isValidExternalIdRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.entries(value).every(([key, id]) =>
    key.trim().length > 0 && isNonEmptyString(id)
  );
}

function assertValidExternalIdRecord(value: unknown, label: string): asserts value is Record<string, string> {
  if (!isValidExternalIdRecord(value)) {
    throw new Error(`${label} has an invalid external-ID record`);
  }
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function coordinatesAreWithinBounds(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function assertCoordinatesWithinBounds(lat: unknown, lng: unknown, label: string): void {
  if (!coordinatesAreWithinBounds(lat, lng)) {
    throw new Error(`${label} are outside latitude/longitude bounds`);
  }
}

function keeperRosterSource(sourceKey: string): string {
  return sourceKey.startsWith("dobih-") ? "dobih-v18.5" : "uiaa-bulletin-152";
}

interface ProductionKeeperSourceManifest {
  generatedAt: string;
  sourcesSha256: string;
  listSource: string;
  selection: string;
  rosterSha256: string;
}

const PRODUCTION_KEEPER_SOURCE_MANIFEST: Record<string, ProductionKeeperSourceManifest> = {
  "dobih-corbetts": {
    generatedAt: "2026-08-30",
    sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
    listSource: "dobih-v18.5",
    selection: "C=1",
    rosterSha256: "801bc61653fe7719dc1287c3ac6c9e1cfbe735efb1915afff53a8b464ca4b88a",
  },
  "dobih-wainwrights": {
    generatedAt: "2026-08-30",
    sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
    listSource: "dobih-v18.5",
    selection: "W=1",
    rosterSha256: "7140cce0a84d66f149293294b1897e382cf1d82aa75c1823b48d55eb7611f562",
  },
  "uiaa-pyrenees-main": {
    generatedAt: "2026-08-30",
    sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
    listSource: "uiaa-pyrenees-main",
    selection: "main:001..main:129",
    rosterSha256: "ac47afa4687859971fa5e459738740c6336f8562df37186ee47de7650fc122f5",
  },
};

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    ).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded == null) throw new Error("Keeper fixture contains a non-JSON value");
  return encoded;
}

function canonicalSha256(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function deterministicKeeperListId(sourceKey: string): string {
  return crypto
    .createHash("sha256")
    .update(`keeper:list:${sourceKey}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export function deterministicKeeperDestinationId(sourceMemberId: string): string {
  return crypto
    .createHash("sha256")
    .update(`keeper:destination:${sourceMemberId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export function deterministicOsmKeeperDestinationId(osmNodeId: string): string {
  return crypto
    .createHash("sha256")
    .update(`osm:node:${osmNodeId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export const KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:corbetts"),
    sourceKey: "dobih-corbetts",
    name: "Corbetts",
    description:
      "The Corbetts are the 222 Scottish peaks from 2,500 to 3,000 feet high with at least " +
      "500 feet of drop on every side. John Rooke Corbett drew up the first list, and the " +
      "Scottish Mountaineering Club now keeps it.",
    expectedCount: 222,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1952,
    organization: "Scottish Mountaineering Club",
    sourceName: "The Database of British and Irish Hills (CC BY 4.0)",
    sourceUrl: "https://www.hill-bagging.co.uk/dobih/downloads/",
    region: "Scotland",
  },
  {
    listId: deterministicKeeperListId("dobih:wainwrights"),
    sourceKey: "dobih-wainwrights",
    name: "Wainwrights",
    description:
      "Alfred Wainwright described these 214 Lake District fells in the seven volumes of his " +
      "Pictorial Guide to the Lakeland Fells. The Wainwright Society now keeps the completion " +
      "register for the 214. The list comes from the books, not from a height or drop rule.",
    expectedCount: 214,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1966,
    organization: "The Wainwright Society",
    sourceName: "The Database of British and Irish Hills (CC BY 4.0)",
    sourceUrl: "https://www.hill-bagging.co.uk/dobih/downloads/",
    region: "Lake District",
  },
  {
    listId: deterministicKeeperListId("uiaa:pyrenees-main-3000ers"),
    sourceKey: "uiaa-pyrenees-main",
    name: "UIAA Pyrenees 3000ers",
    description:
      "The UIAA recognized 129 main Pyrenean summits at or above 3,000 meters in 1995. " +
      "The list separates those main peaks from 83 secondary summits and spans eleven " +
      "zones across France and Spain.",
    expectedCount: 129,
    destinationOverrides: {},
    allowedCountryCodes: ["ES", "FR"],
    yearEstablished: 1995,
    organization: "International Climbing and Mountaineering Federation (UIAA)",
    sourceName: "UIAA",
    sourceUrl: "https://www.theuiaa.org/3000-pyrenees/",
    region: "Pyrenees",
  },
];

export function parseKeeperImportArgs(argv = process.argv.slice(2)): KeeperImportArgs {
  const inputArg = argv.find((arg) => arg.startsWith("--input="));
  const input = inputArg?.slice("--input=".length).trim();
  if (!input) throw new Error("--input is required");
  const resolutionsArg = argv.find((arg) => arg.startsWith("--resolutions="));
  const resolutions = resolutionsArg?.slice("--resolutions=".length).trim();
  if (!resolutions) throw new Error("--resolutions is required");
  const unknown = argv.filter((arg) => arg !== "--apply" &&
    !arg.startsWith("--input=") && !arg.startsWith("--resolutions="));
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  return { input, resolutions, apply: argv.includes("--apply") };
}

export function normalizeKeeperPeakName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[\u2010-\u2015-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoordinates(member: KeeperSourceMember): member is KeeperSourceMember & {
  lat: number;
  lng: number;
} {
  return coordinatesAreWithinBounds(member.lat, member.lng);
}

export function validateKeeperFixture(
  fixture: KeeperImportFixture,
  definitions: KeeperListDefinition[] = KEEPER_LISTS
): void {
  if (fixture.schemaVersion !== 1) {
    throw new Error(`Unsupported keeper fixture schema ${fixture.schemaVersion}`);
  }
  const productionManifests = definitions
    .map((definition) => PRODUCTION_KEEPER_SOURCE_MANIFEST[definition.sourceKey])
    .filter((manifest): manifest is ProductionKeeperSourceManifest => manifest != null);
  if (productionManifests.length > 0) {
    const expectedDate = productionManifests[0].generatedAt;
    if (fixture.generatedAt !== expectedDate ||
        productionManifests.some((manifest) => manifest.generatedAt !== expectedDate)) {
      throw new Error(
        `Keeper production fixture generated date ${fixture.generatedAt} does not match ` +
        expectedDate
      );
    }
    const expectedSourcesSha256 = productionManifests[0].sourcesSha256;
    const actualSourcesSha256 = canonicalSha256(fixture.sources);
    if (actualSourcesSha256 !== expectedSourcesSha256 ||
        productionManifests.some((manifest) =>
          manifest.sourcesSha256 !== expectedSourcesSha256)) {
      throw new Error(
        `Keeper production source metadata checksum ${actualSourcesSha256} does not match ` +
        expectedSourcesSha256
      );
    }
  }
  for (const definition of definitions) {
    const source = fixture.lists[definition.sourceKey];
    if (!source || !Array.isArray(source.rows)) {
      throw new Error(`Keeper list ${definition.sourceKey} is missing from the input`);
    }
    if (source.rows.length !== definition.expectedCount) {
      throw new Error(
        `Keeper list ${definition.sourceKey} has ${source.rows.length} rows; ` +
        `expected ${definition.expectedCount}`
      );
    }
    const productionManifest = PRODUCTION_KEEPER_SOURCE_MANIFEST[definition.sourceKey];
    if (productionManifest != null) {
      if (source.source !== productionManifest.listSource) {
        throw new Error(
          `Keeper list ${definition.sourceKey} source selector ${source.source} does not match ` +
          productionManifest.listSource
        );
      }
      if (source.selection !== productionManifest.selection) {
        throw new Error(
          `Keeper list ${definition.sourceKey} selection ${source.selection} does not match ` +
          productionManifest.selection
        );
      }
    }
    const sourceIds = new Set<string>();
    const ordinals = new Set<number>();
    for (const member of source.rows) {
      if (!isNonEmptyString(member.sourceMemberId) || sourceIds.has(member.sourceMemberId)) {
        throw new Error(`Keeper list ${definition.sourceKey} repeats or omits a source member ID`);
      }
      if (!Number.isInteger(member.ordinal) || member.ordinal <= 0 || ordinals.has(member.ordinal)) {
        throw new Error(
          `Keeper list ${definition.sourceKey} has a repeated or invalid ordinal ` +
          `${member.ordinal}`
        );
      }
      if (!isNonEmptyString(member.name) ||
          typeof member.elevationM !== "number" || !Number.isFinite(member.elevationM) ||
          (member.aliases != null &&
            (!Array.isArray(member.aliases) ||
             member.aliases.some((alias) => !isNonEmptyString(alias))))) {
        throw new Error(
          `Keeper list ${definition.sourceKey} member ${member.sourceMemberId} is incomplete`
        );
      }
      const hasLat = member.lat !== undefined;
      const hasLng = member.lng !== undefined;
      if (hasLat !== hasLng) {
        throw new Error(
          `Keeper list ${definition.sourceKey} member ${member.sourceMemberId} has partial coordinates`
        );
      }
      if (hasLat) {
        assertCoordinatesWithinBounds(
          member.lat,
          member.lng,
          `Keeper list ${definition.sourceKey} member ${member.sourceMemberId} source coordinates`
        );
      }
      if (definition.sourceKey === "dobih-corbetts" ||
          definition.sourceKey === "dobih-wainwrights") {
        if (!Number.isInteger(member.dobihNumber) ||
            member.sourceMemberId !== `dobih:${member.dobihNumber}`) {
          throw new Error(
            `DoBIH keeper member ${member.sourceMemberId} has a Number that does not match ` +
            "its source member ID"
          );
        }
      }
      if (definition.sourceKey === "uiaa-pyrenees-main") {
        const expectedSourceMemberId =
          `uiaa-pyrenees-main:${String(member.ordinal).padStart(3, "0")}`;
        if (member.buyseMainNumber !== member.ordinal ||
            member.sourceMemberId !== expectedSourceMemberId) {
          throw new Error(
            `UIAA keeper member ${member.sourceMemberId} must match ordinal ` +
            `${member.ordinal}, Buyse main number, and padded source member ID ` +
            expectedSourceMemberId
          );
        }
      }
      sourceIds.add(member.sourceMemberId);
      ordinals.add(member.ordinal);
    }
    if (Array.from(
      { length: definition.expectedCount },
      (_, index) => index + 1
    ).some((ordinal) => !ordinals.has(ordinal))) {
      throw new Error(
        `Keeper list ${definition.sourceKey} ordinals must be contiguous from 1 to ` +
        definition.expectedCount
      );
    }
    if (productionManifest != null) {
      const actualRosterSha256 = canonicalSha256(source.rows);
      if (actualRosterSha256 !== productionManifest.rosterSha256) {
        throw new Error(
          `Keeper list ${definition.sourceKey} ordered roster checksum ` +
          `${actualRosterSha256} does not match ${productionManifest.rosterSha256}`
        );
      }
    }
  }
}

function resolutionRows(fixture: KeeperResolutionFixture): KeeperResolutionRow[] {
  return Object.values(fixture.lists).flatMap((list) => list.rows);
}

function requestedExternalIdAdditions(
  resolutions: KeeperResolutionFixture
): KeeperExternalIdOwner[] {
  return resolutionRows(resolutions)
    .flatMap((row) => Object.entries(row.catalogExternalIdAdditions ?? {}).map(([key, value]) => ({
      destinationId: row.destinationId,
      key,
      value,
    })))
    .sort((left, right) => left.key.localeCompare(right.key) ||
      left.value.localeCompare(right.value) ||
      left.destinationId.localeCompare(right.destinationId));
}

export function validateKeeperResolutionFixture(
  fixture: KeeperImportFixture,
  resolutions: KeeperResolutionFixture,
  definitions: KeeperListDefinition[] = KEEPER_LISTS
): void {
  if (resolutions.schemaVersion !== 1) {
    throw new Error(`Unsupported keeper resolution schema ${resolutions.schemaVersion}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolutions.reviewedAt)) {
    throw new Error("Keeper resolution review date is missing or invalid");
  }
  if (!/^[a-f0-9]{64}$/i.test(resolutions.catalogSnapshotSha256)) {
    throw new Error("Keeper resolution catalog snapshot checksum is missing or invalid");
  }
  if (resolutions.catalogSnapshots != null &&
      (Object.keys(resolutions.catalogSnapshots).length === 0 ||
       Object.values(resolutions.catalogSnapshots).some((value) =>
         !/^[a-f0-9]{64}$/i.test(value)))) {
    throw new Error("Keeper resolution catalog snapshot manifest is invalid");
  }
  const auxiliaryRepairIds = new Set<string>();
  const auxiliaryDestinationIds = new Set<string>();
  for (const repair of resolutions.catalogRepairs ?? []) {
    if (repair == null || typeof repair !== "object") {
      throw new Error("Keeper auxiliary catalog repair unknown is invalid");
    }
    const repairLabel = `Keeper auxiliary catalog repair ${
      isNonEmptyString(repair.repairId) ? repair.repairId : "unknown"
    }`;
    assertValidExternalIdRecord(repair.before?.externalIds, `${repairLabel} before fingerprint`);
    assertValidExternalIdRecord(repair.after?.externalIds, `${repairLabel} after fingerprint`);
    if (repair.externalIdRemovals != null) {
      assertValidExternalIdRecord(repair.externalIdRemovals, `${repairLabel} removals`);
    }
    assertCoordinatesWithinBounds(
      repair.before?.lat,
      repair.before?.lng,
      `${repairLabel} before coordinates`
    );
    assertCoordinatesWithinBounds(
      repair.after?.lat,
      repair.after?.lng,
      `${repairLabel} after coordinates`
    );
    const validFingerprint = (value: KeeperDestinationFingerprint) =>
      value != null && isNonEmptyString(value.name) &&
      typeof value.elevationM === "number" && Number.isFinite(value.elevationM) &&
      isNonEmptyString(value.countryCode) && isNullableNonEmptyString(value.stateCode) &&
      (value.osmNodeId == null ||
        (isNonEmptyString(value.osmNodeId) && /^\d+$/.test(value.osmNodeId))) &&
      (value.osmNodeId == null
        ? value.externalIds?.osm == null
        : value.externalIds?.osm === value.osmNodeId);
    if (!isNonEmptyString(repair.repairId) || auxiliaryRepairIds.has(repair.repairId) ||
        !isNonEmptyString(repair.destinationId) ||
        auxiliaryDestinationIds.has(repair.destinationId) ||
        !validFingerprint(repair.before) || !validFingerprint(repair.after) ||
        !isNonEmptyString(repair.dataSourceName) ||
        !isNonEmptyString(repair.dataSourceUrl) ||
        !/^https:\/\//.test(repair.dataSourceUrl) ||
        !isNullableNonEmptyString(repair.dataLicense) ||
        !Array.isArray(repair.evidence) || repair.evidence.length === 0 ||
        repair.evidence.some((value) => !isNonEmptyString(value))) {
      throw new Error(`Keeper auxiliary catalog repair ${repair.repairId ?? "unknown"} is invalid`);
    }
    if (repair.before.osmNodeId !== repair.after.osmNodeId ||
        repair.before.countryCode !== repair.after.countryCode ||
        repair.before.stateCode !== repair.after.stateCode ||
        haversineMeters(repair.before, repair.after) > CATALOG_FINGERPRINT_DISTANCE_M ||
        Math.abs(repair.before.elevationM - repair.after.elevationM) >
          CATALOG_FINGERPRINT_ELEVATION_M) {
      throw new Error(
        `Keeper auxiliary catalog repair ${repair.repairId} changes more than its reviewed name`
      );
    }
    for (const [key, value] of Object.entries(repair.externalIdRemovals ?? {})) {
      if (key === "osm" || repair.before.externalIds?.[key] !== value) {
        throw new Error(
          `Keeper auxiliary catalog repair ${repair.repairId} has an invalid external-ID removal`
        );
      }
    }
    const expectedAfterExternalIds = { ...(repair.before.externalIds ?? {}) };
    for (const key of Object.keys(repair.externalIdRemovals ?? {})) {
      delete expectedAfterExternalIds[key];
    }
    if (JSON.stringify(Object.entries(repair.after.externalIds ?? {}).sort()) !==
        JSON.stringify(Object.entries(expectedAfterExternalIds).sort())) {
      throw new Error(
        `Keeper auxiliary catalog repair ${repair.repairId} has a wrong after external-ID set`
      );
    }
    auxiliaryRepairIds.add(repair.repairId);
    auxiliaryDestinationIds.add(repair.destinationId);
  }

  const definitionsBySource = new Map(definitions.map((definition) => [
    definition.sourceKey,
    definition,
  ]));
  const seenSourceRows = new Set<string>();
  const seenDestinationsByList = new Map<string, Set<string>>();
  for (const [sourceKey, resolutionList] of Object.entries(resolutions.lists)) {
    const definition = definitionsBySource.get(sourceKey);
    const sourceList = fixture.lists[sourceKey];
    if (!definition || !sourceList) {
      throw new Error(`Keeper resolutions include unknown list ${sourceKey}`);
    }
    if (!resolutionList || !Array.isArray(resolutionList.rows)) {
      throw new Error(`Keeper resolutions for ${sourceKey} do not contain rows`);
    }
    const sourceById = new Map(sourceList.rows.map((member) => [member.sourceMemberId, member]));
    const destinationIds = seenDestinationsByList.get(sourceKey) ?? new Set<string>();
    seenDestinationsByList.set(sourceKey, destinationIds);
    for (const row of resolutionList.rows) {
      const rowKey = `${sourceKey}:${row.sourceMemberId}`;
      if (row.sourceKey !== sourceKey || seenSourceRows.has(rowKey)) {
        throw new Error(`Keeper resolution repeats or mis-scopes ${row.sourceMemberId}`);
      }
      seenSourceRows.add(rowKey);
      const source = sourceById.get(row.sourceMemberId);
      if (!source) {
        throw new Error(`Keeper resolution ${rowKey} is not in the source roster`);
      }
      if (row.resolution !== "existing_destination" &&
          row.resolution !== "catalog_repair" &&
          row.resolution !== "curated_destination") {
        throw new Error(`Keeper resolution ${rowKey} has an invalid outcome`);
      }
      if (!isNonEmptyString(row.destinationId) || destinationIds.has(row.destinationId)) {
        throw new Error(`Keeper resolution ${rowKey} repeats or omits a destination ID`);
      }
      destinationIds.add(row.destinationId);
      if (!isNonEmptyString(row.destinationName) ||
          typeof row.destinationElevationM !== "number" ||
          !Number.isFinite(row.destinationElevationM)) {
        throw new Error(`Keeper resolution ${rowKey} has an incomplete destination fingerprint`);
      }
      assertCoordinatesWithinBounds(
        row.destinationLat,
        row.destinationLng,
        `Keeper resolution ${rowKey} destination coordinates`
      );
      if (Math.abs(row.destinationElevationM - source.elevationM) > MAX_ELEVATION_DELTA_M) {
        throw new Error(`Keeper resolution ${rowKey} exceeds the 100 m elevation bound`);
      }
      if (!isNonEmptyString(row.destinationCountryCode) ||
          !isNullableNonEmptyString(row.destinationStateCode) ||
          (definition.allowedCountryCodes != null &&
            !definition.allowedCountryCodes.includes(row.destinationCountryCode)) ||
          (definition.allowedStateCodes != null &&
            (row.destinationStateCode == null ||
              !definition.allowedStateCodes.includes(row.destinationStateCode)))) {
        throw new Error(`Keeper resolution ${rowKey} is outside the list bounds`);
      }
      if (!Array.isArray(row.evidence) || row.evidence.length === 0 ||
          row.evidence.some((value) => !isNonEmptyString(value))) {
        throw new Error(`Keeper resolution ${rowKey} has no review evidence`);
      }
      if (row.destinationOsmNodeId != null &&
          (!isNonEmptyString(row.destinationOsmNodeId) ||
           !/^\d+$/.test(row.destinationOsmNodeId))) {
        throw new Error(`Keeper resolution ${rowKey} has an invalid OSM node ID`);
      }
      if (row.resolution !== "existing_destination" &&
          (!isNonEmptyString(row.destinationDataSourceName) ||
           !isNonEmptyString(row.destinationDataSourceUrl) ||
           !/^https:\/\//.test(row.destinationDataSourceUrl) ||
           !isNullableNonEmptyString(row.destinationDataLicense ?? null))) {
        throw new Error(`Keeper resolution ${rowKey} has no destination data credit`);
      }
      if (row.distinctFromDestinationIds != null) {
        if (row.resolution !== "curated_destination" ||
            row.distinctFromDestinationIds.length === 0 ||
            new Set(row.distinctFromDestinationIds).size !==
              row.distinctFromDestinationIds.length ||
            row.distinctFromDestinationIds.some((id) =>
              !isNonEmptyString(id) || id === row.destinationId)) {
          throw new Error(`Keeper resolution ${rowKey} has an invalid distinct-neighbor review`);
        }
      }
      if (row.resolution === "catalog_repair") {
        const before = row.catalogBefore;
        if (before == null || typeof before !== "object" || Array.isArray(before)) {
          throw new Error(`Keeper catalog repair ${rowKey} has no valid before fingerprint`);
        }
        assertValidExternalIdRecord(
          before.externalIds,
          `Keeper catalog repair ${rowKey} catalog-before fingerprint`
        );
        assertCoordinatesWithinBounds(
          before.lat,
          before.lng,
          `Keeper catalog repair ${rowKey} catalog-before coordinates`
        );
        if (!isNonEmptyString(before.name) ||
            typeof before.elevationM !== "number" || !Number.isFinite(before.elevationM) ||
            !isNullableNonEmptyString(before.countryCode) ||
            !isNullableNonEmptyString(before.stateCode) ||
            (before.osmNodeId != null &&
              (!isNonEmptyString(before.osmNodeId) || !/^\d+$/.test(before.osmNodeId))) ||
            (before.osmNodeId == null
              ? before.externalIds.osm != null
              : before.externalIds.osm !== before.osmNodeId)) {
          throw new Error(`Keeper catalog repair ${rowKey} has no valid before fingerprint`);
        }
        if (row.catalogExternalIdRemovals != null) {
          assertValidExternalIdRecord(
            row.catalogExternalIdRemovals,
            `Keeper catalog repair ${rowKey} removals`
          );
        }
        if (row.catalogExternalIdAdditions != null) {
          assertValidExternalIdRecord(
            row.catalogExternalIdAdditions,
            `Keeper catalog repair ${rowKey} additions`
          );
        }
        const afterExternalIds = { ...before.externalIds };
        for (const [key, value] of Object.entries(row.catalogExternalIdRemovals ?? {})) {
          if (before.externalIds[key] !== value) {
            throw new Error(`Keeper catalog repair ${rowKey} has a stale external-ID removal`);
          }
          delete afterExternalIds[key];
        }
        for (const [key, value] of Object.entries(row.catalogExternalIdAdditions ?? {})) {
          if (afterExternalIds[key] != null && afterExternalIds[key] !== value) {
            throw new Error(`Keeper catalog repair ${rowKey} has an invalid external-ID addition`);
          }
          afterExternalIds[key] = value;
        }
        if ((afterExternalIds.osm ?? null) !== row.destinationOsmNodeId) {
          throw new Error(`Keeper catalog repair ${rowKey} does not pin its after OSM identity`);
        }
      } else if (row.catalogBefore != null || row.catalogExternalIdAdditions != null ||
          row.catalogExternalIdRemovals != null) {
        throw new Error(`Keeper resolution ${rowKey} has unexpected catalog repair fields`);
      }
      if (hasCoordinates(source)) {
        const distanceM = haversineMeters(source, {
          lat: row.destinationLat,
          lng: row.destinationLng,
        });
        const limit = row.resolution === "curated_destination"
          ? MAX_CURATED_SOURCE_DISTANCE_M
          : MAX_REVIEWED_SOURCE_DISTANCE_M;
        if (distanceM > limit) {
          throw new Error(
            `Keeper resolution ${rowKey} is ${Math.round(distanceM)} m from the source; ` +
            `the reviewed bound is ${limit} m`
          );
        }
      }
      if (row.resolution === "curated_destination") {
        const expectedId = row.destinationOsmNodeId == null
          ? deterministicKeeperDestinationId(row.sourceMemberId)
          : deterministicOsmKeeperDestinationId(row.destinationOsmNodeId);
        if (row.destinationId !== expectedId) {
          throw new Error(`Keeper resolution ${rowKey} has a non-deterministic destination ID`);
        }
      }
    }
  }

  for (const definition of definitions) {
    const reviewed = new Set(
      (resolutions.lists[definition.sourceKey]?.rows ?? []).map((row) => row.sourceMemberId)
    );
    for (const source of fixture.lists[definition.sourceKey].rows) {
      if (!hasCoordinates(source) && !reviewed.has(source.sourceMemberId)) {
        throw new Error(
          `Coordinate-free keeper member ${source.sourceMemberId} needs an explicit resolution`
        );
      }
    }
  }
}

function catalogPeakIsEligible(peak: KeeperCatalogPeak): boolean {
  return peak.owner === "peaks" && peak.destinationType === "point" &&
    Array.isArray(peak.features) && peak.features.includes("summit");
}

function assertCatalogPeakIsEligible(peak: KeeperCatalogPeak, label: string): void {
  if (!catalogPeakIsEligible(peak)) {
    throw new Error(`${label} is not a Peaks-owned point summit`);
  }
}

function externalIdOwnersFromCatalog(catalog: KeeperCatalogPeak[]): KeeperExternalIdOwner[] {
  return catalog.flatMap((peak) => Object.entries(peak.externalIds).map(([key, value]) => ({
    destinationId: peak.id,
    key,
    value,
  })));
}

function assertUniqueOsmOwners(owners: KeeperExternalIdOwner[]): void {
  const byOsmId = new Map<string, Set<string>>();
  for (const owner of owners) {
    if (owner.key !== "osm" || !isNonEmptyString(owner.value)) continue;
    const destinationIds = byOsmId.get(owner.value) ?? new Set<string>();
    destinationIds.add(owner.destinationId);
    byOsmId.set(owner.value, destinationIds);
  }
  const duplicate = [...byOsmId.entries()]
    .map(([osmId, destinationIds]) => [osmId, [...destinationIds].sort()] as const)
    .filter(([, destinationIds]) => destinationIds.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))[0];
  if (duplicate != null) {
    throw new Error(
      `Catalog OSM node ${duplicate[0]} belongs to multiple destinations: ` +
      duplicate[1].join(", ")
    );
  }
}

function catalogMatchesFingerprint(
  catalogPeak: KeeperCatalogPeak,
  fingerprint: KeeperDestinationFingerprint
): boolean {
  return normalizeKeeperPeakName(catalogPeak.name) ===
      normalizeKeeperPeakName(fingerprint.name) &&
    catalogPeak.elevationM != null &&
    Math.abs(catalogPeak.elevationM - fingerprint.elevationM) <=
      CATALOG_FINGERPRINT_ELEVATION_M &&
    haversineMeters(catalogPeak, {
      lat: fingerprint.lat,
      lng: fingerprint.lng,
    }) <= CATALOG_FINGERPRINT_DISTANCE_M &&
    catalogPeak.countryCode === fingerprint.countryCode &&
    catalogPeak.stateCode === fingerprint.stateCode &&
    catalogPeak.osmId === fingerprint.osmNodeId &&
    (fingerprint.externalIds == null ||
      JSON.stringify(Object.entries(catalogPeak.externalIds).sort()) ===
      JSON.stringify(Object.entries(fingerprint.externalIds).sort()));
}

function catalogMatchesRepairBeforeFingerprint(
  catalogPeak: KeeperCatalogPeak,
  fingerprint: KeeperDestinationFingerprint
): boolean {
  return catalogPeak.name === fingerprint.name &&
    catalogPeak.elevationM === fingerprint.elevationM &&
    haversineMeters(catalogPeak, fingerprint) <= CATALOG_FINGERPRINT_DISTANCE_M &&
    catalogPeak.countryCode === fingerprint.countryCode &&
    catalogPeak.stateCode === fingerprint.stateCode &&
    catalogPeak.osmId === fingerprint.osmNodeId &&
    fingerprint.externalIds != null &&
    JSON.stringify(Object.entries(catalogPeak.externalIds).sort()) ===
      JSON.stringify(Object.entries(fingerprint.externalIds).sort());
}

function catalogMatchesExactFingerprint(
  catalogPeak: KeeperCatalogPeak,
  fingerprint: KeeperDestinationFingerprint
): boolean {
  return catalogPeak.name === fingerprint.name &&
    catalogPeak.elevationM === fingerprint.elevationM &&
    catalogPeak.lat === fingerprint.lat &&
    catalogPeak.lng === fingerprint.lng &&
    catalogPeak.countryCode === fingerprint.countryCode &&
    catalogPeak.stateCode === fingerprint.stateCode &&
    catalogPeak.osmId === fingerprint.osmNodeId &&
    (fingerprint.externalIds == null ||
      JSON.stringify(Object.entries(catalogPeak.externalIds).sort()) ===
        JSON.stringify(Object.entries(fingerprint.externalIds).sort()));
}

function reviewedKeeperDestination(
  resolution: KeeperResolutionRow
): ReviewedKeeperDestination {
  return {
    sourceKey: resolution.sourceKey,
    sourceMemberId: resolution.sourceMemberId,
    id: resolution.destinationId,
    name: resolution.destinationName,
    elevationM: resolution.destinationElevationM,
    lat: resolution.destinationLat,
    lng: resolution.destinationLng,
    countryCode: resolution.destinationCountryCode,
    stateCode: resolution.destinationStateCode,
    osmId: resolution.destinationOsmNodeId,
    dataSourceName: resolution.destinationDataSourceName!,
    dataSourceUrl: resolution.destinationDataSourceUrl!,
    dataLicense: resolution.destinationDataLicense ?? null,
  };
}

function catalogMatchesExactReviewedDestination(
  catalogPeak: KeeperCatalogPeak,
  destination: ReviewedKeeperDestination
): boolean {
  const expectedExternalIds = destination.osmId == null ? {} : { osm: destination.osmId };
  return catalogPeak.name === destination.name &&
    catalogPeak.elevationM === destination.elevationM &&
    catalogPeak.lat === destination.lat &&
    catalogPeak.lng === destination.lng &&
    catalogPeak.countryCode === destination.countryCode &&
    catalogPeak.stateCode === destination.stateCode &&
    catalogPeak.osmId === destination.osmId &&
    isValidExternalIdRecord(catalogPeak.externalIds) &&
    JSON.stringify(Object.entries(catalogPeak.externalIds).sort()) ===
      JSON.stringify(Object.entries(expectedExternalIds).sort()) &&
    catalogPeak.owner === "peaks" &&
    catalogPeak.destinationType === "point" &&
    Array.isArray(catalogPeak.features) &&
    catalogPeak.features.length === 1 &&
    catalogPeak.features[0] === "summit" &&
    catalogPeak.dataSourceName === destination.dataSourceName &&
    catalogPeak.dataSourceUrl === destination.dataSourceUrl &&
    catalogPeak.dataLicense === destination.dataLicense &&
    catalogPeak.keeperRosterSource === keeperRosterSource(destination.sourceKey) &&
    catalogPeak.metadataDisplayName === destination.name;
}

function resolutionDestinationFingerprint(
  resolution: KeeperResolutionRow
): KeeperDestinationFingerprint {
  return {
    name: resolution.destinationName,
    elevationM: resolution.destinationElevationM,
    lat: resolution.destinationLat,
    lng: resolution.destinationLng,
    osmNodeId: resolution.destinationOsmNodeId,
    countryCode: resolution.destinationCountryCode,
    stateCode: resolution.destinationStateCode,
    ...(resolution.resolution === "curated_destination" ? {
      externalIds: resolution.destinationOsmNodeId == null
        ? {}
        : { osm: resolution.destinationOsmNodeId },
    } : {}),
  };
}

function catalogRepairAfterFingerprint(
  resolution: KeeperResolutionRow
): KeeperDestinationFingerprint {
  const externalIds = { ...resolution.catalogBefore!.externalIds! };
  for (const key of Object.keys(resolution.catalogExternalIdRemovals ?? {})) {
    delete externalIds[key];
  }
  Object.assign(externalIds, resolution.catalogExternalIdAdditions ?? {});
  return {
    name: resolution.destinationName,
    elevationM: resolution.destinationElevationM,
    lat: resolution.destinationLat,
    lng: resolution.destinationLng,
    osmNodeId: resolution.destinationOsmNodeId,
    countryCode: resolution.destinationCountryCode,
    stateCode: resolution.destinationStateCode,
    externalIds,
  };
}

export function catalogWithReviewedKeeperDestinations(
  catalog: KeeperCatalogPeak[],
  fixture: KeeperImportFixture,
  resolutions: KeeperResolutionFixture,
  definitions: KeeperListDefinition[] = KEEPER_LISTS,
  externalIdOwners: KeeperExternalIdOwner[] = externalIdOwnersFromCatalog(catalog)
): {
  catalog: KeeperCatalogPeak[];
  destinationsToAdd: ReviewedKeeperDestination[];
  destinationsToRepair: ReviewedKeeperCatalogRepair[];
  definitions: KeeperListDefinition[];
} {
  validateKeeperFixture(fixture, definitions);
  validateKeeperResolutionFixture(fixture, resolutions, definitions);
  assertUniqueOsmOwners(externalIdOwners);
  const byId = new Map(catalog.map((peak) => [peak.id, peak]));
  const byOsmId = new Map(
    externalIdOwners
      .filter((owner) => owner.key === "osm" && isNonEmptyString(owner.value))
      .map((owner) => [owner.value, owner.destinationId])
  );
  const additions: KeeperCatalogPeak[] = [];
  const destinationsToAdd: ReviewedKeeperDestination[] = [];
  const destinationsToRepair: ReviewedKeeperCatalogRepair[] = [];
  const overrides = new Map<string, Record<string, string>>();
  const ownersByExternalId = new Map<string, Set<string>>();
  for (const owner of externalIdOwners) {
    const claim = JSON.stringify([owner.key, owner.value]);
    const destinationIds = ownersByExternalId.get(claim) ?? new Set<string>();
    destinationIds.add(owner.destinationId);
    ownersByExternalId.set(claim, destinationIds);
  }
  for (const request of requestedExternalIdAdditions(resolutions)) {
    const claim = JSON.stringify([request.key, request.value]);
    const conflictingOwners = [...(ownersByExternalId.get(claim) ?? [])]
      .filter((ownerId) => ownerId !== request.destinationId)
      .sort();
    if (conflictingOwners.length > 0) {
      throw new Error(
        `Catalog repair ${request.destinationId} requested external ID ` +
        `${request.key}=${request.value}, but it belongs to ${conflictingOwners.join(", ")}`
      );
    }
    const destinationIds = ownersByExternalId.get(claim) ?? new Set<string>();
    destinationIds.add(request.destinationId);
    ownersByExternalId.set(claim, destinationIds);
  }
  const updateOsmIndexForRepair = (
    destinationId: string,
    beforeOsmId: string | null,
    repairedPeak: KeeperCatalogPeak
  ) => {
    if (repairedPeak.osmId != null) {
      const ownerId = byOsmId.get(repairedPeak.osmId);
      if (ownerId && ownerId !== destinationId) {
        throw new Error(
          `Catalog repair ${destinationId} would reuse OSM node ${repairedPeak.osmId} ` +
          `from destination ${ownerId}`
        );
      }
    }
    if (beforeOsmId != null && beforeOsmId !== repairedPeak.osmId &&
        byOsmId.get(beforeOsmId) === destinationId) {
      byOsmId.delete(beforeOsmId);
    }
    if (repairedPeak.osmId != null) byOsmId.set(repairedPeak.osmId, destinationId);
  };

  for (const repair of resolutions.catalogRepairs ?? []) {
    const existing = byId.get(repair.destinationId);
    if (!existing) {
      throw new Error(
        `Auxiliary catalog repair ${repair.repairId} is missing`
      );
    }
    assertCatalogPeakIsEligible(existing, `Auxiliary catalog repair ${repair.repairId}`);
    if (!catalogMatchesRepairBeforeFingerprint(existing, repair.before)) {
      if (catalogMatchesExactFingerprint(existing, repair.after)) {
        updateOsmIndexForRepair(repair.destinationId, repair.before.osmNodeId, existing);
        continue;
      }
      if (catalogMatchesFingerprint(existing, repair.after)) {
        throw new Error(
          `Auxiliary catalog repair ${repair.repairId} does not match its exact reviewed ` +
          "after fingerprint"
        );
      }
      throw new Error(
        `Auxiliary catalog repair ${repair.repairId} matches neither its exact reviewed ` +
        "before fingerprint nor exact reviewed after fingerprint"
      );
    }
    const reviewedRepair: ReviewedKeeperCatalogRepair = {
      sourceKey: "catalog",
      sourceMemberId: repair.repairId,
      id: repair.destinationId,
      name: repair.after.name,
      elevationM: repair.after.elevationM,
      lat: repair.after.lat,
      lng: repair.after.lng,
      countryCode: repair.after.countryCode!,
      stateCode: repair.after.stateCode,
      osmId: repair.after.osmNodeId,
      dataSourceName: repair.dataSourceName,
      dataSourceUrl: repair.dataSourceUrl,
      dataLicense: repair.dataLicense,
      before: repair.before,
      externalIdAdditions: {},
      externalIdRemovals: repair.externalIdRemovals ?? {},
    };
    destinationsToRepair.push(reviewedRepair);
    const repairedExternalIds = { ...existing.externalIds };
    for (const key of Object.keys(reviewedRepair.externalIdRemovals)) {
      delete repairedExternalIds[key];
    }
    const repairedPeak: KeeperCatalogPeak = {
      ...existing,
      id: reviewedRepair.id,
      name: reviewedRepair.name,
      elevationM: reviewedRepair.elevationM,
      lat: reviewedRepair.lat,
      lng: reviewedRepair.lng,
      countryCode: reviewedRepair.countryCode,
      stateCode: reviewedRepair.stateCode,
      osmId: reviewedRepair.osmId,
      externalIds: repairedExternalIds,
    };
    updateOsmIndexForRepair(reviewedRepair.id, repair.before.osmNodeId, repairedPeak);
    byId.set(reviewedRepair.id, repairedPeak);
  }

  for (const resolution of resolutionRows(resolutions)) {
    const sourceOverrides = overrides.get(resolution.sourceKey) ?? {};
    sourceOverrides[resolution.sourceMemberId] = resolution.destinationId;
    overrides.set(resolution.sourceKey, sourceOverrides);
    const existing = byId.get(resolution.destinationId);

    if (resolution.resolution === "existing_destination") {
      if (!existing) {
        throw new Error(
          `Reviewed destination ${resolution.destinationId} for ${resolution.sourceMemberId} is missing`
        );
      }
      assertCatalogPeakIsEligible(
        existing,
        `Reviewed destination ${resolution.destinationId}`
      );
      if (!catalogMatchesFingerprint(existing, resolutionDestinationFingerprint(resolution))) {
        throw new Error(
          `Reviewed destination ${resolution.destinationId} no longer matches its pinned fingerprint`
        );
      }
      continue;
    }

    if (resolution.resolution === "catalog_repair") {
      if (destinationsToRepair.some((repair) => repair.id === resolution.destinationId)) {
        throw new Error(`Destination ${resolution.destinationId} has two catalog repairs`);
      }
      if (!existing) {
        throw new Error(
          `Catalog repair destination ${resolution.destinationId} for ` +
          `${resolution.sourceMemberId} is missing`
        );
      }
      assertCatalogPeakIsEligible(existing, `Catalog repair destination ${resolution.destinationId}`);
      const afterFingerprint = catalogRepairAfterFingerprint(resolution);
      if (!catalogMatchesRepairBeforeFingerprint(existing, resolution.catalogBefore!)) {
        if (catalogMatchesExactFingerprint(existing, afterFingerprint)) {
          updateOsmIndexForRepair(
            resolution.destinationId,
            resolution.catalogBefore!.osmNodeId,
            existing
          );
          continue;
        }
        if (catalogMatchesFingerprint(existing, afterFingerprint)) {
          throw new Error(
            `Catalog repair destination ${resolution.destinationId} does not match its exact ` +
            "reviewed after fingerprint"
          );
        }
        throw new Error(
          `Catalog repair destination ${resolution.destinationId} matches neither its exact ` +
          "reviewed before fingerprint nor exact reviewed after fingerprint"
        );
      }
      const repaired: ReviewedKeeperCatalogRepair = {
        sourceKey: resolution.sourceKey,
        sourceMemberId: resolution.sourceMemberId,
        id: resolution.destinationId,
        name: resolution.destinationName,
        elevationM: resolution.destinationElevationM,
        lat: resolution.destinationLat,
        lng: resolution.destinationLng,
        countryCode: resolution.destinationCountryCode,
        stateCode: resolution.destinationStateCode,
        osmId: resolution.destinationOsmNodeId,
        dataSourceName: resolution.destinationDataSourceName!,
        dataSourceUrl: resolution.destinationDataSourceUrl!,
        dataLicense: resolution.destinationDataLicense ?? null,
        before: resolution.catalogBefore!,
        externalIdAdditions: resolution.catalogExternalIdAdditions ?? {},
        externalIdRemovals: resolution.catalogExternalIdRemovals ?? {},
      };
      destinationsToRepair.push(repaired);
      const repairedPeak: KeeperCatalogPeak = {
        ...existing,
        id: repaired.id,
        name: repaired.name,
        elevationM: repaired.elevationM,
        lat: repaired.lat,
        lng: repaired.lng,
        countryCode: repaired.countryCode,
        stateCode: repaired.stateCode,
        osmId: repaired.osmId,
        externalIds: afterFingerprint.externalIds!,
      };
      updateOsmIndexForRepair(
        repaired.id,
        resolution.catalogBefore!.osmNodeId,
        repairedPeak
      );
      byId.set(repaired.id, repairedPeak);
      continue;
    }

    if (resolution.destinationOsmNodeId != null) {
      const existingByOsmId = byOsmId.get(resolution.destinationOsmNodeId);
      if (existingByOsmId && existingByOsmId !== resolution.destinationId) {
        throw new Error(
          `OSM node ${resolution.destinationOsmNodeId} already belongs to destination ` +
          existingByOsmId
        );
      }
    }
    const destination = reviewedKeeperDestination(resolution);
    if (existing) {
      if (!catalogMatchesExactReviewedDestination(existing, destination)) {
        throw new Error(
          `Curated destination ID ${resolution.destinationId} does not match its exact ` +
          "reviewed fingerprint"
        );
      }
      continue;
    }
    const duplicate = [...byId.values()].find((peak) =>
      haversineMeters(peak, {
        lat: resolution.destinationLat,
        lng: resolution.destinationLng,
      }) <= REVIEWED_DUPLICATE_DISTANCE_M &&
      !(resolution.distinctFromDestinationIds ?? []).includes(peak.id)
    );
    if (duplicate) {
      throw new Error(
        `Curated destination ${resolution.destinationName} is within 150 m of ` +
        `${duplicate.id}:${duplicate.name}`
      );
    }
    destinationsToAdd.push(destination);
    const catalogAddition: KeeperCatalogPeak = {
      id: destination.id,
      name: destination.name,
      elevationM: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      countryCode: destination.countryCode,
      stateCode: destination.stateCode,
      osmId: destination.osmId,
      externalIds: destination.osmId == null ? {} : { osm: destination.osmId },
      owner: "peaks",
      destinationType: "point",
      features: ["summit"],
      dataSourceName: destination.dataSourceName,
      dataSourceUrl: destination.dataSourceUrl,
      dataLicense: destination.dataLicense,
      keeperRosterSource: keeperRosterSource(destination.sourceKey),
      metadataDisplayName: destination.name,
    };
    additions.push(catalogAddition);
    byId.set(destination.id, catalogAddition);
    if (destination.osmId != null) byOsmId.set(destination.osmId, destination.id);
  }

  return {
    catalog: [
      ...catalog.filter(catalogPeakIsEligible).map((peak) => byId.get(peak.id) ?? peak),
      ...additions,
    ],
    destinationsToAdd,
    destinationsToRepair,
    definitions: definitions.map((definition) => ({
      ...definition,
      destinationOverrides: {
        ...definition.destinationOverrides,
        ...(overrides.get(definition.sourceKey) ?? {}),
      },
    })),
  };
}

function inListScope(peak: KeeperCatalogPeak, list: KeeperListDefinition): boolean {
  return (list.allowedCountryCodes == null ||
      (peak.countryCode != null && list.allowedCountryCodes.includes(peak.countryCode))) &&
    (list.allowedStateCodes == null ||
      (peak.stateCode != null && list.allowedStateCodes.includes(peak.stateCode)));
}

function candidateSummary(
  source: KeeperSourceMember,
  candidates: KeeperCatalogPeak[]
): KeeperResolutionIssue["candidates"] {
  return candidates
    .map((peak) => ({
      id: peak.id,
      name: peak.name,
      elevationM: peak.elevationM,
      ...(hasCoordinates(source) ? { distanceM: Math.round(haversineMeters(source, peak)) } : {}),
    }))
    .sort((left, right) => (left.distanceM ?? 0) - (right.distanceM ?? 0) ||
      left.name.localeCompare(right.name));
}

function nearbyAuditCandidates(
  source: KeeperSourceMember,
  catalog: KeeperCatalogPeak[],
  list: KeeperListDefinition
): KeeperCatalogPeak[] {
  if (!hasCoordinates(source)) return [];
  return catalog
    .filter((peak) => inListScope(peak, list) && peak.elevationM != null &&
      Math.abs(peak.elevationM - source.elevationM) <= MAX_ELEVATION_DELTA_M &&
      haversineMeters(source, peak) <= NEARBY_AUDIT_DISTANCE_M)
    .sort((left, right) => haversineMeters(source, left) - haversineMeters(source, right))
    .slice(0, 5);
}

function resolveAutomaticCandidate(
  source: KeeperSourceMember,
  catalog: KeeperCatalogPeak[],
  list: KeeperListDefinition
): KeeperCatalogPeak[] {
  if (!hasCoordinates(source)) return [];
  const sourceNames = new Set(
    [source.name, ...(source.aliases ?? [])].map(normalizeKeeperPeakName)
  );
  return catalog.filter((peak) =>
    sourceNames.has(normalizeKeeperPeakName(peak.name)) &&
    peak.elevationM != null &&
    Math.abs(peak.elevationM - source.elevationM) <= MAX_ELEVATION_DELTA_M &&
    inListScope(peak, list) &&
    haversineMeters(source, peak) <= MAX_SOURCE_DISTANCE_M
  );
}

function validateOverrideCandidate(
  source: KeeperSourceMember,
  candidate: KeeperCatalogPeak,
  list: KeeperListDefinition
): string | null {
  if (!inListScope(candidate, list)) return "reviewed override is outside the list bounds";
  if (candidate.elevationM == null ||
      Math.abs(candidate.elevationM - source.elevationM) > MAX_ELEVATION_DELTA_M) {
    return "reviewed override exceeds the 100 m elevation bound";
  }
  if (hasCoordinates(source) &&
      haversineMeters(source, candidate) > MAX_REVIEWED_SOURCE_DISTANCE_M) {
    return "reviewed override exceeds the 250 m source-coordinate bound";
  }
  return null;
}

export function resolveKeeperList(
  list: KeeperListDefinition,
  source: KeeperSourceList,
  catalog: KeeperCatalogPeak[]
): { members: ResolvedKeeperMember[]; issues: KeeperResolutionIssue[] } {
  const eligibleCatalog = catalog.filter(catalogPeakIsEligible);
  const catalogById = new Map(eligibleCatalog.map((peak) => [peak.id, peak]));
  const members: ResolvedKeeperMember[] = [];
  const issues: KeeperResolutionIssue[] = [];

  for (const sourceMember of [...source.rows].sort((left, right) => left.ordinal - right.ordinal)) {
    const overrideId = list.destinationOverrides[sourceMember.sourceMemberId];
    let candidates: KeeperCatalogPeak[];
    let reason: string | null = null;
    if (overrideId) {
      const candidate = catalogById.get(overrideId);
      candidates = candidate ? [candidate] : [];
      reason = candidate
        ? validateOverrideCandidate(sourceMember, candidate, list)
        : `reviewed override ${overrideId} is missing`;
    } else {
      candidates = resolveAutomaticCandidate(sourceMember, eligibleCatalog, list);
      if (candidates.length !== 1) {
        reason = candidates.length === 0
          ? "no exact scoped name and elevation match"
          : `${candidates.length} exact scoped matches need review`;
      }
    }

    if (reason || candidates.length !== 1) {
      const auditCandidates = candidates.length > 0
        ? candidates
        : nearbyAuditCandidates(sourceMember, eligibleCatalog, list);
      issues.push({
        sourceMemberId: sourceMember.sourceMemberId,
        sourceName: sourceMember.name,
        reason: reason ?? "identity did not resolve to one destination",
        candidates: candidateSummary(sourceMember, auditCandidates),
      });
      continue;
    }

    members.push({
      destinationId: candidates[0].id,
      ordinal: sourceMember.ordinal - 1,
      sourceMemberId: sourceMember.sourceMemberId,
      sourceName: sourceMember.name,
    });
  }

  const destinationMembers = new Map<string, ResolvedKeeperMember[]>();
  for (const member of members) {
    const prior = destinationMembers.get(member.destinationId) ?? [];
    prior.push(member);
    destinationMembers.set(member.destinationId, prior);
  }
  for (const [destinationId, duplicates] of destinationMembers) {
    if (duplicates.length < 2) continue;
    for (const duplicate of duplicates) {
      issues.push({
        sourceMemberId: duplicate.sourceMemberId,
        sourceName: duplicate.sourceName,
        reason: `two source members resolve to destination ${destinationId}`,
        candidates: [],
      });
    }
  }
  const duplicateIds = new Set(
    [...destinationMembers.entries()]
      .filter(([, duplicates]) => duplicates.length > 1)
      .map(([destinationId]) => destinationId)
  );
  return {
    members: members.filter((member) => !duplicateIds.has(member.destinationId)),
    issues,
  };
}

function buildResolutionPlan(
  list: KeeperListDefinition,
  source: KeeperSourceList,
  catalog: KeeperCatalogPeak[],
  current: CurrentListMember[]
): KeeperListResolution {
  const { members, issues } = resolveKeeperList(list, source, catalog);
  const desiredById = new Map(members.map((member) => [member.destinationId, member]));
  const currentForList = current.filter((member) => member.listId === list.listId);
  const currentById = new Map(currentForList.map((member) => [member.destinationId, member]));
  return {
    list,
    members,
    issues,
    addedDestinationIds: members
      .filter((member) => !currentById.has(member.destinationId))
      .map((member) => member.destinationId),
    removedDestinationIds: currentForList
      .filter((member) => !desiredById.has(member.destinationId))
      .map((member) => member.destinationId),
    reorderedDestinationIds: members
      .filter((member) => currentById.get(member.destinationId)?.ordinal !== member.ordinal &&
        currentById.has(member.destinationId))
      .map((member) => member.destinationId),
  };
}

export function buildKeeperImportReport(
  fixture: KeeperImportFixture,
  resolutions: KeeperResolutionFixture,
  catalog: KeeperCatalogPeak[],
  current: CurrentListMember[],
  apply: boolean,
  definitions: KeeperListDefinition[] = KEEPER_LISTS,
  externalIdOwners: KeeperExternalIdOwner[] = externalIdOwnersFromCatalog(catalog)
): {
  report: KeeperImportReport;
  plans: KeeperListResolution[];
  destinationsToAdd: ReviewedKeeperDestination[];
  destinationsToRepair: ReviewedKeeperCatalogRepair[];
} {
  const reviewed = catalogWithReviewedKeeperDestinations(
    catalog,
    fixture,
    resolutions,
    definitions,
    externalIdOwners
  );
  const plans = reviewed.definitions.map((list) =>
    buildResolutionPlan(list, fixture.lists[list.sourceKey], reviewed.catalog, current)
  );
  const nameById = new Map(reviewed.catalog.map((peak) => [peak.id, peak.name]));
  const complete = plans.every((plan) =>
    plan.issues.length === 0 && plan.members.length === plan.list.expectedCount
  );
  return {
    plans,
    destinationsToAdd: reviewed.destinationsToAdd,
    destinationsToRepair: reviewed.destinationsToRepair,
    report: {
      apply,
      complete,
      destinationsToAdd: reviewed.destinationsToAdd.map((destination) => ({
        sourceMemberId: destination.sourceMemberId,
        id: destination.id,
        name: destination.name,
        osmId: destination.osmId,
      })),
      destinationsToRepair: reviewed.destinationsToRepair.map((destination) => ({
        sourceMemberId: destination.sourceMemberId,
        id: destination.id,
        beforeName: destination.before.name,
        name: destination.name,
      })),
      lists: plans.map((plan) => ({
        id: plan.list.listId,
        sourceKey: plan.list.sourceKey,
        name: plan.list.name,
        sourceName: plan.list.sourceName,
        sourceUrl: plan.list.sourceUrl,
        expectedCount: plan.list.expectedCount,
        resolvedCount: plan.members.length,
        unresolvedCount: plan.issues.length,
        issues: plan.issues,
        added: plan.addedDestinationIds.map((id) => ({ id, name: nameById.get(id) ?? null })),
        removed: plan.removedDestinationIds.map((id) => ({ id, name: nameById.get(id) ?? null })),
        reorderedCount: plan.reorderedDestinationIds.length,
      })),
    },
  };
}

async function loadCatalog(
  client: PoolClient,
  requestedClaims: KeeperExternalIdOwner[] = []
): Promise<{
  catalog: KeeperCatalogPeak[];
  externalIdOwners: KeeperExternalIdOwner[];
}> {
  const identityResult = await client.query<{
    destination_id: string;
    key: string;
    value: string;
  }>(
    `WITH requested AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         destination_id text, key text, value text
       )
     )
     SELECT destination.id AS destination_id, claim.key, claim.value
     FROM destinations destination
     CROSS JOIN LATERAL jsonb_each_text(
       COALESCE(destination.external_ids, '{}'::jsonb)
     ) claim
     WHERE (claim.key = 'osm' AND btrim(claim.value) <> '')
        OR EXISTS (
          SELECT 1
          FROM requested
          WHERE requested.key = claim.key
            AND requested.value = claim.value
        )
     ORDER BY claim.key, claim.value, destination.id`,
    [JSON.stringify(requestedClaims.map((claim) => ({
      destination_id: claim.destinationId,
      key: claim.key,
      value: claim.value,
    })))]
  );
  const externalIdOwners = identityResult.rows
    .filter((row) => isNonEmptyString(row.destination_id) &&
      isNonEmptyString(row.key) && isNonEmptyString(row.value))
    .map((row) => ({
      destinationId: row.destination_id,
      key: row.key,
      value: row.value,
    }));
  assertUniqueOsmOwners(externalIdOwners);

  const result = await client.query<{
    id: string;
    name: string;
    elevation_m: string | number | null;
    lat: string | number;
    lng: string | number;
    osm_id: string | null;
    external_ids: Record<string, string> | null;
    country_code: string | null;
    state_code: string | null;
    owner: string | null;
    destination_type: string | null;
    features: string[];
    metadata_source: string | null;
    metadata_source_url: string | null;
    metadata_source_license: string | null;
    keeper_roster_source: string | null;
    metadata_display_name: string | null;
  }>(
    `SELECT id, name, elevation AS elevation_m,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id,
            external_ids,
            country_code,
            state_code,
            owner::text AS owner,
            type::text AS destination_type,
            features::text[] AS features,
            metadata->>'source' AS metadata_source,
            metadata->>'source_url' AS metadata_source_url,
            metadata->>'source_license' AS metadata_source_license,
            metadata->>'keeper_roster_source' AS keeper_roster_source,
            metadata->'names'->>'display' AS metadata_display_name
     FROM destinations
     WHERE location IS NOT NULL
       AND name IS NOT NULL
       AND owner = 'peaks'
       AND type = 'point'
       AND 'summit'::destination_feature = ANY(features)`
  );
  const catalog = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    elevationM: row.elevation_m == null ? null : Number(row.elevation_m),
    lat: Number(row.lat),
    lng: Number(row.lng),
    countryCode: row.country_code,
    stateCode: row.state_code,
    osmId: row.osm_id,
    externalIds: row.external_ids ?? {},
    owner: row.owner,
    destinationType: row.destination_type,
    features: row.features,
    dataSourceName: row.metadata_source,
    dataSourceUrl: row.metadata_source_url,
    dataLicense: row.metadata_source_license,
    keeperRosterSource: row.keeper_roster_source,
    metadataDisplayName: row.metadata_display_name,
  }));
  return { catalog, externalIdOwners };
}

async function loadCurrentMembers(
  client: PoolClient,
  listIds: string[]
): Promise<CurrentListMember[]> {
  const result = await client.query<{
    list_id: string;
    destination_id: string;
    ordinal: number;
  }>(
    `SELECT list_id, destination_id, ordinal
     FROM list_destinations
     WHERE list_id = ANY($1::text[])`,
    [listIds]
  );
  return result.rows.map((row) => ({
    listId: row.list_id,
    destinationId: row.destination_id,
    ordinal: Number(row.ordinal),
  }));
}

async function insertReviewedKeeperDestinations(
  client: PoolClient,
  destinations: ReviewedKeeperDestination[]
): Promise<void> {
  if (destinations.length === 0) return;
  await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         source_key text, id text, name text, elevation_m double precision,
         lat double precision, lng double precision, country_code text,
         state_code text, osm_id text, data_source_name text,
         data_source_url text, data_license text
       )
     )
     INSERT INTO destinations (
       id, name, search_name, elevation, location, type, activities, features,
       owner, country_code, state_code, external_ids, metadata
     )
     SELECT incoming.id,
            incoming.name,
            lower(incoming.name),
            incoming.elevation_m,
            ST_SetSRID(
              ST_MakePoint(incoming.lng, incoming.lat, incoming.elevation_m),
              4326
            )::geography,
            'point',
            ARRAY['outdoor-trek']::activity_type[],
            ARRAY['summit']::destination_feature[],
            'peaks',
            incoming.country_code,
            incoming.state_code,
            CASE WHEN incoming.osm_id IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('osm', incoming.osm_id)
            END,
            jsonb_strip_nulls(jsonb_build_object(
              'source', incoming.data_source_name,
              'source_url', incoming.data_source_url,
              'source_license', incoming.data_license,
              'keeper_roster_source', CASE WHEN incoming.source_key LIKE 'dobih-%'
                                           THEN 'dobih-v18.5'
                                           ELSE 'uiaa-bulletin-152'
                                      END,
              'catalog_audit', 'keeper-lists-2026-08-30',
              'names', jsonb_build_object('display', incoming.name)
            ))
     FROM incoming
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(destinations.map((destination) => ({
      source_key: destination.sourceKey,
      id: destination.id,
      name: destination.name,
      elevation_m: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      country_code: destination.countryCode,
      state_code: destination.stateCode,
      osm_id: destination.osmId,
      data_source_name: destination.dataSourceName,
      data_source_url: destination.dataSourceUrl,
      data_license: destination.dataLicense,
    })))]
  );
}

export async function assertReviewedKeeperDestinations(
  client: PoolClient,
  destinations: ReviewedKeeperDestination[]
): Promise<void> {
  if (destinations.length === 0) return;
  const { catalog } = await loadCatalog(client);
  const byId = new Map(catalog.map((peak) => [peak.id, peak]));
  for (const destination of destinations) {
    const inserted = byId.get(destination.id);
    if (!inserted || !catalogMatchesExactReviewedDestination(inserted, destination)) {
      throw new Error(
        `Reviewed destination ${destination.id} did not persist with its exact reviewed fingerprint`
      );
    }
  }
}

export async function applyReviewedKeeperCatalogRepairs(
  client: PoolClient,
  repairs: ReviewedKeeperCatalogRepair[]
): Promise<void> {
  for (const repair of repairs) {
    const result = await client.query<{
      id: string;
      external_ids: Record<string, string>;
      metadata_names: Record<string, string>;
    }>(
      `UPDATE destinations
       SET name = $2,
           search_name = lower($2),
           elevation = $3,
           location = ST_SetSRID(ST_MakePoint($5, $4, $3), 4326)::geography,
           country_code = $6,
           state_code = $7,
           external_ids = (external_ids - $20::text[]) || $21::jsonb,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'names', COALESCE(metadata->'names', '{}'::jsonb) ||
               jsonb_build_object('display', $2),
             'catalog_audit', 'keeper-lists-2026-08-30',
             'keeper_identity_repaired_at', '2026-08-30',
             'keeper_repair_source', $16,
             'keeper_repair_source_url', $17,
             'keeper_repair_source_license', $18
           ),
           updated_at = now()
       WHERE id = $1
         AND owner = 'peaks'
         AND type = 'point'
         AND 'summit'::destination_feature = ANY(features)
         AND name = $8
         AND elevation IS NOT DISTINCT FROM $9::double precision
         AND ST_DWithin(
           location,
           ST_SetSRID(ST_MakePoint($11, $10), 4326)::geography,
           $14
         )
         AND country_code IS NOT DISTINCT FROM $12
         AND state_code IS NOT DISTINCT FROM $13
         AND external_ids->>'osm' IS NOT DISTINCT FROM $15
         AND external_ids IS NOT DISTINCT FROM $19::jsonb
         AND NOT EXISTS (
           SELECT 1
           FROM destinations conflicting
           CROSS JOIN LATERAL jsonb_each_text($21::jsonb) requested
           WHERE conflicting.id <> $1
             AND conflicting.external_ids->>requested.key = requested.value
         )
       RETURNING id, external_ids, metadata->'names' AS metadata_names`,
      [
        repair.id,
        repair.name,
        repair.elevationM,
        repair.lat,
        repair.lng,
        repair.countryCode,
        repair.stateCode,
        repair.before.name,
        repair.before.elevationM,
        repair.before.lat,
        repair.before.lng,
        repair.before.countryCode,
        repair.before.stateCode,
        CATALOG_FINGERPRINT_DISTANCE_M,
        repair.before.osmNodeId,
        repair.dataSourceName,
        repair.dataSourceUrl,
        repair.dataLicense,
        JSON.stringify(repair.before.externalIds),
        Object.keys(repair.externalIdRemovals),
        JSON.stringify(repair.externalIdAdditions),
      ]
    );
    const expectedExternalIds = { ...(repair.before.externalIds ?? {}) };
    for (const key of Object.keys(repair.externalIdRemovals)) delete expectedExternalIds[key];
    Object.assign(expectedExternalIds, repair.externalIdAdditions);
    const repaired = result.rows[0];
    if (result.rowCount !== 1 || repaired?.metadata_names?.display !== repair.name ||
        JSON.stringify(Object.entries(repaired?.external_ids ?? {}).sort()) !==
          JSON.stringify(Object.entries(expectedExternalIds).sort())) {
      throw new Error(
        `Catalog repair ${repair.id} did not persist its reviewed fingerprint`
      );
    }
  }
}

export async function refreshAffectedDestinationAreaLinks(
  client: PoolClient,
  destinationIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(destinationIds)].sort();
  if (uniqueIds.length === 0) return;
  await client.query(
    `DELETE FROM destination_areas
     WHERE source = 'postgis'
       AND destination_id = ANY($1::text[])`,
    [uniqueIds]
  );
  await client.query(
    `INSERT INTO destination_areas (destination_id, area_id, relation, source)
     SELECT d.id, matched.id, 'contained_by', 'postgis'
     FROM destinations d
     CROSS JOIN LATERAL (
       SELECT ST_Force2D(d.location::geometry) AS geom,
              d.location::geography AS gloc,
              ST_X(ST_Force2D(d.location::geometry)) AS lng,
              ST_Y(ST_Force2D(d.location::geometry)) AS lat,
              GREATEST($2::double precision / 30000.0, 0.0002) AS gate_deg
     ) point
     JOIN LATERAL (
       SELECT a.id
       FROM areas a
       WHERE point.lng BETWEEN a.bbox_min_lng - point.gate_deg
                           AND a.bbox_max_lng + point.gate_deg
         AND point.lat BETWEEN a.bbox_min_lat - point.gate_deg
                           AND a.bbox_max_lat + point.gate_deg
         AND ST_DWithin(a.boundary, point.geom, point.gate_deg)
         AND (
           ST_Covers(a.boundary, point.geom)
           OR ST_DWithin(a.boundary::geography, point.gloc, $2)
         )
     ) matched ON true
     WHERE d.id = ANY($1::text[])
       AND d.location IS NOT NULL
       AND 'summit'::destination_feature = ANY(d.features)
     ON CONFLICT (destination_id, area_id) DO NOTHING`,
    [uniqueIds, 50]
  );
}

async function applyKeeperPlans(
  client: PoolClient,
  plans: KeeperListResolution[],
  destinationsToAdd: ReviewedKeeperDestination[],
  destinationsToRepair: ReviewedKeeperCatalogRepair[]
): Promise<void> {
  await applyReviewedKeeperCatalogRepairs(client, destinationsToRepair);
  await insertReviewedKeeperDestinations(client, destinationsToAdd);
  await assertReviewedKeeperDestinations(client, destinationsToAdd);
  await refreshAffectedDestinationAreaLinks(
    client,
    [...destinationsToAdd, ...destinationsToRepair].map((destination) => destination.id)
  );
  for (const plan of plans) {
    await client.query(
      `INSERT INTO lists (
         id, name, description, owner,
         year_established, organization, source_name, source_url, region
       )
       VALUES ($1, $2, $3, 'peaks', $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         owner = EXCLUDED.owner,
         year_established = EXCLUDED.year_established,
         organization = EXCLUDED.organization,
         source_name = EXCLUDED.source_name,
         source_url = EXCLUDED.source_url,
         region = EXCLUDED.region,
         updated_at = now()`,
      [
        plan.list.listId,
        plan.list.name,
        plan.list.description,
        plan.list.yearEstablished,
        plan.list.organization,
        plan.list.sourceName,
        plan.list.sourceUrl,
        plan.list.region,
      ]
    );
    const desiredIds = plan.members.map((member) => member.destinationId);
    await client.query(
      `DELETE FROM list_destinations
       WHERE list_id = $1
         AND NOT (destination_id = ANY($2::text[]))`,
      [plan.list.listId, desiredIds]
    );
    await client.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
           list_id text, destination_id text, ordinal int
         )
       )
       INSERT INTO list_destinations (list_id, destination_id, ordinal)
       SELECT list_id, destination_id, ordinal FROM incoming
       ON CONFLICT (list_id, destination_id) DO UPDATE
         SET ordinal = EXCLUDED.ordinal`,
      [JSON.stringify(plan.members.map((member) => ({
        list_id: plan.list.listId,
        destination_id: member.destinationId,
        ordinal: member.ordinal,
      })))]
    );
  }
}

export async function beginKeeperImportTransaction(
  client: PoolClient,
  apply: boolean
): Promise<void> {
  await client.query(
    apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" :
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
  );
}

async function runImport(
  client: PoolClient,
  fixture: KeeperImportFixture,
  resolutions: KeeperResolutionFixture,
  apply: boolean
): Promise<KeeperImportReport> {
  await beginKeeperImportTransaction(client, apply);
  try {
    if (apply) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('keeper-list-import'))");
    }
    const requestedClaims = requestedExternalIdAdditions(resolutions);
    const { catalog, externalIdOwners } = await loadCatalog(client, requestedClaims);
    const current = await loadCurrentMembers(client, KEEPER_LISTS.map((list) => list.listId));
    const { report, plans, destinationsToAdd, destinationsToRepair } = buildKeeperImportReport(
      fixture,
      resolutions,
      catalog,
      current,
      apply,
      KEEPER_LISTS,
      externalIdOwners
    );
    if (apply && !report.complete) {
      throw new Error("Keeper list apply refused: one or more identities remain unresolved");
    }
    if (apply) {
      await applyKeeperPlans(client, plans, destinationsToAdd, destinationsToRepair);
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseKeeperImportArgs();
  const fixture = JSON.parse(await fs.readFile(args.input, "utf8")) as KeeperImportFixture;
  const resolutions = JSON.parse(
    await fs.readFile(args.resolutions, "utf8")
  ) as KeeperResolutionFixture;
  const client = await db.connect();
  try {
    const report = await runImport(client, fixture, resolutions, args.apply);
    console.log(JSON.stringify(report, null, 2));
    if (!report.complete) process.exitCode = 2;
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
