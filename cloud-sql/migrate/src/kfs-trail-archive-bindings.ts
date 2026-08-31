import crypto from "node:crypto";

export const KFS_TRAIL_ARCHIVE_SHA256 =
  "e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72";
export const KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256 =
  "949672eeec5d5c44f212632fd500cc6d594fbf1316e7c317a1165f0ef78b1636";
export const KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256 =
  "b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735";
export const KFS_TRAIL_BINDINGS_SHA256 =
  "702644cd55137355625b124fb1a70260f6d30fd205a853dd88dcee169d5c0081";
export const KFS_TRAIL_VALIDATION_INPUT_SHA256 =
  "0c1599b2e55dd62532ced16f7e1046b228e769fb88c44316a37f9aef3e614288";

export type KfsTrailIdentityMatch =
  | "exact_line_name"
  | "qualified_line_name"
  | "same_package_point_name"
  | "reviewed_spelling_variant";

export type KfsTrailUnresolvedReason =
  | "identity_not_established"
  | "no_near_summit_geometry";

export interface KfsTrailArchiveLine {
  packageCode: string;
  lineNames: string[];
  pointNames: string[];
  nearestLineDistanceM: number;
}

export interface KfsTrailArchiveBinding extends KfsTrailArchiveLine {
  archiveMntnIds: string[];
  archiveMntnCodes: string[];
  identityMatch: KfsTrailIdentityMatch;
  identityEvidence: string[];
}

export interface KfsTrailArchiveBindingRow {
  ordinal: number;
  sourceMemberId: string;
  mntnId: string;
  destinationId: string;
  kfsName: string;
  summit: { lat: number; lng: number };
  status: "confirmed" | "unresolved";
  bindings: KfsTrailArchiveBinding[];
  nearestArchiveLine: KfsTrailArchiveLine;
  unresolvedReason: KfsTrailUnresolvedReason | null;
  reviewNote: string;
}

export interface KfsTrailArchiveBindings {
  schemaVersion: 1;
  reviewedAt: string;
  registryId: "kfs-100-famous-mountains";
  use: "validation_only";
  summitReachThresholdM: 250;
  inputSha256: {
    coordinateCrosswalk: string;
    sourceCrosswalk: string;
  };
  archive: {
    sourceUrl: string;
    sha256: string;
    sizeBytes: number;
    outerEntryCount: number;
    ignoredBackupEntryCount: number;
    packageCount: number;
    shapefilePackageCount: number;
    geojsonPackageCount: number;
    gpxPackageCount: number;
    sourceDataDate: string;
    coordinateSystem: string;
  };
  summary: {
    rowCount: number;
    confirmed: number;
    unresolved: number;
    bindingCount: number;
    archiveCatalogCount: number;
    portalPublishedCount: number;
    catalogCountDisagreement: number;
  };
  rows: KfsTrailArchiveBindingRow[];
}

