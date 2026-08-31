import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

import proj4 from "proj4";
import * as unzipper from "unzipper";

export const KFS_TRAIL_SOURCE_ID = "south-korea-kfs-hiking-trails-archive";
export const KFS_TRAIL_ARCHIVE_BYTES = 265_601_808;
export const KFS_TRAIL_ARCHIVE_SHA256 =
  "e017b599947b4a14493771ed810d0c0221d5e9ab7e9dd5c5b1fc24a69ede0c72";
export const KFS_TRAIL_ARCHIVE_PACKAGE_COUNT = 2_932;
export const KFS_TRAIL_LINE_FEATURE_COUNT = 57_070;
export const KFS_TRAIL_MAIN_POINT_COUNT = 101_257;
export const KFS_TRAIL_SAFETY_POINT_COUNT = 5_876;
export const KFS_TRAIL_ARCHIVE_DOWNLOAD_URL =
  "https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/mount/mountain.zip";
export const KFS_TRAIL_ARCHIVE_CATALOG_URL =
  "https://www.data.go.kr/data/3034022/fileData.do";

const KFS_WGS84_LINE_PACKAGE_ID = "491106604";
const PACKAGE_ID_PATTERN = /^\d{9}$/;
const DESTINATION_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ENTRY_PATH_BYTES = 512;
const MAX_NESTED_ENTRY_COUNT = 7;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const EPSG_5186_DEFINITION =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 " +
  "+ellps=GRS80 +units=m +no_defs +type=crs";
const KOREA_BOUNDS = Object.freeze({
  minLng: 124,
  maxLng: 132,
  minLat: 32,
  maxLat: 40,
});

export const KFS_TRAIL_ARCHIVE_LEGACY_ENTRIES = Object.freeze([
  "mountain/421500604.zip_bak",
  "mountain/421504602.zip_bak",
  "mountain/448102101.zip_20190822",
  "mountain/448102101_geojson.zip_20190822",
  "mountain/448102101_gpx.zip_20190822",
]);

const LINE_FIELDS = Object.freeze([
  ["FID", "esriFieldTypeOID"],
  ["PMNTN_SN", "esriFieldTypeDouble"],
  ["MNTN_CODE", "esriFieldTypeString"],
  ["MNTN_NM", "esriFieldTypeString"],
  ["PMNTN_NM", "esriFieldTypeString"],
  ["PMNTN_MAIN", "esriFieldTypeString"],
  ["PMNTN_LT", "esriFieldTypeSingle"],
  ["PMNTN_DFFL", "esriFieldTypeString"],
  ["PMNTN_UPPL", "esriFieldTypeDouble"],
  ["PMNTN_GODN", "esriFieldTypeDouble"],
  ["PMNTN_MTRQ", "esriFieldTypeString"],
  ["PMNTN_CNRL", "esriFieldTypeString"],
  ["PMNTN_CLS_", "esriFieldTypeString"],
  ["PMNTN_RISK", "esriFieldTypeString"],
  ["PMNTN_RECO", "esriFieldTypeString"],
  ["DATA_STDR_", "esriFieldTypeString"],
  ["MNTN_ID", "esriFieldTypeString"],
] as const);

const MAIN_POINT_FIELDS = Object.freeze([
  ["FID", "esriFieldTypeOID"],
  ["PMNTN_SPOT", "esriFieldTypeDouble"],
  ["MNTN_CODE", "esriFieldTypeString"],
  ["MANAGE_SP1", "esriFieldTypeString"],
  ["MANAGE_SP2", "esriFieldTypeString"],
  ["DETAIL_SPO", "esriFieldTypeString"],
  ["ETC_MATTER", "esriFieldTypeString"],
  ["MNTN_NM", "esriFieldTypeString"],
  ["PAST_SPOT_", "esriFieldTypeString"],
  ["MNTN_ID", "esriFieldTypeString"],
] as const);

const SAFETY_POINT_FIELDS = Object.freeze([
  ["FID", "esriFieldTypeOID"],
  ["SAFE_SPOT1", "esriFieldTypeDouble"],
  ["SAFE_SPOT2", "esriFieldTypeString"],
  ["SAFE_SPOT3", "esriFieldTypeString"],
  ["MGC", "esriFieldTypeString"],
  ["ETC_MATTER", "esriFieldTypeString"],
  ["MNTN_NM", "esriFieldTypeString"],
] as const);

const INTEGER_LINE_SCHEMA_PACKAGES = new Set([
  "421500604",
  "421503701",
  "421507504",
  "437500301",
  "448102101",
  "482201101",
  "482401401",
  "482401501",
  "482401701",
]);

const INTEGER_POINT_SCHEMA_PACKAGES = new Set([
  "421500604",
  "421503701",
  "421507504",
  "422300401",
  "422303301",
  "427207304",
  "427601501",
  "428302001",
  "437500301",
  "448102101",
  "482201101",
  "482401401",
  "482401701",
  "487201501",
  "487204101",
  "487204201",
  "487204901",
  "487205101",
  "487205701",
  "487205801",
  "487205901",
  "487206001",
  "491300304",
]);

const LINE_SCHEMA_WITHOUT_MOUNTAIN_ID_PACKAGES = new Set([
  "437501801",
  "438003301",
  "461505601",
  "467103001",
]);

type ExpectedField = readonly [name: string, type: string];
type Coordinate = readonly [lng: number, lat: number];

export type KfsArchiveIdentity = {
  size: number;
  sha256: string;
};

export type KfsTrailLine = {
  id: string;
  packageId: string;
  trailSerialNumber: number;
  sourceCrs: "EPSG:5186" | "EPSG:4326";
  mountainName: string | null;
  trailName: string | null;
  sourceMountainId: string | null;
  dataStandardDate: string | null;
  paths: readonly (readonly Coordinate[])[];
};

export type KfsTrailheadCandidate = {
  id: string;
  packageId: string;
  sourceFids: readonly number[];
  sourceSpotNumber: number;
  pastSpotIds: readonly string[];
  manageCode: "01";
  manageName: "시종점";
  mountainName: string | null;
  location: Coordinate;
};

export type KfsTrailPackageAudit = {
  packageId: string;
  lineDocumentCrs: "EPSG:5186" | "EPSG:4326";
  pointDocumentCrs: "EPSG:5186";
  sourceLineCount: number;
  sourcePointCount: number;
  safetyPointCount: number;
  lines: readonly KfsTrailLine[];
  trailheadCandidates: readonly KfsTrailheadCandidate[];
};

export type KfsTrailArchiveManifest = {
  packageCount: number;
  shapefilePackageCount: number;
  geojsonPackageCount: number;
  gpxPackageCount: number;
  legacyEntries: readonly string[];
};

export type KfsTrailArchiveReport = {
  sourceId: typeof KFS_TRAIL_SOURCE_ID;
  manifest: KfsTrailArchiveManifest;
  selectedPackageIds: readonly string[];
  packages: readonly KfsTrailPackageAudit[];
  currentAccessSatisfied: false;
  publicationEligible: false;
};

