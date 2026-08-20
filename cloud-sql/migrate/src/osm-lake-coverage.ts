import { createHash } from "node:crypto";

/** The OSM element kinds that can carry a named lake. */
export type OsmLakeElementType = "node" | "way" | "relation";

export interface LakePoint {
  lat: number;
  lng: number;
}

/** The small part of an Overpass element needed by this module. */
export interface OverpassElement {
  type: OsmLakeElementType;
  id: string | number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
  members?: Array<{
    type: string;
    ref?: string | number;
    role?: string;
    geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
  }>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

/** Alias retained for callers that describe the raw value as an OSM element. */
export type OsmLakeElement = OverpassElement;

export type GeoJsonPosition = [number, number];

/** Linework suitable for passing to PostGIS ST_BuildArea. */
export interface GeoJsonMultiLineString {
  type: "MultiLineString";
  coordinates: GeoJsonPosition[][];
}

export interface LakeCandidate extends LakePoint {
  osmId: string;
  osmType: OsmLakeElementType;
  name: string;
  normalizedName: string;
  tags: Record<string, string>;
  elevationM: number | null;
  linework: GeoJsonMultiLineString | null;
}

export type OsmLakeCandidate = LakeCandidate;

export const DEFAULT_LAKE_NAME_PROXIMITY_METERS = 200;

const OSM_EXTERNAL_ID_FIELDS = {
  node: "osm_node",
  way: "osm_way",
  relation: "osm_relation",
} as const;

export type OsmLakeExternalIdField = (typeof OSM_EXTERNAL_ID_FIELDS)[OsmLakeElementType];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isElementType(value: unknown): value is OsmLakeElementType {
  return value === "node" || value === "way" || value === "relation";
}

/**
 * Canonicalize an OSM ID without converting it through a JavaScript number.
 * Overpass currently returns IDs that fit in a number, but keeping this path
 * string based avoids making that an identity constraint in the importer.
 */
export function canonicalOsmId(value: unknown): string | null {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value.trim();
  } else {
    return null;
  }

  if (!/^0*[1-9][0-9]*$/.test(raw)) return null;
  try {
    return BigInt(raw).toString();
  } catch {
    return null;
  }
}

/** Return the JSONB field used for a type-specific OSM external ID. */
export function osmExternalIdField(type: OsmLakeElementType): OsmLakeExternalIdField {
  return OSM_EXTERNAL_ID_FIELDS[type];
}

/**
 * Return the type-qualified identity used for hashes and in-memory indexes.
 * A node and a way may legally have the same numeric OSM ID.
 */
export function osmIdentityKey(type: OsmLakeElementType, id: string | number): string {
  const canonicalId = canonicalOsmId(id);
  if (!canonicalId) throw new Error(`Invalid OSM ID: ${String(id)}`);
  return `${type}:${canonicalId}`;
}

/** Return the type-qualified identity key used in lake indexes. */
export function lakeIdentityKey(type: OsmLakeElementType, id: string | number): string {
  return osmIdentityKey(type, id);
}

/** Return the JSONB field used for this OSM element type. */
export function lakeExternalIdKey(type: OsmLakeElementType): OsmLakeExternalIdField {
  return osmExternalIdField(type);
}

/** Return a type-qualified key suitable for a provider-keyed lookup map. */
export function osmExternalIdKey(type: OsmLakeElementType, id: string | number): string {
  return `${lakeExternalIdKey(type)}:${canonicalOsmIdOrThrow(id)}`;
}

/** Build the type-specific external_ids JSON object for a lake destination. */
export function buildLakeExternalIds(
  type: OsmLakeElementType,
  id: string | number
): Record<string, string> {
  return { [lakeExternalIdKey(type)]: canonicalOsmIdOrThrow(id) };
}

function canonicalOsmIdOrThrow(id: string | number): string {
  const canonicalId = canonicalOsmId(id);
  if (!canonicalId) throw new Error(`Invalid OSM ID: ${String(id)}`);
  return canonicalId;
}

/**
 * Make the stable 20-character destination ID used by an OSM lake import.
 * The type is part of the digest input, so node/way/relation IDs cannot clash.
 */
