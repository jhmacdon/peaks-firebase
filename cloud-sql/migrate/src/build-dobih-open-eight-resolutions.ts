/** Builds the reviewed DoBIH open-eight identity-resolution fixture offline. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseStrictCsv } from "./build-dobih-open-eight-fixture";
import {
  deterministicKeeperDestinationId,
  type KeeperAuxiliaryCatalogRepair,
  type KeeperDestinationFingerprint,
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  type KeeperResolutionRow,
  type KeeperSourceMember,
  validateKeeperCrossListConsistency,
  validateKeeperFixture,
  validateKeeperResolutionFixture,
} from "./keeper-list-import/core";
import { DOBIH_OPEN_EIGHT_KEEPER_LISTS } from "./keeper-list-import/bundles/dobih-open-eight";

const REVIEWED_AT = "2026-08-30";
const CANDIDATE_FIXTURE_SHA256 =
  "3b778aae7ed3414183ea38cc137c412a7b3d4d12a67c7e7dead8d065e80645ae";
const BASE_RESOLUTION_FIXTURE_SHA256 =
  "326d0c949af54a059768aab61c18171b7d43470a2c29d7add9f9b8ad103aca77";
const DOBIH_CSV_SHA256 =
  "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea";
const CATALOG_CSV_SHA256 =
  "ba9eafe8f7a97f1b96a95c4b0c4a2fc6818f575da9425c1b57dd19467c319726";
const UNRESOLVED_ANALYSIS_SHA256 =
  "77aeff4d1c11c0202568c351bc578a6437e85219808540aedbf60e01a9b2c502";
const NEARBY_OSM_SHA256 =
  "1c1f8f128949bf0f400498567df2d8320dced0f6f83d2d8d8f882ee2dbbf6c8e";
const NEAREST_OSM_SHA256 =
  "49a13a228df0e9658f9d9e76e98ab849ccfdfea170ab0cfaf170ef7b03dac3d4";

const DOBIH_SOURCE_NAME = "The Database of British and Irish Hills v18.5";
const DOBIH_SOURCE_LICENSE = "CC BY 4.0";

const SOURCE_KEYS = [
  "dobih-munro-tops",
  "dobih-furths",
  "dobih-donalds",
  "dobih-wainwright-outlying-fells",
  "dobih-fellrangers",
  "dobih-vandeleur-lynams",
  "dobih-irish-2000-foot-register",
  "dobih-grahams",
] as const;

const EXISTING_DESTINATION_IDS: Record<string, string> = {
  "dobih:1970": "EA167DC54BCA8EBAE624",
  "dobih:20024": "EC1C68B230A66BADFEA3",
  "dobih:20012": "78837CC8D923A3F2B614",
  "dobih:3863": "93DED9CD8B5ED4A78A6D",
  "dobih:20020": "9D60D2B084F46B54C8CD",
  "dobih:1678": "05502EEB409637E0D426",
  "dobih:3761": "94473F8327C5FE57CFFF",
  "dobih:20064": "FBAFFA7BE5B037F3075C",
  "dobih:20076": "71272E5C1336993A32A0",
  "dobih:20093": "39472B53D5E6F99D178C",
  "dobih:1964": "4F5C41476E5112CC5098",
  "dobih:2586": "19C3F7853C2A48A0F0A1",
  "dobih:20214": "9C6A6833F9F69EBD3D4F",
  "dobih:20140": "7358609AE231C261ECB2",
  "dobih:20009": "E27209629BBE574F720B",
  "dobih:1963": "gI7CJFLF98a4gaL4dPwZ",
  "dobih:11": "0587ACB8A87EC6D87545",
  "dobih:187": "67BC59CFCC4267D61CC0",
  "dobih:2697": "AC65EE115B00A7BCCFDB",
  "dobih:1167": "B76BECD4DB54DCCC01D0",
  "dobih:1218": "4AB29CA8376BBF0A41DF",
  "dobih:20210": "72A56C116A4449382D27",
  "dobih:20086": "19CD9FFCC4634C676086",
  "dobih:20126": "CA68ADF6E1097EBDE7A3",
  "dobih:20114": "838356B60DB94AE590B1",
  "dobih:20169": "91B5E70173639D457CB4",
};

const DIRECT_CATALOG_REPAIRS: Record<string, string> = {
  "dobih:99": "CE9EAA9D73E23237966E",
  "dobih:681": "2FF8B47F8C691BD20358",
  "dobih:786": "E430C7936F66347EBAFE",
  "dobih:996": "8426AC54741E8DE5F686",
};

const AUXILIARY_AFTER_EXISTING_DESTINATION_IDS: Record<string, string> = {
  "dobih:3713": "E9144D2AE04F27E48524",
};

const DIRECT_REPAIR_EVIDENCE: Record<string, string> = {
  "dobih:99":
    "DoBIH places Mid Hill at the main summit and says the cairn about 150 m northeast is lower; the catalog point is that lower Coire na h-Eanachan point.",
  "dobih:681":
    "DoBIH's surveyed Creag Ruadh point is 55 m from the catalog Càrn Bàn point and says the close contenders are lower; repair the shared summit identity to the surveyed point.",
  "dobih:786":
    "OpenStreetMap's English name for the catalog Stob a' Ghrianain identity is Druim Fada; DoBIH supplies the reviewed main-summit point and height.",
  "dobih:996":
    "The same-name catalog record is the wrong point for Beinn na Feusaige; DoBIH supplies the surveyed main-summit point and height.",
};

const REVIEWED_DISTINCT_SOURCE_IDS = new Set([
  "dobih:1006",
  "dobih:1244",
  "dobih:1249",
  "dobih:1251",
  "dobih:1252",
  "dobih:1253",
  "dobih:1256",
  "dobih:1260",
  "dobih:2381",
  "dobih:2505",
]);

const REVIEWED_SECONDARY_SPLITS: Record<string, {
  destinationId: string;
  supportNumber: number;
  secondaryName: string;
  expectedDistanceM: number;
}> = {
  "dobih:1693": {
    destinationId: "11FFD6FDDC71B35D0B3D",
    supportNumber: 1694,
    secondaryName: "Meikle Millyea - Trig Point",
    expectedDistanceM: 12,
  },
  "dobih:722": {
    destinationId: "41E90A8FB96CF8FA49BC",
    supportNumber: 6355,
    secondaryName: "Beinn a' Chapuill West Top",
    expectedDistanceM: 50,
  },
  "dobih:725": {
    destinationId: "49C9C1351ECC38DCBC6C",
    supportNumber: 4269,
    secondaryName: "Beinn Clachach West Top",
    expectedDistanceM: 14,
  },
  "dobih:756": {
    destinationId: "BD4107A7C69C1B737239",
    supportNumber: 4284,
    secondaryName: "Meall nan Eun West Top",
    expectedDistanceM: 127,
  },
};

const CURATED_NAME_OVERRIDES: Record<string, string> = {
  "dobih:2381": "High Stile (Fellranger summit)",
  "dobih:2505": "Dent (Wainwright summit)",
};

const NORTHERN_IRELAND_DISTRICTS = [
  "Causeway Coast and Glens",
  "Derry City and Strabane",
  "Fermanagh and Omagh",
  "Newry, Mourne and Down",
] as const;

interface CatalogRow {
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  osmNodeId: string | null;
  externalIds: Record<string, string>;
  countryCode: string | null;
  stateCode: string | null;
}

interface RawDobihRow {
  number: number;
  name: string;
  observations: string;
  comments: string;
  lat: number;
  lng: number;
  country: string;
  county: string;
}

interface AnalysisEntry {
  number: number;
  name: string;
  aliases: string[];
  elevation: number;
  lat: number;
  lng: number;
  owners: string[];
  exact: unknown[];
  nearby: Array<[string, string, number]>;
}

type UnresolvedAnalysis = Record<string, AnalysisEntry>;

interface BuildInputs {
  candidateBytes: Buffer;
  baseResolutionBytes: Buffer;
  dobihCsvBytes: Buffer;
  catalogCsvBytes: Buffer;
  analysisBytes: Buffer;
  nearbyOsmBytes: Buffer;
  nearestOsmBytes: Buffer;
}

interface BuildArgs {
  candidates: string;
  baseResolutions: string;
  dobihCsv: string;
  catalog: string;
  analysis: string;
  nearbyOsm: string;
  nearestOsm: string;
  output: string;
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
  if (encoded == null) throw new Error("Resolution input contains a non-JSON value");
  return encoded;
}

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function parseFiniteNumber(value: string, label: string): number {
  if (value.trim().length === 0) throw new Error(`${label} is missing`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a finite number`);
  return parsed;
}

function parseCsvRecords(bytes: Buffer, label: string): Array<Record<string, string>> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const matrix = parseStrictCsv(text);
  if (matrix.length < 2) throw new Error(`${label} has no data rows`);
  const headers = matrix[0].map((header) => header.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => header.length === 0)) {
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
  const catalog = new Map<string, CatalogRow>();
  for (const [index, record] of parseCsvRecords(bytes, "Catalog CSV").entries()) {
    const id = record.id?.trim();
    const name = record.name?.trim();
    if (!id || !name || catalog.has(id)) {
      throw new Error(`Catalog CSV row ${index + 2} repeats or omits its identity`);
    }
    let externalIds: unknown;
    try {
      externalIds = JSON.parse(record.external_ids);
    } catch {
      throw new Error(`Catalog destination ${id} has malformed external IDs`);
    }
    if (externalIds == null || typeof externalIds !== "object" || Array.isArray(externalIds) ||
        Object.entries(externalIds).some(([key, value]) =>
          key.trim().length === 0 || typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(`Catalog destination ${id} has invalid external IDs`);
    }
    const osmNodeId = record.osm_id.trim() || null;
    const normalizedExternalIds = sortedRecord(externalIds as Record<string, string>);
    if ((normalizedExternalIds.osm ?? null) !== osmNodeId) {
      throw new Error(`Catalog destination ${id} has a mismatched OSM identity`);
    }
    catalog.set(id, {
      id,
      name,
      elevationM: parseFiniteNumber(record.elevation_m, `Catalog destination ${id} elevation`),
      lat: parseFiniteNumber(record.lat, `Catalog destination ${id} latitude`),
      lng: parseFiniteNumber(record.lng, `Catalog destination ${id} longitude`),
      osmNodeId,
      externalIds: normalizedExternalIds,
      countryCode: record.country_code.trim() || null,
      stateCode: record.state_code.trim() || null,
    });
  }
  if (catalog.size !== 2_505) {
    throw new Error(`Catalog CSV has ${catalog.size} rows; expected 2505`);
  }
  return catalog;
}

function parseRawDobihRows(bytes: Buffer): Map<number, RawDobihRow> {
  const rows = new Map<number, RawDobihRow>();
  for (const [index, record] of parseCsvRecords(bytes, "DoBIH CSV").entries()) {
    const rawNumber = record.Number.trim();
    if (!/^[1-9][0-9]*$/.test(rawNumber)) {
      throw new Error(`DoBIH CSV row ${index + 2} has an invalid Number`);
    }
    const number = Number(rawNumber);
    if (rows.has(number)) throw new Error(`DoBIH CSV repeats Number ${number}`);
    rows.set(number, {
      number,
      name: record.Name.trim(),
      observations: record.Observations.trim(),
      comments: record.Comments.trim(),
      lat: parseFiniteNumber(record.Latitude, `DoBIH Number ${number} latitude`),
      lng: parseFiniteNumber(record.Longitude, `DoBIH Number ${number} longitude`),
      country: record.Country.trim(),
      county: record.County.trim(),
    });
  }
  return rows;
}

function assertDruimFadaOsmEvidence(bytes: Buffer, label: string): void {
  const parsed = JSON.parse(bytes.toString("utf8")) as {
    elements?: Array<{
      type?: unknown;
      id?: unknown;
      lat?: unknown;
      lon?: unknown;
      tags?: Record<string, unknown>;
    }>;
  };
  if (!Array.isArray(parsed.elements)) throw new Error(`${label} has no OSM elements`);
  const matches = parsed.elements.filter((element) => element.id === 2_712_667_650);
  const node = matches[0];
  if (matches.length !== 1 || node.type !== "node" ||
      node.lat !== 56.8910069 || node.lon !== -5.1433208 ||
      node.tags?.name !== "Stob a' Ghrianain" || node.tags?.["name:en"] !== "Druim Fada") {
    throw new Error(`${label} changed the reviewed Druim Fada OSM identity`);
  }
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

function destinationFingerprint(row: KeeperResolutionRow): Omit<
  KeeperDestinationFingerprint,
  "externalIds"
> {
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

function catalogDestinationFingerprint(row: CatalogRow): Omit<
  KeeperDestinationFingerprint,
  "externalIds"
> {
  const { externalIds: _externalIds, ...fingerprint } = catalogFingerprint(row);
  return fingerprint;
}

function sourceNumber(sourceMemberId: string): number {
  const match = /^dobih:([1-9][0-9]*)$/.exec(sourceMemberId);
  if (match == null) throw new Error(`Invalid DoBIH source member ID ${sourceMemberId}`);
  return Number(match[1]);
}

function dobihUrl(sourceMemberIdOrNumber: string | number): string {
  const number = typeof sourceMemberIdOrNumber === "number"
    ? sourceMemberIdOrNumber
    : sourceNumber(sourceMemberIdOrNumber);
  return `https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${number}`;
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

function countryCodeForSource(sourceMemberId: string, rawRows: Map<number, RawDobihRow>): string {
  const raw = rawRows.get(sourceNumber(sourceMemberId));
  if (raw == null) throw new Error(`Raw DoBIH row ${sourceMemberId} is missing`);
  if (raw.country === "I") {
    return NORTHERN_IRELAND_DISTRICTS.some((district) => raw.county.includes(district))
      ? "GB"
      : "IE";
  }
  if (raw.country !== "E" && raw.country !== "S" && raw.country !== "W" &&
      raw.country !== "ES") {
    throw new Error(`Raw DoBIH row ${sourceMemberId} has unknown Country ${raw.country}`);
  }
  return "GB";
}

function assertIrishCountryMapping(
  requiredSourceIds: Set<string>,
  members: Map<string, KeeperSourceMember>,
  owners: Map<string, string[]>,
  rawRows: Map<number, RawDobihRow>,
  catalog: Map<string, CatalogRow>,
  analysis: UnresolvedAnalysis
): void {
  const northernIrishSourceIds = [...members.keys()].filter((sourceMemberId) => {
    const raw = rawRows.get(sourceNumber(sourceMemberId));
    return raw?.country === "I" &&
      NORTHERN_IRELAND_DISTRICTS.some((district) => raw.county.includes(district));
  });
  const meenaard = rawRows.get(20_200);
  if (northernIrishSourceIds.length !== 23 ||
      !northernIrishSourceIds.includes("dobih:20200") ||
      meenaard?.country !== "I" ||
      meenaard.county !== "Causeway Coast and Glens, Derry City and Strabane" ||
      countryCodeForSource("dobih:20200", rawRows) !== "GB") {
    throw new Error("Reviewed Northern Ireland country mapping changed");
  }

  const cuilcaghSourceId = "dobih:20137";
  const cuilcagh = members.get(cuilcaghSourceId);
  const cuilcaghRaw = rawRows.get(20_137);
  const cuilcaghCatalog = catalog.get("E1B5FA84B5B6986A16FF");
  if (cuilcagh == null || cuilcagh.lat == null || cuilcagh.lng == null ||
      cuilcagh.name !== "Cuilcagh" || cuilcagh.elevationM !== 666 ||
      canonicalJson(owners.get(cuilcaghSourceId)) !== canonicalJson([
        "dobih-vandeleur-lynams",
        "dobih-irish-2000-foot-register",
      ]) ||
      cuilcaghRaw?.country !== "I" ||
      cuilcaghRaw.county !== "Fermanagh and Omagh, Cavan" ||
      countryCodeForSource(cuilcaghSourceId, rawRows) !== "GB" ||
      requiredSourceIds.has(cuilcaghSourceId) || analysis[cuilcaghSourceId] != null ||
      cuilcaghCatalog == null || cuilcaghCatalog.name !== "Cuilcagh" ||
      cuilcaghCatalog.elevationM !== 666 || cuilcaghCatalog.countryCode !== "GB" ||
      cuilcaghCatalog.stateCode !== null || cuilcaghCatalog.osmNodeId !== "3133612029" ||
      Math.round(haversineMeters(
        { lat: cuilcagh.lat, lng: cuilcagh.lng },
        cuilcaghCatalog
      )) !== 26) {
    throw new Error("Reviewed automatic Cuilcagh GB identity changed");
  }
}

function candidateIndex(fixture: KeeperImportFixture): {
  members: Map<string, KeeperSourceMember>;
  owners: Map<string, string[]>;
} {
  const members = new Map<string, KeeperSourceMember>();
  const owners = new Map<string, string[]>();
  for (const sourceKey of SOURCE_KEYS) {
    const sourceList = fixture.lists[sourceKey];
    if (sourceList == null) throw new Error(`Candidate fixture is missing ${sourceKey}`);
    for (const member of sourceList.rows) {
      const { ordinal: _ordinal, ...identity } = member;
      const previous = members.get(member.sourceMemberId);
      if (previous != null) {
        const { ordinal: _previousOrdinal, ...previousIdentity } = previous;
        if (canonicalJson(identity) !== canonicalJson(previousIdentity)) {
          throw new Error(`Candidate ${member.sourceMemberId} changes between lists`);
        }
      } else {
        members.set(member.sourceMemberId, member);
      }
      const sourceOwners = owners.get(member.sourceMemberId) ?? [];
      sourceOwners.push(sourceKey);
      owners.set(member.sourceMemberId, sourceOwners);
    }
  }
  return { members, owners };
}

function assertAnalysis(
  analysis: UnresolvedAnalysis,
  members: Map<string, KeeperSourceMember>,
  owners: Map<string, string[]>
): void {
  if (Object.keys(analysis).length !== 681) {
    throw new Error(`Unresolved analysis has ${Object.keys(analysis).length} identities; expected 681`);
  }
  let membershipCount = 0;
  for (const [sourceMemberId, entry] of Object.entries(analysis)) {
    const member = members.get(sourceMemberId);
    if (member == null || member.lat == null || member.lng == null) {
      throw new Error(`Unresolved analysis has unknown candidate ${sourceMemberId}`);
    }
    const expectedOwners = owners.get(sourceMemberId) ?? [];
    if (entry.number !== sourceNumber(sourceMemberId) || entry.name !== member.name ||
        entry.elevation !== member.elevationM || entry.lat !== member.lat ||
        entry.lng !== member.lng ||
        canonicalJson(entry.aliases) !== canonicalJson(member.aliases ?? []) ||
        canonicalJson(entry.owners) !== canonicalJson(expectedOwners)) {
      throw new Error(`Unresolved analysis changed candidate ${sourceMemberId}`);
    }
    membershipCount += entry.owners.length;
  }
  if (membershipCount !== 825) {
    throw new Error(`Unresolved analysis has ${membershipCount} memberships; expected 825`);
  }
  if (analysis["dobih:2540"] != null) {
    throw new Error("Reviewed DoBIH 2540 unexpectedly appears in the unresolved analysis");
  }
}

function baseResolutionIndex(
  base: KeeperResolutionFixture,
  requiredSourceIds: Set<string>,
  catalog: Map<string, CatalogRow>
): Map<string, KeeperResolutionRow> {
  const indexed = new Map<string, KeeperResolutionRow>();
  for (const resolutionList of Object.values(base.lists)) {
    for (const row of resolutionList.rows) {
      if (!requiredSourceIds.has(row.sourceMemberId)) continue;
      const previous = indexed.get(row.sourceMemberId);
      const projection = { ...row, sourceKey: "projection" };
      if (previous != null && canonicalJson({ ...previous, sourceKey: "projection" }) !==
          canonicalJson(projection)) {
        throw new Error(`Base review changes resolution for ${row.sourceMemberId}`);
      }
      const catalogRow = catalog.get(row.destinationId);
      if (row.resolution === "existing_destination") {
        if (catalogRow == null || canonicalJson(destinationFingerprint(row)) !==
            canonicalJson(catalogDestinationFingerprint(catalogRow))) {
          throw new Error(`Base existing destination ${row.sourceMemberId} changed in the catalog`);
        }
      } else if (row.resolution === "catalog_repair") {
        // The reviewed High Street repair starts from a legacy row with no
        // country code, so the GB/IE catalog snapshot intentionally omits it.
        // Its exact before fingerprint remains pinned by the checked base file.
        if ((catalogRow != null && canonicalJson(row.catalogBefore) !==
              canonicalJson(catalogFingerprint(catalogRow))) ||
            (catalogRow == null && row.sourceMemberId !== "dobih:2528")) {
          throw new Error(`Base catalog repair ${row.sourceMemberId} has a stale before fingerprint`);
        }
      }
      indexed.set(row.sourceMemberId, row);
    }
  }
  if (indexed.size !== 45) {
    throw new Error(`Base review supplies ${indexed.size} open-eight identities; expected 45`);
  }
  return indexed;
}

function existingResolution(
  sourceMemberId: string,
  member: KeeperSourceMember,
  destination: CatalogRow
): KeeperResolutionRow {
  if (member.lat == null || member.lng == null) {
    throw new Error(`Candidate ${sourceMemberId} has no coordinates`);
  }
  const distanceM = Math.round(haversineMeters(
    { lat: member.lat, lng: member.lng },
    destination
  ));
  return {
    sourceKey: "projection",
    sourceMemberId,
    resolution: "existing_destination",
    destinationId: destination.id,
    destinationName: destination.name,
    destinationElevationM: destination.elevationM,
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    destinationOsmNodeId: destination.osmNodeId,
    destinationCountryCode: destination.countryCode ?? "",
    destinationStateCode: destination.stateCode,
    evidence: [
      `Reviewed as the same summit: the catalog ${destination.name} point is ${distanceM} m from DoBIH ${sourceNumber(sourceMemberId)} ${member.name}.`,
      `Reviewed source: ${dobihUrl(sourceMemberId)}`,
      ...(destination.osmNodeId == null
        ? []
        : [`Reviewed source: https://www.openstreetmap.org/node/${destination.osmNodeId}`]),
    ],
  };
}

function directCatalogRepair(
  sourceMemberId: string,
  member: KeeperSourceMember,
  destination: CatalogRow,
  rawRows: Map<number, RawDobihRow>
): KeeperResolutionRow {
  if (member.lat == null || member.lng == null) {
    throw new Error(`Candidate ${sourceMemberId} has no coordinates`);
  }
  return {
    sourceKey: "projection",
    sourceMemberId,
    resolution: "catalog_repair",
    destinationId: destination.id,
    destinationName: member.name,
    destinationElevationM: member.elevationM,
    destinationLat: member.lat,
    destinationLng: member.lng,
    destinationOsmNodeId: destination.osmNodeId,
    destinationCountryCode: countryCodeForSource(sourceMemberId, rawRows),
    destinationStateCode: null,
    destinationDataSourceName: DOBIH_SOURCE_NAME,
    destinationDataSourceUrl: dobihUrl(sourceMemberId),
    destinationDataLicense: DOBIH_SOURCE_LICENSE,
    catalogBefore: catalogFingerprint(destination),
    evidence: [
      DIRECT_REPAIR_EVIDENCE[sourceMemberId],
      `Reviewed source: ${dobihUrl(sourceMemberId)}`,
      ...(destination.osmNodeId == null
        ? []
        : [`Reviewed source: https://www.openstreetmap.org/node/${destination.osmNodeId}`]),
    ],
  };
}

function auxiliaryAfterExistingResolution(
  sourceMemberId: string,
  member: KeeperSourceMember,
  repair: KeeperAuxiliaryCatalogRepair
): KeeperResolutionRow {
  if (member.lat == null || member.lng == null || repair.after.countryCode == null) {
    throw new Error(`Auxiliary-after candidate ${sourceMemberId} has an incomplete fingerprint`);
  }
  const distanceM = Math.round(haversineMeters(
    { lat: member.lat, lng: member.lng },
    repair.after
  ));
  return {
    sourceKey: "projection",
    sourceMemberId,
    resolution: "existing_destination",
    destinationId: repair.destinationId,
    destinationName: repair.after.name,
    destinationElevationM: repair.after.elevationM,
    destinationLat: repair.after.lat,
    destinationLng: repair.after.lng,
    destinationOsmNodeId: repair.after.osmNodeId,
    destinationCountryCode: repair.after.countryCode,
    destinationStateCode: repair.after.stateCode,
    evidence: [
      `The auxiliary repair ${repair.repairId} renames the catalog point before list matching; ` +
      `pin its exact after identity ${distanceM} m from DoBIH ${sourceNumber(sourceMemberId)}.`,
      ...repair.evidence,
    ],
  };
}

function curatedResolution(
  sourceMemberId: string,
  member: KeeperSourceMember,
  rawRows: Map<number, RawDobihRow>,
  analysis: UnresolvedAnalysis,
  catalog: Map<string, CatalogRow>
): KeeperResolutionRow {
  if (member.lat == null || member.lng == null) {
    throw new Error(`Candidate ${sourceMemberId} has no coordinates`);
  }
  const sourceId = sourceNumber(sourceMemberId);
  const evidence: string[] = [];
  if (REVIEWED_DISTINCT_SOURCE_IDS.has(sourceMemberId)) {
    const nearest = analysis[sourceMemberId]?.nearby[0];
    if (nearest == null || !catalog.has(nearest[0])) {
      throw new Error(`Reviewed distinct candidate ${sourceMemberId} has no catalog neighbor`);
    }
    evidence.push(
      `Reviewed as a separate summit from catalog destination ${nearest[0]}:${nearest[1]} ` +
      `(${nearest[2]} m from the DoBIH point).`
    );
  } else if (REVIEWED_SECONDARY_SPLITS[sourceMemberId] != null) {
    const split = REVIEWED_SECONDARY_SPLITS[sourceMemberId];
    const catalogRow = catalog.get(split.destinationId);
    if (catalogRow == null) throw new Error(`Secondary split catalog row ${split.destinationId} is missing`);
    evidence.push(
      `Reviewed as the main summit; catalog destination ${catalogRow.id}:${catalogRow.name} is ` +
      `the separate ${split.secondaryName} supported by DoBIH ${split.supportNumber}.`
    );
  } else {
    evidence.push(
      `DoBIH v18.5 lists this summit at ${member.elevationM} m and ${member.lat}, ` +
      `${member.lng}; no reviewed catalog identity mapping exists.`
    );
  }
  evidence.push(`Reviewed source: ${dobihUrl(sourceId)}`);
  const split = REVIEWED_SECONDARY_SPLITS[sourceMemberId];
  if (split != null) evidence.push(`Reviewed source: ${dobihUrl(split.supportNumber)}`);
  return {
    sourceKey: "projection",
    sourceMemberId,
    resolution: "curated_destination",
    destinationId: deterministicKeeperDestinationId(sourceMemberId),
    destinationName: CURATED_NAME_OVERRIDES[sourceMemberId] ?? member.name,
    destinationElevationM: member.elevationM,
    destinationLat: member.lat,
    destinationLng: member.lng,
    destinationOsmNodeId: null,
    destinationCountryCode: countryCodeForSource(sourceMemberId, rawRows),
    destinationStateCode: null,
    destinationDataSourceName: DOBIH_SOURCE_NAME,
    destinationDataSourceUrl: dobihUrl(sourceMemberId),
    destinationDataLicense: DOBIH_SOURCE_LICENSE,
    evidence,
  };
}

function newAuxiliaryRepairs(
  catalog: Map<string, CatalogRow>,
  rawRows: Map<number, RawDobihRow>
): KeeperAuxiliaryCatalogRepair[] {
  return Object.entries(REVIEWED_SECONDARY_SPLITS).map(([mainSourceId, split]) => {
    const destination = catalog.get(split.destinationId);
    const support = rawRows.get(split.supportNumber);
    if (destination == null || support == null) {
      throw new Error(`Secondary split inputs are missing for ${mainSourceId}`);
    }
    const distanceM = Math.round(haversineMeters(support, destination));
    if (distanceM !== split.expectedDistanceM) {
      throw new Error(
        `Secondary split ${mainSourceId} is ${distanceM} m from its catalog point; ` +
        `expected ${split.expectedDistanceM} m`
      );
    }
    const before = catalogFingerprint(destination);
    const removeWikidata = mainSourceId === "dobih:1693";
    if (removeWikidata && before.externalIds?.wikidata !== "Q86753760") {
      throw new Error("Meikle Millyea trig-point Wikidata identity changed");
    }
    if (removeWikidata && support.comments !==
        "Donald relocated to hill 1693. See Database Notes") {
      throw new Error("Meikle Millyea relocation evidence changed");
    }
    const afterExternalIds = { ...(before.externalIds ?? {}) };
    if (removeWikidata) delete afterExternalIds.wikidata;
    return {
      repairId: `${mainSourceId}-secondary-name`,
      destinationId: destination.id,
      before,
      after: {
        ...before,
        name: split.secondaryName,
        externalIds: sortedRecord(afterExternalIds),
      },
      dataSourceName: DOBIH_SOURCE_NAME,
      dataSourceUrl: dobihUrl(split.supportNumber),
      dataLicense: DOBIH_SOURCE_LICENSE,
      ...(removeWikidata ? {
        externalIdRemovals: { wikidata: "Q86753760" },
      } : {}),
      evidence: [
        `DoBIH ${split.supportNumber} places ${support.name} ${distanceM} m from the catalog ` +
        `point, so the reviewed open-list main summit ${mainSourceId} remains separate.`,
        ...(mainSourceId === "dobih:1693" ? [
          "DoBIH 1694 says the Donald moved to DoBIH 1693; remove the broad main-summit " +
          "Wikidata identity from the old trig-point record.",
        ] : []),
        `Reviewed source: ${dobihUrl(split.supportNumber)}`,
        `Reviewed source: https://www.openstreetmap.org/node/${destination.osmNodeId}`,
      ],
    };
  });
}

function addDistinctNeighborGuards(
  rowsBySourceId: Map<string, KeeperResolutionRow>,
  analysis: UnresolvedAnalysis,
  catalog: Map<string, CatalogRow>
): void {
  const curated = [...rowsBySourceId.values()].filter(
    (row) => row.resolution === "curated_destination"
  );
  for (const row of curated) {
    const guards = new Set(row.distinctFromDestinationIds ?? []);
    for (const destination of catalog.values()) {
      if (haversineMeters(
        { lat: row.destinationLat, lng: row.destinationLng },
        destination
      ) <= 150) {
        guards.add(destination.id);
      }
    }
    for (const other of curated) {
      if (other.destinationId !== row.destinationId && haversineMeters(
        { lat: row.destinationLat, lng: row.destinationLng },
        { lat: other.destinationLat, lng: other.destinationLng }
      ) <= 150) {
        guards.add(other.destinationId);
      }
    }
    if (REVIEWED_DISTINCT_SOURCE_IDS.has(row.sourceMemberId)) {
      const nearestId = analysis[row.sourceMemberId]?.nearby[0]?.[0];
      if (!nearestId) throw new Error(`Reviewed distinct guard is missing for ${row.sourceMemberId}`);
      guards.add(nearestId);
    }
    const split = REVIEWED_SECONDARY_SPLITS[row.sourceMemberId];
    if (split != null) guards.add(split.destinationId);
    if (guards.size > 0) row.distinctFromDestinationIds = [...guards].sort();
  }

  const expectedPairs = canonicalJson([
    ["dobih:1005", "dobih:1006"],
    ["dobih:1253", "dobih:1260"],
  ]);
  const sourceEntries = Object.entries(analysis);
  const closePairs: string[][] = [];
  for (let leftIndex = 0; leftIndex < sourceEntries.length; leftIndex += 1) {
    const [leftId, left] = sourceEntries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sourceEntries.length; rightIndex += 1) {
      const [rightId, right] = sourceEntries[rightIndex];
      if (haversineMeters(left, right) <= 150) {
        closePairs.push([leftId, rightId].sort());
      }
    }
  }
  closePairs.sort(([leftA, leftB], [rightA, rightB]) =>
    leftA.localeCompare(rightA) || leftB.localeCompare(rightB)
  );
  if (canonicalJson(closePairs) !== expectedPairs) {
    throw new Error(`DoBIH candidate pairs within 150 m changed: ${canonicalJson(closePairs)}`);
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

function assertNoDestinationConflicts(rowsBySourceId: Map<string, KeeperResolutionRow>): void {
  const sourceByDestination = new Map<string, string>();
  for (const row of rowsBySourceId.values()) {
    const previous = sourceByDestination.get(row.destinationId);
    if (previous != null && previous !== row.sourceMemberId) {
      throw new Error(
        `Destination ${row.destinationId} is assigned to ${previous} and ${row.sourceMemberId}`
      );
    }
    sourceByDestination.set(row.destinationId, row.sourceMemberId);
    if (Object.entries(row.catalogExternalIdAdditions ?? {}).some(([key, value]) =>
      /dobih/i.test(key) || /dobih:/i.test(value))) {
      throw new Error(`Resolution ${row.sourceMemberId} adds a forbidden DoBIH external ID`);
    }
  }
}

export function buildDobihOpenEightResolutions(inputs: BuildInputs): KeeperResolutionFixture {
  assertSha256(inputs.candidateBytes, CANDIDATE_FIXTURE_SHA256, "Candidate fixture");
  assertSha256(inputs.baseResolutionBytes, BASE_RESOLUTION_FIXTURE_SHA256, "Base resolution fixture");
  assertSha256(inputs.dobihCsvBytes, DOBIH_CSV_SHA256, "DoBIH CSV");
  assertSha256(inputs.catalogCsvBytes, CATALOG_CSV_SHA256, "Catalog CSV");
  assertSha256(inputs.analysisBytes, UNRESOLVED_ANALYSIS_SHA256, "Unresolved analysis");
  assertSha256(inputs.nearbyOsmBytes, NEARBY_OSM_SHA256, "Nearby OSM snapshot");
  assertSha256(inputs.nearestOsmBytes, NEAREST_OSM_SHA256, "Nearest OSM snapshot");
  assertDruimFadaOsmEvidence(inputs.nearbyOsmBytes, "Nearby OSM snapshot");
  assertDruimFadaOsmEvidence(inputs.nearestOsmBytes, "Nearest OSM snapshot");

  const candidateFixture = JSON.parse(inputs.candidateBytes.toString("utf8")) as KeeperImportFixture;
  const baseResolutions = JSON.parse(
    inputs.baseResolutionBytes.toString("utf8")
  ) as KeeperResolutionFixture;
  const analysis = JSON.parse(inputs.analysisBytes.toString("utf8")) as UnresolvedAnalysis;
  const catalog = parseCatalog(inputs.catalogCsvBytes);
  const rawRows = parseRawDobihRows(inputs.dobihCsvBytes);

  validateKeeperFixture(candidateFixture, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
  const { members, owners } = candidateIndex(candidateFixture);
  assertAnalysis(analysis, members, owners);

  const requiredSourceIds = new Set([
    ...Object.keys(analysis),
    "dobih:2540",
    "dobih:3713",
  ]);
  const requiredMembershipCount = [...requiredSourceIds].reduce(
    (total, sourceMemberId) => total + (owners.get(sourceMemberId)?.length ?? 0),
    0
  );
  if (requiredSourceIds.size !== 683 || requiredMembershipCount !== 827) {
    throw new Error(
      `Resolution scope is ${requiredSourceIds.size}/${requiredMembershipCount}; expected 683/827`
    );
  }
  const graystones = members.get("dobih:3713");
  if (analysis["dobih:3713"] != null ||
      canonicalJson(owners.get("dobih:3713")) !== canonicalJson(["dobih-fellrangers"]) ||
      graystones?.name !== "Graystones" || graystones.elevationM !== 455.3) {
    throw new Error("Reviewed automatic Graystones source identity changed");
  }
  assertIrishCountryMapping(requiredSourceIds, members, owners, rawRows, catalog, analysis);

  const baseBySourceId = baseResolutionIndex(baseResolutions, requiredSourceIds, catalog);
  const specialSets = [
    new Set(Object.keys(EXISTING_DESTINATION_IDS)),
    new Set(Object.keys(DIRECT_CATALOG_REPAIRS)),
    new Set(Object.keys(AUXILIARY_AFTER_EXISTING_DESTINATION_IDS)),
  ];
  if (Object.keys(EXISTING_DESTINATION_IDS).length !== 26 ||
      Object.keys(DIRECT_CATALOG_REPAIRS).length !== 4 ||
      Object.keys(AUXILIARY_AFTER_EXISTING_DESTINATION_IDS).length !== 1 ||
      REVIEWED_DISTINCT_SOURCE_IDS.size !== 10 ||
      Object.keys(REVIEWED_SECONDARY_SPLITS).length !== 4) {
    throw new Error("Reviewed resolution tables have unexpected sizes");
  }
  for (const special of specialSets) {
    for (const sourceMemberId of special) {
      if (!requiredSourceIds.has(sourceMemberId) || baseBySourceId.has(sourceMemberId)) {
        throw new Error(`Reviewed resolution table has invalid source ${sourceMemberId}`);
      }
    }
  }

  const rowsBySourceId = new Map<string, KeeperResolutionRow>();
  for (const sourceMemberId of requiredSourceIds) {
    const member = members.get(sourceMemberId);
    if (member == null) throw new Error(`Candidate ${sourceMemberId} is missing`);
    const baseResolution = baseBySourceId.get(sourceMemberId);
    if (baseResolution != null) {
      rowsBySourceId.set(sourceMemberId, { ...baseResolution, sourceKey: "projection" });
      continue;
    }
    const existingId = EXISTING_DESTINATION_IDS[sourceMemberId];
    if (existingId != null) {
      const destination = catalog.get(existingId);
      if (destination == null) throw new Error(`Existing destination ${existingId} is missing`);
      rowsBySourceId.set(
        sourceMemberId,
        existingResolution(sourceMemberId, member, destination)
      );
      continue;
    }
    const auxiliaryAfterId = AUXILIARY_AFTER_EXISTING_DESTINATION_IDS[sourceMemberId];
    if (auxiliaryAfterId != null) {
      const repair = (baseResolutions.catalogRepairs ?? []).find((candidate) =>
        candidate.destinationId === auxiliaryAfterId
      );
      if (repair == null || repair.repairId !== "dobih:2489-graystones-main" ||
          repair.before.name !== "Graystones" ||
          repair.after.name !== "Graystones (main summit)" ||
          repair.after.osmNodeId !== "29953562" ||
          canonicalJson(repair.after.externalIds) !== canonicalJson({
            osm: "29953562",
            wikidata: "Q5598437",
          })) {
        throw new Error("Reviewed Graystones auxiliary after fingerprint changed");
      }
      rowsBySourceId.set(
        sourceMemberId,
        auxiliaryAfterExistingResolution(sourceMemberId, member, repair)
      );
      continue;
    }
    const repairId = DIRECT_CATALOG_REPAIRS[sourceMemberId];
    if (repairId != null) {
      const destination = catalog.get(repairId);
      if (destination == null) throw new Error(`Catalog repair destination ${repairId} is missing`);
      rowsBySourceId.set(
        sourceMemberId,
        directCatalogRepair(sourceMemberId, member, destination, rawRows)
      );
      continue;
    }
    rowsBySourceId.set(
      sourceMemberId,
      curatedResolution(sourceMemberId, member, rawRows, analysis, catalog)
    );
  }

  addDistinctNeighborGuards(rowsBySourceId, analysis, catalog);
  assertNoDestinationConflicts(rowsBySourceId);

  for (const repair of baseResolutions.catalogRepairs ?? []) {
    const catalogRow = catalog.get(repair.destinationId);
    if (catalogRow == null || canonicalJson(repair.before) !==
        canonicalJson(catalogFingerprint(catalogRow))) {
      throw new Error(`Base auxiliary repair ${repair.repairId} has a stale before fingerprint`);
    }
  }
  const catalogRepairs = [
    ...(baseResolutions.catalogRepairs ?? []),
    ...newAuxiliaryRepairs(catalog, rawRows),
  ];
  if (catalogRepairs.length !== 11 ||
      new Set(catalogRepairs.map((repair) => repair.destinationId)).size !== 11) {
    throw new Error("Auxiliary catalog repairs are incomplete or conflict");
  }

  const lists = Object.fromEntries(SOURCE_KEYS.map((sourceKey) => [sourceKey, { rows: [] }])) as
    KeeperResolutionFixture["lists"];
  const assignedRepairs = new Set<string>();
  for (const sourceKey of SOURCE_KEYS) {
    for (const member of candidateFixture.lists[sourceKey].rows) {
      const identity = rowsBySourceId.get(member.sourceMemberId);
      if (identity == null) continue;
      let projected: KeeperResolutionRow;
      if (identity.resolution === "catalog_repair" && assignedRepairs.has(member.sourceMemberId)) {
        projected = existingProjectionOfRepair(identity, sourceKey);
      } else {
        projected = { ...identity, sourceKey };
        if (identity.resolution === "catalog_repair") assignedRepairs.add(member.sourceMemberId);
      }
      lists[sourceKey].rows.push(projected);
    }
  }

  const resolutions: KeeperResolutionFixture = {
    schemaVersion: 1,
    reviewedAt: REVIEWED_AT,
    catalogSnapshotSha256: CATALOG_CSV_SHA256,
    catalogSnapshots: {
      "dobih-open-eight-catalog-2026-08-30.csv": CATALOG_CSV_SHA256,
      "dobih-open-eight-nearby-osm-nodes.json": NEARBY_OSM_SHA256,
      "dobih-open-eight-nearest-osm-nodes.json": NEAREST_OSM_SHA256,
    },
    catalogRepairs,
    lists,
  };
  const resolutionRows = Object.values(lists).flatMap((list) => list.rows);
  if (resolutionRows.length !== 827) {
    throw new Error(`Resolution fixture has ${resolutionRows.length} rows; expected 827`);
  }
  validateKeeperResolutionFixture(
    candidateFixture,
    resolutions,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  validateKeeperCrossListConsistency(
    candidateFixture,
    resolutions,
    DOBIH_OPEN_EIGHT_KEEPER_LISTS
  );
  return resolutions;
}

function parseArgs(argv: string[]): BuildArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const args: BuildArgs = {
    candidates: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json"
    ),
    baseResolutions: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-identity-resolutions-2026-08-30.json"
    ),
    dobihCsv: "/private/tmp/dobih-v18.5/DoBIH_v18_5.csv",
    catalog: "/private/tmp/dobih-open-eight-catalog-2026-08-30.csv",
    analysis: "/private/tmp/dobih-open-eight-unresolved-catalog-analysis.json",
    nearbyOsm: "/private/tmp/dobih-open-eight-nearby-osm-nodes.json",
    nearestOsm: "/private/tmp/dobih-open-eight-nearest-osm-nodes.json",
    output: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-open-eight-identity-resolutions-2026-08-30.json"
    ),
  };
  const options: Array<[string, keyof BuildArgs]> = [
    ["--candidates=", "candidates"],
    ["--base-resolutions=", "baseResolutions"],
    ["--dobih-csv=", "dobihCsv"],
    ["--catalog=", "catalog"],
    ["--analysis=", "analysis"],
    ["--nearby-osm=", "nearbyOsm"],
    ["--nearest-osm=", "nearestOsm"],
    ["--output=", "output"],
  ];
  const seen = new Set<keyof BuildArgs>();
  for (const argument of argv) {
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
    candidateBytes,
    baseResolutionBytes,
    dobihCsvBytes,
    catalogCsvBytes,
    analysisBytes,
    nearbyOsmBytes,
    nearestOsmBytes,
  ] =
    await Promise.all([
      fs.readFile(args.candidates),
      fs.readFile(args.baseResolutions),
      fs.readFile(args.dobihCsv),
      fs.readFile(args.catalog),
      fs.readFile(args.analysis),
      fs.readFile(args.nearbyOsm),
      fs.readFile(args.nearestOsm),
    ]);
  const resolutions = buildDobihOpenEightResolutions({
    candidateBytes,
    baseResolutionBytes,
    dobihCsvBytes,
    catalogCsvBytes,
    analysisBytes,
    nearbyOsmBytes,
    nearestOsmBytes,
  });
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  const output = `${JSON.stringify(resolutions, null, 2)}\n`;
  await fs.writeFile(args.output, output, "utf8");
  const rows = Object.values(resolutions.lists).flatMap((list) => list.rows);
  const counts = Object.fromEntries(["existing_destination", "catalog_repair", "curated_destination"]
    .map((kind) => [kind, rows.filter((row) => row.resolution === kind).length]));
  console.log(`Wrote ${args.output}`);
  console.log(`SHA-256 ${sha256(output)}`);
  console.log(`Rows ${rows.length}: ${JSON.stringify(counts)}`);
  console.log(`Auxiliary catalog repairs ${resolutions.catalogRepairs?.length ?? 0}; conflicts 0`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