export type KfsTrailBinding = {
  destinationId: string;
  packageId: string;
};

export type KfsTrailBindings = {
  schemaVersion: 1;
  sourceId: typeof KFS_TRAIL_SOURCE_ID;
  archiveSha256: typeof KFS_TRAIL_ARCHIVE_SHA256;
  bindings: readonly KfsTrailBinding[];
};

export type ParseKfsTrailArchiveOptions = {
  expectedPackageCount?: number;
  selectedPackageIds: readonly string[];
  expectedLegacyEntries?: readonly string[];
  expectedOuterEntryPathKeys?: readonly string[];
  expectedArchiveIdentity?: KfsArchiveIdentity;
};

type EsriField = {
  name: string;
  type: string;
  alias: string;
  length?: number;
};

type EsriDocument = {
  displayFieldName: string;
  fieldAliases: Record<string, unknown>;
  geometryType: string;
  spatialReference: Record<string, unknown>;
  fields: EsriField[];
  features: unknown[];
};

type PackageParts = {
  raw: boolean;
  geojson: boolean;
  gpx: boolean;
};

type ParsedLineDocument = {
  crs: "EPSG:5186" | "EPSG:4326";
  lines: KfsTrailLine[];
};

type ParsedPointDocument = {
  crs: "EPSG:5186";
  sourcePointCount: number;
  trailheadCandidates: KfsTrailheadCandidate[];
};

type ZipEntry = unzipper.Entry &
  AsyncIterable<Buffer | Uint8Array> & {
    props: unzipper.Entry["props"] & { pathBuffer?: Buffer };
  };
type ZipParser = unzipper.ParseStream & AsyncIterable<unzipper.Entry>;

function streamingZipParser(source: Readable): {
  parser: ZipParser;
  sourceDone: Promise<void>;
  detach: () => void;
} {
  const parser = unzipper.Parse({ forceStream: true }) as ZipParser;
  const forwardSourceError = (error: Error) => parser.destroy(error);
  source.once("error", forwardSourceError);
  const sourceDone = finished(source);
  source.pipe(parser);
  return {
    parser,
    sourceDone,
    detach: () => source.off("error", forwardSourceError),
  };
}

async function abortStreamingZip(
  source: Readable,
  parser: ZipParser,
  sourceDone: Promise<void>
): Promise<void> {
  parser.destroy();
  source.destroy();
  await sourceDone.catch(() => undefined);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label}.${key} is required`);
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
}

function trimmedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (/\u0000/.test(value)) throw new Error(`${label} must not contain NUL`);
  return value.trim();
}

function nullableSourceText(value: unknown, label: string): string | null {
  if (typeof value !== "string" || /\u0000/.test(value)) {
    throw new Error(`${label} must be a string without NUL`);
  }
  return value.trim() || null;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function packageId(value: unknown, label: string): string {
  const parsed = trimmedText(value, label);
  if (!PACKAGE_ID_PATTERN.test(parsed)) {
    throw new Error(`${label} must be exactly nine digits`);
  }
  return parsed;
}

function sha256(value: unknown, label: string): string {
  const parsed = trimmedText(value, label);
  if (!SHA256_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return parsed;
}

function assertSafeZipPath(
  pathBytes: Buffer,
  displayPath: string,
  label: string
): void {
  const segments = pathBytes.toString("latin1").split("/");
  if (
    pathBytes.length === 0 ||
    pathBytes.length > MAX_ENTRY_PATH_BYTES ||
    [...pathBytes].some((byte) => byte === 0 || byte < 0x20 || byte === 0x7f) ||
    pathBytes.includes(0x5c) ||
    pathBytes[0] === 0x2f ||
    (pathBytes.length >= 2 &&
      ((pathBytes[0] >= 0x41 && pathBytes[0] <= 0x5a) ||
        (pathBytes[0] >= 0x61 && pathBytes[0] <= 0x7a)) &&
      pathBytes[1] === 0x3a) ||
    segments.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`${label} has an unsafe ZIP entry path: ${displayPath}`);
  }
}

function localEntryPathBytes(entry: unzipper.Entry): Buffer {
  const pathBuffer = (entry as ZipEntry).props?.pathBuffer;
  return Buffer.isBuffer(pathBuffer) ? pathBuffer : Buffer.from(entry.path, "utf8");
}

function zipPathKey(pathBytes: Buffer): string {
  return pathBytes.toString("hex");
}

function assertSafeZipEntry(entry: unzipper.Entry, label: string): string {
  const entryPath = entry.path;
  assertSafeZipPath(localEntryPathBytes(entry), entryPath, label);
  if ((entry.vars.flags & 1) !== 0) {
    throw new Error(`${label} must not contain encrypted ZIP entries`);
  }
  if (![0, 8].includes(entry.vars.compressionMethod)) {
    throw new Error(`${label} uses an unsupported ZIP compression method`);
  }
  return entryPath;
}

export function assertKfsZipEntryMode(
  versionMadeBy: number,
  externalFileAttributes: number,
  pathBytes: Buffer,
  label: string
): void {
  if (
    !Number.isSafeInteger(versionMadeBy) ||
    versionMadeBy < 0 ||
    !Number.isSafeInteger(externalFileAttributes) ||
    externalFileAttributes < 0 ||
    externalFileAttributes > 0xffff_ffff
  ) {
    throw new Error(`${label} has invalid ZIP mode metadata`);
  }
  const hostSystem = (versionMadeBy >>> 8) & 0xff;
  if (hostSystem !== 3) return;
  const mode = (externalFileAttributes >>> 16) & 0xffff;
  const fileType = mode & 0o170000;
  if (fileType === 0o120000) {
    throw new Error(`${label} must not be a Unix symbolic link`);
  }
  if (fileType !== 0o100000 && fileType !== 0o040000) {
    throw new Error(`${label} has an unsupported Unix file type`);
  }
  const pathIsDirectory = pathBytes[pathBytes.length - 1] === 0x2f;
  if ((fileType === 0o040000) !== pathIsDirectory) {
    throw new Error(`${label} Unix mode does not match its ZIP path type`);
  }
}

export function assertKfsZipCentralDirectory(
  files: readonly unzipper.File[]
): readonly string[] {
  const pathKeys = new Set<string>();
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const label = `KFS central-directory entry ${index + 1}`;
    if (!Buffer.isBuffer(file.pathBuffer)) {
      throw new Error(`${label} has no raw ZIP path`);
    }
    assertSafeZipPath(file.pathBuffer, file.path, label);
    const pathKey = zipPathKey(file.pathBuffer);
    if (pathKeys.has(pathKey)) {
      throw new Error(`${label} repeats raw path ${file.path}`);
    }
    pathKeys.add(pathKey);
    if ((file.flags & 1) !== 0) {
      throw new Error(`${label} must not be encrypted`);
    }
    if (![0, 8].includes(file.compressionMethod)) {
      throw new Error(`${label} uses an unsupported ZIP compression method`);
    }
    assertKfsZipEntryMode(
      file.versionMadeBy,
      file.externalFileAttributes,
      file.pathBuffer,
      label
    );
  }
  return Object.freeze([...pathKeys].sort());
}

async function drainEntry(entry: unzipper.Entry): Promise<void> {
  await entry.autodrain().promise();
}

async function readEntry(
  entry: ZipEntry,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of entry) {
    const chunk = Buffer.from(rawChunk);
    total += chunk.length;
    if (total > maxBytes) {
      entry.destroy();
      throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function parseJsonDocument(bytes: Buffer, label: string): EsriDocument {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid UTF-8 JSON: ${message}`);
  }
  const input = objectValue(value, label);
  exactKeys(
    input,
    [
      "displayFieldName",
      "fieldAliases",
      "geometryType",
      "spatialReference",
      "fields",
      "features",
    ],
    [],
    label
  );
  if (typeof input.displayFieldName !== "string") {
    throw new Error(`${label}.displayFieldName must be a string`);
  }
  const fieldAliases = objectValue(input.fieldAliases, `${label}.fieldAliases`);
  const spatialReference = objectValue(
    input.spatialReference,
    `${label}.spatialReference`
  );
  if (!Array.isArray(input.fields) || !Array.isArray(input.features)) {
    throw new Error(`${label}.fields and .features must be arrays`);
  }
  const fields = input.fields.map((rawField, index) => {
    const fieldLabel = `${label}.fields[${index}]`;
    const field = objectValue(rawField, fieldLabel);
    exactKeys(field, ["name", "type", "alias"], ["length"], fieldLabel);
    const parsed: EsriField = {
      name: trimmedText(field.name, `${fieldLabel}.name`),
      type: trimmedText(field.type, `${fieldLabel}.type`),
      alias: trimmedText(field.alias, `${fieldLabel}.alias`),
    };
    if (field.length !== undefined) {
      parsed.length = safeInteger(field.length, `${fieldLabel}.length`, 1);
    }
    return parsed;
  });
  const fieldNames = fields.map(({ name }) => name);
  if (new Set(fieldNames).size !== fieldNames.length) {
    throw new Error(`${label} has duplicate field names`);
  }
  const aliasNames = Object.keys(fieldAliases);
  if (
    aliasNames.length !== fieldNames.length ||
    aliasNames.some((name, index) => name !== fieldNames[index]) ||
    fieldNames.some((name) => fieldAliases[name] !== name)
  ) {
    throw new Error(`${label}.fieldAliases must exactly mirror fields`);
  }
  return {
    displayFieldName: input.displayFieldName,
    fieldAliases,
    geometryType: trimmedText(input.geometryType, `${label}.geometryType`),
    spatialReference,
    fields,
    features: input.features,
  };
}