const TOP_LEVEL_KEYS = [
  "schemaVersion", "reviewedAt", "registryId", "use",
  "summitReachThresholdM", "inputSha256", "archive", "summary", "rows",
];
const ROW_KEYS = [
  "ordinal", "sourceMemberId", "mntnId", "destinationId", "kfsName", "summit",
  "status", "bindings", "nearestArchiveLine", "unresolvedReason", "reviewNote",
];
const LINE_KEYS = ["packageCode", "lineNames", "pointNames", "nearestLineDistanceM"];
const BINDING_KEYS = [
  "packageCode", "archiveMntnIds", "archiveMntnCodes", "lineNames", "pointNames",
  "nearestLineDistanceM", "identityMatch", "identityEvidence",
];

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string
): void {
  const expected = new Set(keys);
  const extra = Object.keys(value).filter((key) => !expected.has(key));
  if (extra.length > 0) {
    throw new Error(`${label} has unexpected key ${extra[0]}`);
  }
  const missing = keys.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new Error(`${label} is missing key ${missing[0]}`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function integerValue(value: unknown, label: string): number {
  const result = numberValue(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be an integer`);
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map((item, index) => stringValue(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return result;
}

function exactValue(
  actual: unknown,
  expected: string | number,
  label: string
): void {
  if (actual !== expected) throw new Error(`${label} must equal ${expected}`);
}

function parseLine(value: unknown, label: string): KfsTrailArchiveLine {
  const raw = objectValue(value, label);
  assertExactKeys(raw, LINE_KEYS, label);
  const packageCode = stringValue(raw.packageCode, `${label}.packageCode`);
  if (!/^\d{9}$/.test(packageCode)) {
    throw new Error(`${label}.packageCode must be a nine-digit archive code`);
  }
  const lineNames = stringArray(raw.lineNames, `${label}.lineNames`);
  const pointNames = stringArray(raw.pointNames, `${label}.pointNames`);
  if (lineNames.length === 0) throw new Error(`${label}.lineNames must not be empty`);
  const nearestLineDistanceM = numberValue(
    raw.nearestLineDistanceM,
    `${label}.nearestLineDistanceM`
  );
  if (nearestLineDistanceM < 0 || nearestLineDistanceM > 1_000_000) {
    throw new Error(`${label}.nearestLineDistanceM is outside the checked range`);
  }
  return { packageCode, lineNames, pointNames, nearestLineDistanceM };
}

function parseBinding(value: unknown, label: string): KfsTrailArchiveBinding {
  const raw = objectValue(value, label);
  assertExactKeys(raw, BINDING_KEYS, label);
  const line = parseLine({
    packageCode: raw.packageCode,
    lineNames: raw.lineNames,
    pointNames: raw.pointNames,
    nearestLineDistanceM: raw.nearestLineDistanceM,
  }, label);
  const archiveMntnIds = stringArray(raw.archiveMntnIds, `${label}.archiveMntnIds`);
  const archiveMntnCodes = stringArray(raw.archiveMntnCodes, `${label}.archiveMntnCodes`);
  if (archiveMntnIds.length === 0 ||
      archiveMntnIds.some((id) => !/^\d{9,10}$/.test(id))) {
    throw new Error(`${label}.archiveMntnIds must contain checked numeric IDs`);
  }
  if (archiveMntnCodes.length !== 1 || archiveMntnCodes[0] !== line.packageCode) {
    throw new Error(`${label}.archiveMntnCodes must contain its exact package code`);
  }
  const identityMatch = stringValue(raw.identityMatch, `${label}.identityMatch`);
  const allowedIdentity = new Set<KfsTrailIdentityMatch>([
    "exact_line_name", "qualified_line_name", "same_package_point_name",
    "reviewed_spelling_variant",
  ]);
  if (!allowedIdentity.has(identityMatch as KfsTrailIdentityMatch)) {
    throw new Error(`${label}.identityMatch is not reviewed`);
  }
  const identityEvidence = stringArray(
    raw.identityEvidence,
    `${label}.identityEvidence`
  );
  if (identityEvidence.length === 0) {
    throw new Error(`${label}.identityEvidence must not be empty`);
  }
  return {
    ...line,
    archiveMntnIds,
    archiveMntnCodes,
    identityMatch: identityMatch as KfsTrailIdentityMatch,
    identityEvidence,
  };
}

function parseRow(value: unknown, index: number): KfsTrailArchiveBindingRow {
  const label = `rows[${index}]`;
  const raw = objectValue(value, label);
  assertExactKeys(raw, ROW_KEYS, label);
  const ordinal = integerValue(raw.ordinal, `${label}.ordinal`);
  if (ordinal !== index + 1) throw new Error(`${label}.ordinal is out of order`);
  const sourceMemberId = stringValue(raw.sourceMemberId, `${label}.sourceMemberId`);
  const mntnId = stringValue(raw.mntnId, `${label}.mntnId`);
  if (!/^\d{8}$/.test(mntnId) || sourceMemberId !== `kfs:${mntnId}`) {
    throw new Error(`${label} must use the exact eight-digit KFS source ID`);
  }
  const destinationId = stringValue(raw.destinationId, `${label}.destinationId`);
  if (!/^[A-Za-z0-9]{20}$/.test(destinationId)) {
    throw new Error(`${label}.destinationId must be a 20-character catalog ID`);
  }
  const kfsName = stringValue(raw.kfsName, `${label}.kfsName`);
  const summitRaw = objectValue(raw.summit, `${label}.summit`);
  assertExactKeys(summitRaw, ["lat", "lng"], `${label}.summit`);
  const lat = numberValue(summitRaw.lat, `${label}.summit.lat`);
  const lng = numberValue(summitRaw.lng, `${label}.summit.lng`);
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    throw new Error(`${label}.summit must be inside the checked South Korea bounds`);
  }
  const status = stringValue(raw.status, `${label}.status`);
  if (status !== "confirmed" && status !== "unresolved") {
    throw new Error(`${label}.status must be confirmed or unresolved`);
  }
  if (!Array.isArray(raw.bindings)) throw new Error(`${label}.bindings must be an array`);
  const bindings = raw.bindings.map((binding, bindingIndex) =>
    parseBinding(binding, `${label}.bindings[${bindingIndex}]`));
  const nearestArchiveLine = parseLine(raw.nearestArchiveLine, `${label}.nearestArchiveLine`);
  const reviewNote = stringValue(raw.reviewNote, `${label}.reviewNote`);
  if (reviewNote.length < 20) throw new Error(`${label}.reviewNote is too short`);

  let unresolvedReason: KfsTrailUnresolvedReason | null = null;
  if (raw.unresolvedReason != null) {
    const reason = stringValue(raw.unresolvedReason, `${label}.unresolvedReason`);
    if (reason !== "identity_not_established" && reason !== "no_near_summit_geometry") {
      throw new Error(`${label}.unresolvedReason is not supported`);
    }
    unresolvedReason = reason;
  }
  if (status === "confirmed") {
    if (bindings.length === 0) {
      throw new Error(`${label}: confirmed row must have at least one binding`);
    }
    if (unresolvedReason != null) {
      throw new Error(`${label}: confirmed row must not have an unresolved reason`);
    }
    if (bindings.some((binding) => binding.nearestLineDistanceM > 250)) {
      throw new Error(`${label}: binding exceeds the summit reach threshold`);
    }
  } else {
    if (bindings.length !== 0) {
      throw new Error(`${label}: unresolved row must not have bindings`);
    }
    if (unresolvedReason == null) {
      throw new Error(`${label}: unresolved row must state a reason`);
    }
    if (unresolvedReason === "identity_not_established" &&
        nearestArchiveLine.nearestLineDistanceM > 250) {
      throw new Error(`${label}: identity failure must name near geometry`);
    }
  }
  return {
    ordinal,
    sourceMemberId,
    mntnId,
    destinationId,
    kfsName,
    summit: { lat, lng },
    status,
    bindings,
    nearestArchiveLine,
    unresolvedReason,
    reviewNote,
  };
}

export function parseKfsTrailArchiveBindings(
  bytes: Buffer | string
): KfsTrailArchiveBindings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString());
  } catch (error) {
    throw new Error(`KFS trail bindings are not valid JSON: ${String(error)}`);
  }
  const raw = objectValue(parsed, "KFS trail bindings");
  assertExactKeys(raw, TOP_LEVEL_KEYS, "KFS trail bindings");
  exactValue(raw.schemaVersion, 1, "schemaVersion");
  exactValue(raw.reviewedAt, "2026-08-31", "reviewedAt");
  exactValue(raw.registryId, "kfs-100-famous-mountains", "registryId");
  exactValue(raw.use, "validation_only", "use");
  exactValue(raw.summitReachThresholdM, 250, "summitReachThresholdM");

  const input = objectValue(raw.inputSha256, "inputSha256");
  assertExactKeys(input, ["coordinateCrosswalk", "sourceCrosswalk"], "inputSha256");
  if (input.coordinateCrosswalk !== KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256) {
    throw new Error("coordinate crosswalk checksum does not match the checked input");
  }
  if (input.sourceCrosswalk !== KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256) {
    throw new Error("source crosswalk checksum does not match the checked input");
  }

  const archive = objectValue(raw.archive, "archive");
  const archiveExpected = {
    sourceUrl:
      "https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?" +
      "dataType=/mount/mountain.zip",
    sha256: KFS_TRAIL_ARCHIVE_SHA256,
    sizeBytes: 265_601_808,
    outerEntryCount: 8_802,
    ignoredBackupEntryCount: 5,
    packageCount: 2_932,
    shapefilePackageCount: 2_932,
    geojsonPackageCount: 2_932,
    gpxPackageCount: 2_932,
    sourceDataDate: "2016-12-31",
    coordinateSystem: "WGS84 GPX",
  };
  assertExactKeys(archive, Object.keys(archiveExpected), "archive");
  for (const [key, expected] of Object.entries(archiveExpected)) {
    exactValue(archive[key], expected, `archive.${key}`);
  }

  const summary = objectValue(raw.summary, "summary");
  const summaryExpected = {
    rowCount: 100,
    confirmed: 83,
    unresolved: 17,
    bindingCount: 90,
    archiveCatalogCount: 2_932,
    portalPublishedCount: 2_919,
    catalogCountDisagreement: 13,
  };
  assertExactKeys(summary, Object.keys(summaryExpected), "summary");
  for (const [key, expected] of Object.entries(summaryExpected)) {
    exactValue(summary[key], expected, `summary.${key}`);
  }

  if (!Array.isArray(raw.rows) || raw.rows.length !== 100) {
    throw new Error("rows must contain all 100 reviewed KFS members");
  }
  const rows = raw.rows.map(parseRow);
  const uniqueFields: Array<[string, string[]]> = [
    ["sourceMemberId", rows.map((row) => row.sourceMemberId)],
    ["mntnId", rows.map((row) => row.mntnId)],
    ["destinationId", rows.map((row) => row.destinationId)],
    ["packageCode", rows.flatMap((row) =>
      row.bindings.map((binding) => binding.packageCode))],
  ];
  for (const [label, values] of uniqueFields) {
    if (new Set(values).size !== values.length) {
      throw new Error(`${label} must be unique across the checked artifact`);
    }
  }
  const confirmed = rows.filter((row) => row.status === "confirmed").length;
  const unresolved = rows.length - confirmed;
  const bindingCount = rows.reduce((count, row) => count + row.bindings.length, 0);
  if (confirmed !== 83 || unresolved !== 17 || bindingCount !== 90) {
    throw new Error("derived status counts do not match the checked summary");
  }

  return {
    schemaVersion: 1,
    reviewedAt: "2026-08-31",
    registryId: "kfs-100-famous-mountains",
    use: "validation_only",
    summitReachThresholdM: 250,
    inputSha256: {
      coordinateCrosswalk: KFS_TRAIL_BINDINGS_COORDINATE_CROSSWALK_SHA256,
      sourceCrosswalk: KFS_TRAIL_BINDINGS_SOURCE_CROSSWALK_SHA256,
    },
    archive: archiveExpected,
    summary: summaryExpected,
    rows,
  };
}

export function kfsTrailBindingsSha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