export function deterministicLakeDestinationId(
  type: OsmLakeElementType,
  id: string | number
): string {
  return createHash("sha256")
    .update(`osm:${osmIdentityKey(type, id)}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

/** Normalize a name for exact identity matching, without dropping words. */
export function normalizeLakeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Parse an OSM elevation tag, which is meters unless it says feet. */
export function parseElevationMeters(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim().replace(/,/g, "");
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(m|meter|meters|ft|feet|foot)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  return unit === "ft" || unit === "feet" || unit === "foot"
    ? value / 3.28084
    : value;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const result = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(result) ? result : null;
}

function validPoint(point: LakePoint): boolean {
  return Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 && point.lat <= 90 &&
    point.lng >= -180 && point.lng <= 180;
}

function readPoint(value: unknown): LakePoint | null {
  if (Array.isArray(value) && value.length >= 2) {
    const lng = numberValue(value[0]);
    const lat = numberValue(value[1]);
    if (lat == null || lng == null) return null;
    const point = { lat, lng };
    return validPoint(point) ? point : null;
  }
  if (!isRecord(value)) return null;

  const lat = numberValue(value.lat);
  const lng = numberValue(value.lon ?? value.lng);
  if (lat == null || lng == null) return null;
  const point = { lat, lng };
  return validPoint(point) ? point : null;
}

function asStringTags(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const tags: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(value)) {
    if (typeof tagValue !== "string") return null;
    tags[key] = tagValue;
  }
  return tags;
}

function samePosition(left: GeoJsonPosition, right: GeoJsonPosition): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function parseLine(value: unknown): GeoJsonPosition[] | null {
  if (!Array.isArray(value)) return null;
  const line: GeoJsonPosition[] = [];
  for (const rawPoint of value) {
    const point = readPoint(rawPoint);
    if (!point) return null;
    const position: GeoJsonPosition = [point.lng, point.lat];
    if (line.length === 0 || !samePosition(line[line.length - 1], position)) {
      line.push(position);
    }
  }
  if (line.length < 2) return null;
  return line;
}

/**
 * Extract valid way and multipolygon relation linework. The function keeps
 * member lines separate: ST_BuildArea can then node and assemble them without
 * this parser guessing at ring direction or hole ownership.
 */
export function extractOsmLakeLinework(value: unknown): GeoJsonMultiLineString | null {
  if (!isRecord(value) || !isElementType(value.type)) return null;

  const lines: GeoJsonPosition[][] = [];
  if (value.type === "way") {
    const line = parseLine(value.geometry);
    if (line) lines.push(line);
  } else if (value.type === "relation") {
    if (Array.isArray(value.members)) {
      for (const rawMember of value.members) {
        if (!isRecord(rawMember) || rawMember.type !== "way") continue;
        const role = typeof rawMember.role === "string" ? rawMember.role : "";
        if (role !== "" && role !== "outer" && role !== "inner") continue;
        const line = parseLine(rawMember.geometry);
        if (line) lines.push(line);
      }
    }

    // Some fixtures and Overpass variants expose a direct relation geometry.
    // Use it only when member linework was not available, avoiding duplicates.
    if (lines.length === 0) {
      const line = parseLine(value.geometry);
      if (line) lines.push(line);
    }
  }

  return lines.length > 0
    ? { type: "MultiLineString", coordinates: lines }
    : null;
}

function geometryPoints(value: unknown): LakePoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawPoint) => {
    const point = readPoint(rawPoint);
    return point ? [point] : [];
  });
}

function elementGeometryPoints(value: Record<string, unknown>): LakePoint[] {
  const points = geometryPoints(value.geometry);
  if (value.type !== "relation" || !Array.isArray(value.members)) return points;

  for (const rawMember of value.members) {
    if (!isRecord(rawMember) || rawMember.type !== "way") continue;
    points.push(...geometryPoints(rawMember.geometry));
  }
  return points;
}

function centerFromPoints(points: LakePoint[]): LakePoint | null {
  if (points.length === 0) return null;
  const unique = new Map<string, LakePoint>();
  for (const point of points) unique.set(`${point.lat}:${point.lng}`, point);
  let lat = 0;
  let lng = 0;
  for (const point of unique.values()) {
    lat += point.lat;
    lng += point.lng;
  }
  const center = { lat: lat / unique.size, lng: lng / unique.size };
  return validPoint(center) ? center : null;
}

function elementCenter(value: Record<string, unknown>): LakePoint | null {
  const type = value.type;
  if (type === "node") {
    return readPoint(value) ?? readPoint(value.center);
  }
  return readPoint(value.center) ?? readPoint(value) ?? centerFromPoints(elementGeometryPoints(value));
}

/** Parse one named `natural=water` + `water=lake` Overpass element. */
export function parseOsmWaterLakeElement(value: unknown): LakeCandidate | null {
  if (!isRecord(value) || !isElementType(value.type)) return null;
  const osmId = canonicalOsmId(value.id);
  if (!osmId) return null;

  const tags = asStringTags(value.tags);
  if (!tags) return null;
  if (tags.natural?.trim().toLowerCase() !== "water") return null;
  if (tags.water?.trim().toLowerCase() !== "lake") return null;

  const name = tags.name?.trim() ?? "";
  const normalizedName = normalizeLakeName(name);
  if (!name || !normalizedName) return null;

  const center = elementCenter(value);
  if (!center) return null;

  return {
    osmId,
    osmType: value.type,
    name,
    normalizedName,
    lat: center.lat,
    lng: center.lng,
    tags,
    elevationM: parseElevationMeters(tags.ele),
    linework: extractOsmLakeLinework(value),
  };
}

/** Parse either an Overpass response object or its element array. */
export function parseOsmWaterLakeElements(value: unknown): LakeCandidate[] {
  const elements = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.elements)
      ? value.elements
      : [];
  const relationMemberWays = new Set<string>();
  for (const element of elements) {
    if (!isRecord(element) || element.type !== "relation" || !Array.isArray(element.members)) continue;
    for (const member of element.members) {
      if (!isRecord(member) || member.type !== "way") continue;
      const memberId = canonicalOsmId(member.ref);
      if (memberId) relationMemberWays.add(memberId);
    }
  }
  const seen = new Set<string>();
  const candidates: LakeCandidate[] = [];
  for (const element of elements) {
    const candidate = parseOsmWaterLakeElement(element);
    if (!candidate) continue;
    // A tagged member way and its tagged multipolygon relation describe the
    // same OSM feature. Keep the relation, which carries the full boundary.
    if (candidate.osmType === "way" && relationMemberWays.has(candidate.osmId)) continue;
    const identity = osmIdentityKey(candidate.osmType, candidate.osmId);
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push(candidate);
  }
  return candidates;
}

/** Runner-facing name for parsing an Overpass response. */
export function parseLakeCandidates(response: OverpassResponse | unknown): LakeCandidate[] {
  return parseOsmWaterLakeElements(response);
}

/** Return the spherical distance between two latitude/longitude points. */
export function haversineMeters(left: LakePoint, right: LakePoint): number {
  if (!validPoint(left) || !validPoint(right)) {
    throw new RangeError("haversineMeters requires valid latitude/longitude points");
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const deltaLat = rightLat - leftLat;
  const deltaLngDegrees = ((right.lng - left.lng + 540) % 360) - 180;
  const deltaLng = radians(deltaLngDegrees);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  const clampedH = Math.min(1, Math.max(0, h));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(clampedH), Math.sqrt(1 - clampedH));
}

export interface LakeDestinationPoint {
  name: string | null | undefined;
  lat: number | string | null | undefined;
  lng: number | string | null | undefined;
  id?: string;
}

export interface ExistingLake extends LakeDestinationPoint {
  id: string;
}

export interface LakeProximityCandidate<T extends LakeDestinationPoint> {
  candidate: T;
  distanceMeters: number;
}

export type ExactNameProximityResult<T extends LakeDestinationPoint> =
  | {
      kind: "match";
      candidate: T;
      distanceMeters: number;
      candidates: [LakeProximityCandidate<T>];
    }
  | {
      kind: "ambiguous";
      candidate: null;
      distanceMeters: null;
      candidates: LakeProximityCandidate<T>[];
    }
  | {
      kind: "none";
      candidate: null;
      distanceMeters: null;
      candidates: [];
    };

export type CandidateMatch<T extends LakeDestinationPoint = ExistingLake> = ExactNameProximityResult<T>;

/**
 * Match only normalized-exact names inside the distance window. Any second
 * candidate in that window makes the result ambiguous rather than selecting a
 * nearest row silently.
 */
export function matchExactNameProximity<T extends LakeDestinationPoint>(
  incoming: LakeDestinationPoint,
  existing: readonly T[],
  maxDistanceMeters = DEFAULT_LAKE_NAME_PROXIMITY_METERS
): ExactNameProximityResult<T> {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters < 0) {
    throw new RangeError("maxDistanceMeters must be a finite non-negative number");
  }
  const incomingName = typeof incoming.name === "string"
    ? normalizeLakeName(incoming.name)
    : "";
  const incomingLat = numberValue(incoming.lat);
  const incomingLng = numberValue(incoming.lng);
  if (!incomingName || incomingLat == null || incomingLng == null ||
      !validPoint({ lat: incomingLat, lng: incomingLng })) {
    return { kind: "none", candidate: null, distanceMeters: null, candidates: [] };
  }

  const matches: LakeProximityCandidate<T>[] = [];
  for (const candidate of existing) {
    if (typeof candidate.name !== "string" ||
        normalizeLakeName(candidate.name) !== incomingName) continue;
    const lat = numberValue(candidate.lat);
    const lng = numberValue(candidate.lng);
    if (lat == null || lng == null || !validPoint({ lat, lng })) continue;
    const distanceMeters = haversineMeters(
      { lat: incomingLat, lng: incomingLng },
      { lat, lng }
    );
    if (distanceMeters <= maxDistanceMeters) {
      matches.push({ candidate, distanceMeters });
    }
  }

  matches.sort((left, right) =>
    left.distanceMeters - right.distanceMeters ||
    String(left.candidate.id ?? "").localeCompare(String(right.candidate.id ?? ""))
  );

  if (matches.length === 1) {
    return {
      kind: "match",
      candidate: matches[0].candidate,
      distanceMeters: matches[0].distanceMeters,
      candidates: [matches[0]],
    };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", candidate: null, distanceMeters: null, candidates: matches };
  }
  return { kind: "none", candidate: null, distanceMeters: null, candidates: [] };
}

// Names kept as explicit aliases make the helper readable at call sites that
// describe the operation as either matching or finding a match.
export const findExactNameProximityMatch = matchExactNameProximity;
export const safeExactNameProximityMatch = matchExactNameProximity;

/** Runner-facing exact-name match with an explicit ambiguity result. */
export function matchLakeCandidate<T extends ExistingLake>(
  candidate: LakeCandidate,
  existing: readonly T[],
  maxDistanceM = DEFAULT_LAKE_NAME_PROXIMITY_METERS
): CandidateMatch<T> {
  return matchExactNameProximity(candidate, existing, maxDistanceM);
}