function fieldSignature(fields: readonly EsriField[]): string {
  return fields.map(({ name, type }) => `${name}:${type}`).join("|");
}

function expectedFieldSignature(fields: readonly ExpectedField[]): string {
  return fields.map(([name, type]) => `${name}:${type}`).join("|");
}

function integerLineFields(): ExpectedField[] {
  return LINE_FIELDS.map(([name, type]) => [
    name,
    ["PMNTN_SN", "PMNTN_UPPL", "PMNTN_GODN"].includes(name)
      ? "esriFieldTypeInteger"
      : type,
  ]);
}

function integerPointFields(): ExpectedField[] {
  return MAIN_POINT_FIELDS.map(([name, type]) => [
    name,
    name === "PMNTN_SPOT" ? "esriFieldTypeInteger" : type,
  ]);
}

function assertLineFieldSchema(
  fields: readonly EsriField[],
  packageCode: string,
  label: string
): void {
  const signature = fieldSignature(fields);
  const full = expectedFieldSignature(LINE_FIELDS);
  const integer = expectedFieldSignature(integerLineFields());
  const withoutMountainId = expectedFieldSignature(
    LINE_FIELDS.filter(([name]) => name !== "MNTN_ID")
  );
  if (signature === full) return;
  if (signature === integer && INTEGER_LINE_SCHEMA_PACKAGES.has(packageCode)) return;
  if (
    signature === withoutMountainId &&
    LINE_SCHEMA_WITHOUT_MOUNTAIN_ID_PACKAGES.has(packageCode)
  ) return;
  throw new Error(`${label} has an unsupported KFS line field schema for ${packageCode}`);
}

function assertMainPointFieldSchema(
  fields: readonly EsriField[],
  packageCode: string,
  label: string
): void {
  const signature = fieldSignature(fields);
  if (signature === expectedFieldSignature(MAIN_POINT_FIELDS)) return;
  if (
    signature === expectedFieldSignature(integerPointFields()) &&
    INTEGER_POINT_SCHEMA_PACKAGES.has(packageCode)
  ) return;
  throw new Error(`${label} has an unsupported KFS main-point field schema for ${packageCode}`);
}

function wktParameter(wkt: string, name: string, label: string): number {
  const match = new RegExp(
    `PARAMETER\\s*\\[\\s*["']${name}["']\\s*,\\s*([-+0-9.eE]+)\\s*\\]`,
    "i"
  ).exec(wkt);
  if (!match) throw new Error(`${label} is missing ${name}`);
  return finiteNumber(Number(match[1]), `${label}.${name}`);
}

function nearlyEqual(left: number, right: number, tolerance = 1e-10): boolean {
  return Math.abs(left - right) <= tolerance;
}

function assertEpsg5186Wkt(value: unknown, label: string): string {
  const wkt = trimmedText(value, label);
  if (!/PROJECTION\s*\[\s*["']Transverse_Mercator["']/i.test(wkt)) {
    throw new Error(`${label} must use Transverse_Mercator`);
  }
  const spheroid =
    /SPHEROID\s*\[\s*["']GRS_1980["']\s*,\s*6378137(?:\.0+)?\s*,\s*298\.257222101/i;
  if (!spheroid.test(wkt)) throw new Error(`${label} must use the GRS 1980 spheroid`);
  const parameters: Array<[string, number]> = [
    ["False_Easting", 200_000],
    ["False_Northing", 600_000],
    ["Central_Meridian", 127],
    ["Scale_Factor", 1],
    ["Latitude_Of_Origin", 38],
  ];
  for (const [name, expected] of parameters) {
    if (!nearlyEqual(wktParameter(wkt, name, label), expected)) {
      throw new Error(`${label}.${name} does not match EPSG:5186`);
    }
  }
  const foundParameterNames = [...wkt.matchAll(
    /PARAMETER\s*\[\s*["']([^"']+)["']\s*,/gi
  )].map((match) => match[1].toLowerCase());
  const allowedParameterNames = new Set([
    "false_easting",
    "false_northing",
    "central_meridian",
    "scale_factor",
    "latitude_of_origin",
    "standard_parallel_1",
    "standard_parallel_2",
  ]);
  if (
    foundParameterNames.length < 5 ||
    new Set(foundParameterNames).size !== foundParameterNames.length ||
    foundParameterNames.some((name) => !allowedParameterNames.has(name))
  ) {
    throw new Error(`${label} has unreviewed EPSG:5186 parameters`);
  }
  for (const optionalName of ["standard_parallel_1", "standard_parallel_2"]) {
    if (
      foundParameterNames.includes(optionalName) &&
      !nearlyEqual(wktParameter(wkt, optionalName, label), 0)
    ) {
      throw new Error(`${label}.${optionalName} does not match EPSG:5186`);
    }
  }
  if (!/UNIT\s*\[\s*["']Meter["']\s*,\s*1(?:\.0+)?\s*\]\s*\]$/i.test(wkt)) {
    throw new Error(`${label} must use metre projected units`);
  }
  return wkt;
}

function sourceCrs(
  spatialReference: Record<string, unknown>,
  packageCode: string,
  documentKind: "line" | "point",
  label: string
): "EPSG:5186" | "EPSG:4326" {
  const keys = Object.keys(spatialReference).sort();
  if (keys.length === 1 && keys[0] === "wkt") {
    assertEpsg5186Wkt(spatialReference.wkt, `${label}.wkt`);
    return "EPSG:5186";
  }
  if (
    keys.length === 2 &&
    keys[0] === "latestWkid" &&
    keys[1] === "wkid" &&
    spatialReference.wkid === 4326 &&
    spatialReference.latestWkid === 4326
  ) {
    if (documentKind !== "line" || packageCode !== KFS_WGS84_LINE_PACKAGE_ID) {
      throw new Error(
        `KFS WGS84 is allowed only for the ${KFS_WGS84_LINE_PACKAGE_ID} line document`
      );
    }
    return "EPSG:4326";
  }
  throw new Error(`${label} must be EPSG:5186 or the one reviewed WGS84 exception`);
}

function assertKoreaCoordinate(coordinate: Coordinate, label: string): Coordinate {
  const [lng, lat] = coordinate;
  if (
    lng < KOREA_BOUNDS.minLng ||
    lng > KOREA_BOUNDS.maxLng ||
    lat < KOREA_BOUNDS.minLat ||
    lat > KOREA_BOUNDS.maxLat
  ) {
    throw new Error(`${label} transforms outside South Korea`);
  }
  return Object.freeze([lng, lat]);
}

function transformCoordinate(
  raw: unknown,
  crs: "EPSG:5186" | "EPSG:4326",
  label: string
): Coordinate {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new Error(`${label} must contain exactly x and y`);
  }
  const source: [number, number] = [
    finiteNumber(raw[0], `${label}[0]`),
    finiteNumber(raw[1], `${label}[1]`),
  ];
  const transformed =
    crs === "EPSG:4326"
      ? source
      : (proj4(EPSG_5186_DEFINITION, "EPSG:4326", source) as [number, number]);
  return assertKoreaCoordinate(
    [
      Number(transformed[0].toFixed(8)),
      Number(transformed[1].toFixed(8)),
    ],
    label
  );
}

function assertFeatureAttributes(
  value: unknown,
  fields: readonly EsriField[],
  label: string
): Record<string, unknown> {
  const attributes = objectValue(value, label);
  const actual = Object.keys(attributes);
  const expected = fields.map(({ name }) => name);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must exactly match the declared field schema`);
  }
  for (const field of fields) {
    const fieldLabel = `${label}.${field.name}`;
    const fieldValue = attributes[field.name];
    switch (field.type) {
      case "esriFieldTypeOID":
        safeInteger(fieldValue, fieldLabel);
        break;
      case "esriFieldTypeInteger":
        if (!Number.isSafeInteger(fieldValue)) {
          throw new Error(`${fieldLabel} must be a safe integer`);
        }
        break;
      case "esriFieldTypeDouble":
      case "esriFieldTypeSingle":
        finiteNumber(fieldValue, fieldLabel);
        break;
      case "esriFieldTypeString":
        if (typeof fieldValue !== "string" || fieldValue.includes("\u0000")) {
          throw new Error(`${fieldLabel} must be a string without NUL`);
        }
        break;
      default:
        throw new Error(`${fieldLabel} uses an unsupported Esri field type`);
    }
  }
  return attributes;
}

function sourceMountainId(value: unknown, label: string): string | null {
  const parsed = nullableSourceText(value, label);
  if (parsed !== null && !/^\d{8,10}$/.test(parsed)) {
    throw new Error(`${label} must be blank or contain eight to ten digits`);
  }
  return parsed;
}

function assertOuterMountainCode(
  value: unknown,
  outerPackageId: string,
  label: string
): void {
  const parsed = packageId(value, label);
  if (parsed !== outerPackageId) {
    throw new Error(`${label} must match the outer package ${outerPackageId}`);
  }
}

function parseLineDocument(
  document: EsriDocument,
  outerPackageId: string,
  label: string
): ParsedLineDocument {
  if (document.geometryType !== "esriGeometryPolyline") {
    throw new Error(`${label} must be an Esri polyline document`);
  }
  assertLineFieldSchema(document.fields, outerPackageId, label);
  if (document.features.length === 0) {
    throw new Error(`${label} must contain at least one line feature`);
  }
  const crs = sourceCrs(document.spatialReference, outerPackageId, "line", label);
  const serials = new Set<number>();
  const fids = new Set<number>();
  const lines = document.features.map((rawFeature, index): KfsTrailLine => {
    const featureLabel = `${label}.features[${index}]`;
    const feature = objectValue(rawFeature, featureLabel);
    exactKeys(feature, ["attributes", "geometry"], [], featureLabel);
    const attributes = assertFeatureAttributes(
      feature.attributes,
      document.fields,
      `${featureLabel}.attributes`
    );
    assertOuterMountainCode(
      attributes.MNTN_CODE,
      outerPackageId,
      `${featureLabel}.attributes.MNTN_CODE`
    );
    const fid = safeInteger(attributes.FID, `${featureLabel}.attributes.FID`);
    if (fids.has(fid)) throw new Error(`${label} has duplicate FID ${fid}`);
    fids.add(fid);
    const serial = safeInteger(
      attributes.PMNTN_SN,
      `${featureLabel}.attributes.PMNTN_SN`,
      1
    );
    if (serials.has(serial)) {
      throw new Error(`${label} has duplicate PMNTN_SN ${serial}`);
    }
    serials.add(serial);
    const geometry = objectValue(feature.geometry, `${featureLabel}.geometry`);
    exactKeys(geometry, ["paths"], [], `${featureLabel}.geometry`);
    if (!Array.isArray(geometry.paths) || geometry.paths.length === 0) {
      throw new Error(`${featureLabel}.geometry.paths must not be empty`);
    }
    const paths = geometry.paths.map((rawPath, pathIndex) => {
      if (!Array.isArray(rawPath) || rawPath.length < 2) {
        throw new Error(`${featureLabel}.geometry.paths[${pathIndex}] needs two points`);
      }
      return Object.freeze(
        rawPath.map((coordinate, coordinateIndex) =>
          transformCoordinate(
            coordinate,
            crs,
            `${featureLabel}.geometry.paths[${pathIndex}][${coordinateIndex}]`
          )
        )
      );
    });
    return Object.freeze({
      id: `kfs:${outerPackageId}:line:${serial}`,
      packageId: outerPackageId,
      trailSerialNumber: serial,
      sourceCrs: crs,
      mountainName: nullableSourceText(
        attributes.MNTN_NM,
        `${featureLabel}.attributes.MNTN_NM`
      ),
      trailName: nullableSourceText(
        attributes.PMNTN_NM,
        `${featureLabel}.attributes.PMNTN_NM`
      ),
      sourceMountainId:
        attributes.MNTN_ID === undefined
          ? null
          : sourceMountainId(
              attributes.MNTN_ID,
              `${featureLabel}.attributes.MNTN_ID`
            ),
      dataStandardDate: nullableSourceText(
        attributes.DATA_STDR_,
        `${featureLabel}.attributes.DATA_STDR_`
      ),
      paths: Object.freeze(paths),
    });
  });
  return { crs, lines };
}

function canonicalCandidateIdentity(
  outerPackageId: string,
  attributes: Record<string, unknown>,
  location: Coordinate
): { canonical: string; digest: string } {
  const normalizedAttributes = Object.fromEntries(
    Object.keys(attributes)
      .filter((key) => key !== "FID" && key !== "PAST_SPOT_")
      .sort()
      .map((key) => {
        const value = attributes[key];
        return [
          key,
          typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
        ];
      })
  );
  const canonical = JSON.stringify({
    packageId: outerPackageId,
    attributes: normalizedAttributes,
    location,
  });
  return {
    canonical,
    digest: createHash("sha256").update(canonical).digest("hex").slice(0, 24),
  };
}

function parseMainPointDocument(
  document: EsriDocument,
  outerPackageId: string,
  label: string
): ParsedPointDocument {
  if (document.geometryType !== "esriGeometryPoint") {
    throw new Error(`${label} must be an Esri point document`);
  }
  assertMainPointFieldSchema(document.fields, outerPackageId, label);
  const crs = sourceCrs(document.spatialReference, outerPackageId, "point", label);
  if (crs !== "EPSG:5186") {
    throw new Error(`${label} main points must use EPSG:5186`);
  }
  const fids = new Set<number>();
  const candidates = new Map<string, KfsTrailheadCandidate>();
  const candidateIdentities = new Map<string, string>();
  for (let index = 0; index < document.features.length; index++) {
    const featureLabel = `${label}.features[${index}]`;
    const feature = objectValue(document.features[index], featureLabel);
    exactKeys(feature, ["attributes", "geometry"], [], featureLabel);
    const attributes = assertFeatureAttributes(
      feature.attributes,
      document.fields,
      `${featureLabel}.attributes`
    );
    assertOuterMountainCode(
      attributes.MNTN_CODE,
      outerPackageId,
      `${featureLabel}.attributes.MNTN_CODE`
    );
    const fid = safeInteger(attributes.FID, `${featureLabel}.attributes.FID`);
    if (fids.has(fid)) throw new Error(`${label} has duplicate FID ${fid}`);
    fids.add(fid);
    const spot = safeInteger(
      attributes.PMNTN_SPOT,
      `${featureLabel}.attributes.PMNTN_SPOT`,
      1
    );
    const manageCode = nullableSourceText(
      attributes.MANAGE_SP1,
      `${featureLabel}.attributes.MANAGE_SP1`
    );
    const manageName = nullableSourceText(
      attributes.MANAGE_SP2,
      `${featureLabel}.attributes.MANAGE_SP2`
    );
    sourceMountainId(attributes.MNTN_ID, `${featureLabel}.attributes.MNTN_ID`);
    const pastSpotId = nullableSourceText(
      attributes.PAST_SPOT_,
      `${featureLabel}.attributes.PAST_SPOT_`
    );
    if (pastSpotId !== null && !/^\d{12,14}$/.test(pastSpotId)) {
      throw new Error(`${featureLabel}.attributes.PAST_SPOT_ has an invalid ID`);
    }
    const geometry = objectValue(feature.geometry, `${featureLabel}.geometry`);
    exactKeys(geometry, ["x", "y"], [], `${featureLabel}.geometry`);
    const location = transformCoordinate(
      [geometry.x, geometry.y],
      crs,
      `${featureLabel}.geometry`
    );
    if (manageCode !== "01" || manageName !== "시종점") continue;
    const { canonical, digest } = canonicalCandidateIdentity(
      outerPackageId,
      attributes,
      location
    );
    const candidate: KfsTrailheadCandidate = Object.freeze({
      id: `kfs:${outerPackageId}:trailhead:${digest}`,
      packageId: outerPackageId,
      sourceFids: Object.freeze([fid]),
      sourceSpotNumber: spot,
      pastSpotIds: Object.freeze(pastSpotId === null ? [] : [pastSpotId]),
      manageCode: "01",
      manageName: "시종점",
      mountainName: nullableSourceText(
        attributes.MNTN_NM,
        `${featureLabel}.attributes.MNTN_NM`
      ),
      location,
    });
    const prior = candidates.get(candidate.id);
    if (prior && candidateIdentities.get(candidate.id) !== canonical) {
      throw new Error(`${label} has a trailhead candidate hash collision`);
    }
    candidateIdentities.set(candidate.id, canonical);
    candidates.set(
      candidate.id,
      prior
        ? Object.freeze({
            ...prior,
            sourceFids: Object.freeze(
              [...new Set([...prior.sourceFids, fid])].sort((left, right) => left - right)
            ),
            pastSpotIds: Object.freeze(
              [...new Set([
                ...prior.pastSpotIds,
                ...(pastSpotId === null ? [] : [pastSpotId]),
              ])].sort()
            ),
          })
        : candidate
    );
  }
  return {
    crs,
    sourcePointCount: document.features.length,
    trailheadCandidates: [...candidates.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function classifyPointDocument(document: EsriDocument): "main" | "safety" {
  const names = new Set(document.fields.map(({ name }) => name));
  return names.has("MANAGE_SP1") && names.has("PAST_SPOT_") ? "main" : "safety";
}

function validateSafetyPointDocument(
  document: EsriDocument,
  outerPackageId: string,
  label: string
): number {
  if (document.geometryType !== "esriGeometryPoint") {
    throw new Error(`${label} safety data must use Esri point geometry`);
  }
  if (fieldSignature(document.fields) !== expectedFieldSignature(SAFETY_POINT_FIELDS)) {
    throw new Error(`${label} has an unsupported KFS safety-point field schema`);
  }
  const crs = sourceCrs(document.spatialReference, outerPackageId, "point", label);
  if (crs !== "EPSG:5186") throw new Error(`${label} safety points must use EPSG:5186`);
  if (document.features.length === 0) throw new Error(`${label} has no safety points`);
  const fids = new Set<number>();
  for (let index = 0; index < document.features.length; index++) {
    const featureLabel = `${label}.features[${index}]`;
    const feature = objectValue(document.features[index], featureLabel);
    exactKeys(feature, ["attributes", "geometry"], [], featureLabel);
    const attributes = assertFeatureAttributes(
      feature.attributes,
      document.fields,
      `${featureLabel}.attributes`
    );
    const fid = safeInteger(attributes.FID, `${featureLabel}.attributes.FID`);
    if (fids.has(fid)) throw new Error(`${label} has duplicate FID ${fid}`);
    fids.add(fid);
    safeInteger(attributes.SAFE_SPOT1, `${featureLabel}.attributes.SAFE_SPOT1`, 1);
    for (const field of ["SAFE_SPOT2", "SAFE_SPOT3", "MGC", "ETC_MATTER", "MNTN_NM"]) {
      nullableSourceText(attributes[field], `${featureLabel}.attributes.${field}`);
    }
    const geometry = objectValue(feature.geometry, `${featureLabel}.geometry`);
    exactKeys(geometry, ["x", "y"], [], `${featureLabel}.geometry`);
    transformCoordinate([geometry.x, geometry.y], crs, `${featureLabel}.geometry`);
  }
  return document.features.length;
}

async function parseGeojsonPackage(
  entry: Readable,
  outerPackageId: string
): Promise<KfsTrailPackageAudit> {
  const { parser, sourceDone, detach } = streamingZipParser(entry);
  const seenPaths = new Set<string>();
  let entryCount = 0;
  let readmeCount = 0;
  let lineDocument: ParsedLineDocument | null = null;
  let pointDocument: ParsedPointDocument | null = null;
  let safetyPointCount = 0;
  let safetyDocumentCount = 0;

  try {
    for await (const rawEntry of parser) {
      const nestedEntry = rawEntry as ZipEntry;
      entryCount++;
      if (entryCount > MAX_NESTED_ENTRY_COUNT) {
        nestedEntry.destroy();
        throw new Error(`${outerPackageId} GeoJSON ZIP has too many entries`);
      }
      const label = `${outerPackageId} GeoJSON ZIP entry ${entryCount}`;
      const entryPath = assertSafeZipEntry(nestedEntry, label);
      const entryPathBytes = localEntryPathBytes(nestedEntry);
      const entryPathKey = zipPathKey(entryPathBytes);
      const entryPathShape = entryPathBytes.toString("latin1");
      if (entryPathBytes.includes(0x2f)) {
        nestedEntry.destroy();
        throw new Error(`${label} must be a top-level file`);
      }
      if (nestedEntry.type !== "File") {
        nestedEntry.destroy();
        throw new Error(`${label} must be a regular file`);
      }
      if (seenPaths.has(entryPathKey)) {
        nestedEntry.destroy();
        throw new Error(`${label} repeats raw path ${entryPath}`);
      }
      seenPaths.add(entryPathKey);
      if (/\.txt$/i.test(entryPathShape)) {
        await readEntry(nestedEntry, MAX_TEXT_BYTES, label);
        readmeCount++;
        continue;
      }
      if (!/^PMNTN[^/]*_\d{9}\.json$/i.test(entryPathShape)) {
        nestedEntry.destroy();
        throw new Error(`${label} is not an allowed KFS JSON or readme file`);
      }
      if (!entryPathShape.endsWith(`_${outerPackageId}.json`)) {
        nestedEntry.destroy();
        throw new Error(`${label} does not match the outer package ID`);
      }
      const bytes = await readEntry(nestedEntry, MAX_JSON_BYTES, label);
      const document = parseJsonDocument(bytes, label);
      if (document.geometryType === "esriGeometryPolyline") {
        if (lineDocument) throw new Error(`${outerPackageId} has two line documents`);
        lineDocument = parseLineDocument(document, outerPackageId, label);
        continue;
      }
      if (classifyPointDocument(document) === "main") {
        if (pointDocument) throw new Error(`${outerPackageId} has two main-point documents`);
        pointDocument = parseMainPointDocument(document, outerPackageId, label);
        continue;
      }
      safetyDocumentCount++;
      if (safetyDocumentCount > 4) {
        throw new Error(`${outerPackageId} has more than four safety-point documents`);
      }
      safetyPointCount += validateSafetyPointDocument(
        document,
        outerPackageId,
        label
      );
    }
    entry.resume();
    await sourceDone;

    if (!lineDocument || !pointDocument || readmeCount !== 1) {
      throw new Error(
        `${outerPackageId} GeoJSON ZIP must contain one line document, ` +
          "one main-point document, and one readme"
      );
    }
    if (entryCount !== 3 + safetyDocumentCount) {
      throw new Error(`${outerPackageId} GeoJSON ZIP has a bad entry count`);
    }
    return Object.freeze({
      packageId: outerPackageId,
      lineDocumentCrs: lineDocument.crs,
      pointDocumentCrs: pointDocument.crs,
      sourceLineCount: lineDocument.lines.length,
      sourcePointCount: pointDocument.sourcePointCount,
      safetyPointCount,
      lines: Object.freeze(lineDocument.lines),
      trailheadCandidates: Object.freeze(pointDocument.trailheadCandidates),
    });
  } catch (error) {
    await abortStreamingZip(entry, parser, sourceDone);
    throw error;
  } finally {
    detach();
  }
}

export async function parseKfsTrailGeojsonPackageStream(
  stream: Readable,
  outerPackageId: string
): Promise<KfsTrailPackageAudit> {
  return parseGeojsonPackage(
    stream,
    packageId(outerPackageId, "outerPackageId")
  );
}

function parseOuterPackageEntry(
  entryPath: string
): { packageId: string; kind: keyof PackageParts } | null {
  const match = /^mountain\/(\d{9})(?:_(geojson|gpx))?\.zip$/.exec(entryPath);
  if (!match) return null;
  return {
    packageId: match[1],
    kind: match[2] === "geojson" ? "geojson" : match[2] === "gpx" ? "gpx" : "raw",
  };
}

function validateSelectedPackageIds(values: readonly string[]): string[] {
  if (values.length === 0) throw new Error("at least one KFS package ID is required");
  const parsed = values.map((value, index) => packageId(value, `selectedPackageIds[${index}]`));
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("selected KFS package IDs must be unique");
  }
  return parsed.sort();
}

export function kfsTrailArchiveEvidence(): {
  archiveUrl: typeof KFS_TRAIL_ARCHIVE_DOWNLOAD_URL;
  catalogUrl: typeof KFS_TRAIL_ARCHIVE_CATALOG_URL;
  dataCutoff: "2016-12-31";
  currentAccessSatisfied: false;
  publicationEligible: false;
} {
  return Object.freeze({
    archiveUrl: KFS_TRAIL_ARCHIVE_DOWNLOAD_URL,
    catalogUrl: KFS_TRAIL_ARCHIVE_CATALOG_URL,
    dataCutoff: "2016-12-31" as const,
    currentAccessSatisfied: false as const,
    publicationEligible: false as const,
  });
}

export function assertKfsTrailArchiveIdentity(identity: KfsArchiveIdentity): void {
  assertArchiveIdentity(
    identity,
    { size: KFS_TRAIL_ARCHIVE_BYTES, sha256: KFS_TRAIL_ARCHIVE_SHA256 },
    "KFS trail archive"
  );
}

function assertArchiveIdentity(
  identity: KfsArchiveIdentity,
  expected: KfsArchiveIdentity,
  label: string
): void {
  if (identity.size !== expected.size) {
    throw new Error(
      `${label} byte size is ${identity.size}; expected ${expected.size}`
    );
  }
  if (identity.sha256 !== expected.sha256) {
    throw new Error(
      `${label} SHA-256 is ${identity.sha256}; expected ${expected.sha256}`
    );
  }
}

async function hashReadable(stream: Readable): Promise<KfsArchiveIdentity> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.from(rawChunk);
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

export async function inspectKfsTrailArchiveFile(
  archivePath: string
): Promise<KfsArchiveIdentity> {
  const file = await stat(archivePath);
  if (!file.isFile()) throw new Error("KFS trail archive path must name a regular file");
  if (file.size !== KFS_TRAIL_ARCHIVE_BYTES) {
    assertKfsTrailArchiveIdentity({ size: file.size, sha256: "not-computed" });
  }
  const identity = await hashReadable(createReadStream(archivePath));
  assertKfsTrailArchiveIdentity(identity);
  return identity;
}

export async function parseKfsTrailArchiveStream(
  stream: Readable,
  options: ParseKfsTrailArchiveOptions
): Promise<KfsTrailArchiveReport> {
  const expectedPackageCount =
    options.expectedPackageCount ?? KFS_TRAIL_ARCHIVE_PACKAGE_COUNT;
  if (!Number.isSafeInteger(expectedPackageCount) || expectedPackageCount <= 0) {
    throw new Error("expectedPackageCount must be a positive safe integer");
  }
  const selectedPackageIds = validateSelectedPackageIds(options.selectedPackageIds);
  const selected = new Set(selectedPackageIds);
  const expectedLegacyEntries = [
    ...(options.expectedLegacyEntries ?? KFS_TRAIL_ARCHIVE_LEGACY_ENTRIES),
  ].sort();
  const allowedLegacy = new Set(expectedLegacyEntries);
  const seenPaths = new Set<string>();
  const legacyEntries: string[] = [];
  const packages = new Map<string, PackageParts>();
  const parsedPackages = new Map<string, KfsTrailPackageAudit>();
  let rootDirectoryCount = 0;

  const parsedHash = options.expectedArchiveIdentity ? createHash("sha256") : null;
  let parsedByteCount = 0;
  const parserSource = parsedHash
    ? Readable.from(
        (async function* () {
          for await (const rawChunk of stream) {
            const chunk = Buffer.from(rawChunk);
            parsedByteCount += chunk.length;
            parsedHash.update(chunk);
            yield chunk;
          }
        })()
      )
    : stream;
  const { parser, sourceDone, detach } = streamingZipParser(parserSource);
  try {
    for await (const rawEntry of parser) {
      const entry = rawEntry as unzipper.Entry;
      const entryPath = assertSafeZipEntry(entry, "KFS outer archive");
      const entryPathKey = zipPathKey(localEntryPathBytes(entry));
      if (seenPaths.has(entryPathKey)) {
        entry.destroy();
        throw new Error(`KFS outer archive repeats raw path ${entryPath}`);
      }
      seenPaths.add(entryPathKey);
      if (entryPath === "mountain/") {
        if (entry.type !== "Directory") {
          entry.destroy();
          throw new Error("KFS outer archive mountain/ entry must be a directory");
        }
        rootDirectoryCount++;
        await drainEntry(entry);
        continue;
      }
      if (entry.type !== "File") {
        entry.destroy();
        throw new Error(`KFS outer archive entry ${entryPath} must be a regular file`);
      }
      const packageEntry = parseOuterPackageEntry(entryPath);
      if (!packageEntry) {
        if (!allowedLegacy.has(entryPath)) {
          entry.destroy();
          throw new Error(`KFS outer archive entry ${entryPath} is not allowed`);
        }
        legacyEntries.push(entryPath);
        await drainEntry(entry);
        continue;
      }
      const parts = packages.get(packageEntry.packageId) ?? {
        raw: false,
        geojson: false,
        gpx: false,
      };
      if (parts[packageEntry.kind]) {
        entry.destroy();
        throw new Error(
          `KFS package ${packageEntry.packageId} repeats its ${packageEntry.kind} ZIP`
        );
      }
      parts[packageEntry.kind] = true;
      packages.set(packageEntry.packageId, parts);
      if (packageEntry.kind === "geojson" && selected.has(packageEntry.packageId)) {
        parsedPackages.set(
          packageEntry.packageId,
          await parseGeojsonPackage(entry, packageEntry.packageId)
        );
      } else {
        await drainEntry(entry);
      }
    }
    // unzipper finishes at the central directory and may leave the source
    // paused before EOF. Drain the exact remaining bytes so late read errors
    // propagate and the identity check covers the whole archive.
    parserSource.resume();
    await sourceDone;
    if (parsedHash && options.expectedArchiveIdentity) {
      assertArchiveIdentity(
        { size: parsedByteCount, sha256: parsedHash.digest("hex") },
        options.expectedArchiveIdentity,
        "parsed KFS trail archive"
      );
    }

    if (rootDirectoryCount !== 1) {
      throw new Error("KFS outer archive must contain exactly one mountain/ directory");
    }
    if (options.expectedOuterEntryPathKeys) {
      const expectedPathKeys = [...options.expectedOuterEntryPathKeys].sort();
      const actualPathKeys = [...seenPaths].sort();
      if (JSON.stringify(actualPathKeys) !== JSON.stringify(expectedPathKeys)) {
        throw new Error(
          "KFS outer archive central-directory paths/count do not match streamed entries"
        );
      }
    }
    if (packages.size !== expectedPackageCount) {
      throw new Error(
        `KFS outer archive has ${packages.size} package IDs; expected ${expectedPackageCount}`
      );
    }
    for (const [id, parts] of packages) {
      if (!parts.raw || !parts.geojson || !parts.gpx) {
        throw new Error(
          `KFS package ${id} must contain a complete shapefile, GeoJSON, and GPX triplet`
        );
      }
    }
    const actualLegacyEntries = legacyEntries.sort();
    if (JSON.stringify(actualLegacyEntries) !== JSON.stringify(expectedLegacyEntries)) {
      throw new Error(
        "KFS outer archive legacy entry set does not match the reviewed snapshot"
      );
    }
    for (const selectedId of selectedPackageIds) {
      if (!parsedPackages.has(selectedId)) {
        throw new Error(`selected KFS package ${selectedId} is missing from the archive`);
      }
    }
    const shapefilePackageCount = [...packages.values()].filter(({ raw }) => raw).length;
    const geojsonPackageCount = [...packages.values()].filter(
      ({ geojson }) => geojson
    ).length;
    const gpxPackageCount = [...packages.values()].filter(({ gpx }) => gpx).length;
    return Object.freeze({
      sourceId: KFS_TRAIL_SOURCE_ID,
      manifest: Object.freeze({
        packageCount: packages.size,
        shapefilePackageCount,
        geojsonPackageCount,
        gpxPackageCount,
        legacyEntries: Object.freeze(actualLegacyEntries),
      }),
      selectedPackageIds: Object.freeze(selectedPackageIds),
      packages: Object.freeze(
        selectedPackageIds.map((id) => parsedPackages.get(id) as KfsTrailPackageAudit)
      ),
      currentAccessSatisfied: false as const,
      publicationEligible: false as const,
    });
  } catch (error) {
    await abortStreamingZip(parserSource, parser, sourceDone);
    throw error;
  } finally {
    detach();
  }
}

export async function auditKfsTrailArchiveFile(
  archivePath: string,
  selectedPackageIds: readonly string[]
): Promise<KfsTrailArchiveReport & { archiveIdentity: KfsArchiveIdentity }> {
  const archiveFile = await open(archivePath, "r");
  try {
    const file = await archiveFile.stat();
    if (!file.isFile()) {
      throw new Error("KFS trail archive path must name a regular file");
    }
    if (file.size !== KFS_TRAIL_ARCHIVE_BYTES) {
      assertKfsTrailArchiveIdentity({ size: file.size, sha256: "not-computed" });
    }
    const archiveIdentity = await hashReadable(
      createReadStream(archivePath, {
        fd: archiveFile.fd,
        start: 0,
        autoClose: false,
      })
    );
    assertKfsTrailArchiveIdentity(archiveIdentity);
    const centralDirectory = await unzipper.Open.custom({
      size: async () => file.size,
      stream: (offset, length?: number) =>
        length === 0
          ? Readable.from([])
          : length === undefined
            ? createReadStream(archivePath, {
                fd: archiveFile.fd,
                start: offset,
                autoClose: false,
              })
            : createReadStream(archivePath, {
                fd: archiveFile.fd,
                start: offset,
                end: offset + length - 1,
                autoClose: false,
              }),
    });
    if (
      centralDirectory.numberOfRecords !== centralDirectory.files.length ||
      centralDirectory.numberOfRecordsOnDisk !== centralDirectory.files.length
    ) {
      throw new Error(
        "KFS outer archive central-directory record counts do not match its entries"
      );
    }
    const expectedOuterEntryPathKeys = assertKfsZipCentralDirectory(
      centralDirectory.files
    );
    const report = await parseKfsTrailArchiveStream(
      createReadStream(archivePath, {
        fd: archiveFile.fd,
        start: 0,
        autoClose: false,
      }),
      {
        selectedPackageIds,
        expectedOuterEntryPathKeys,
        expectedArchiveIdentity: {
          size: KFS_TRAIL_ARCHIVE_BYTES,
          sha256: KFS_TRAIL_ARCHIVE_SHA256,
        },
      }
    );
    return Object.freeze({
      ...report,
      archiveIdentity: Object.freeze(archiveIdentity),
    });
  } finally {
    await archiveFile.close();
  }
}

export function parseKfsTrailBindings(value: unknown): KfsTrailBindings {
  const input = objectValue(value, "KFS trail bindings");
  exactKeys(
    input,
    ["schemaVersion", "sourceId", "archiveSha256", "bindings"],
    [],
    "KFS trail bindings"
  );
  if (input.schemaVersion !== 1) {
    throw new Error("KFS trail bindings.schemaVersion must be 1");
  }
  if (input.sourceId !== KFS_TRAIL_SOURCE_ID) {
    throw new Error(`KFS trail bindings.sourceId must be ${KFS_TRAIL_SOURCE_ID}`);
  }
  if (input.archiveSha256 !== KFS_TRAIL_ARCHIVE_SHA256) {
    throw new Error(
      `KFS trail bindings.archiveSha256 must be ${KFS_TRAIL_ARCHIVE_SHA256}`
    );
  }
  if (!Array.isArray(input.bindings) || input.bindings.length === 0) {
    throw new Error("KFS trail bindings.bindings must be a non-empty array");
  }
  const bindings = input.bindings.map((rawBinding, index): KfsTrailBinding => {
    const label = `KFS trail bindings.bindings[${index}]`;
    const binding = objectValue(rawBinding, label);
    exactKeys(binding, ["destinationId", "packageId"], [], label);
    const destinationId = trimmedText(binding.destinationId, `${label}.destinationId`);
    if (!DESTINATION_ID_PATTERN.test(destinationId)) {
      throw new Error(`${label}.destinationId must be a 20-character Peaks ID`);
    }
    return Object.freeze({
      destinationId,
      packageId: packageId(binding.packageId, `${label}.packageId`),
    });
  });
  if (new Set(bindings.map(({ packageId: id }) => id)).size !== bindings.length) {
    throw new Error("KFS trail binding package IDs must be unique");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    sourceId: KFS_TRAIL_SOURCE_ID,
    archiveSha256: KFS_TRAIL_ARCHIVE_SHA256,
    bindings: Object.freeze(bindings),
  });
}

export function assertCheckedBindingsSha256(
  bytes: Buffer,
  expectedSha256: string
): void {
  const expected = sha256(expectedSha256, "expected bindings SHA-256");
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`KFS trail bindings SHA-256 is ${actual}; expected ${expected}`);
  }
}

export default {
  KFS_TRAIL_ARCHIVE_BYTES,
  KFS_TRAIL_ARCHIVE_CATALOG_URL,
  KFS_TRAIL_ARCHIVE_DOWNLOAD_URL,
  KFS_TRAIL_ARCHIVE_PACKAGE_COUNT,
  KFS_TRAIL_ARCHIVE_SHA256,
  KFS_TRAIL_SOURCE_ID,
  assertCheckedBindingsSha256,
  assertKfsTrailArchiveIdentity,
  assertKfsZipCentralDirectory,
  assertKfsZipEntryMode,
  auditKfsTrailArchiveFile,
  inspectKfsTrailArchiveFile,
  kfsTrailArchiveEvidence,
  parseKfsTrailArchiveStream,
  parseKfsTrailGeojsonPackageStream,
  parseKfsTrailBindings,
};
