import { createHash } from "node:crypto";

export type OsmViewpointElementType = "node" | "way" | "relation";

export interface ViewpointPoint {
  lat: number;
  lng: number;
}

export interface OverpassViewpointElement {
  type: OsmViewpointElementType;
  id: string | number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
}

export interface OsmViewpointCandidate extends ViewpointPoint {
  osmId: string;
  osmType: OsmViewpointElementType;
  name: string;
  normalizedName: string;
  tags: Record<string, string>;
  elevationM: number | null;
}

export interface ViewpointDestinationPoint extends ViewpointPoint {
  id: string;
  name: string | null;
}

export type OsmViewpointExternalIdField = "osm_node" | "osm_way" | "osm_relation";

export const DEFAULT_VIEWPOINT_NAME_PROXIMITY_METERS = 100;

const OSM_EXTERNAL_ID_FIELDS: Record<OsmViewpointElementType, OsmViewpointExternalIdField> = {
  node: "osm_node",
  way: "osm_way",
  relation: "osm_relation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isElementType(value: unknown): value is OsmViewpointElementType {
  return value === "node" || value === "way" || value === "relation";
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function validPoint(point: ViewpointPoint): boolean {
  return Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 && point.lat <= 90 &&
    point.lng >= -180 && point.lng <= 180;
}

function readPoint(value: unknown): ViewpointPoint | null {
  if (!isRecord(value)) return null;
  const lat = numberValue(value.lat);
  const lng = numberValue(value.lon ?? value.lng);
  if (lat == null || lng == null) return null;
  const point = { lat, lng };
  return validPoint(point) ? point : null;
}

function centerFromGeometry(value: unknown): ViewpointPoint | null {
  if (!Array.isArray(value)) return null;
  const points = value.flatMap((entry) => {
    const point = readPoint(entry);
    return point ? [point] : [];
  });
  if (points.length === 0) return null;
  const center = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: center.lat / points.length,
    lng: center.lng / points.length,
  };
}

function stringTags(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const tags: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(value)) {
    if (typeof tagValue !== "string") return null;
    tags[key] = tagValue;
  }
  return tags;
}

export function canonicalOsmViewpointId(value: unknown): string | null {
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

export function osmViewpointExternalIdField(
  type: OsmViewpointElementType
): OsmViewpointExternalIdField {
  return OSM_EXTERNAL_ID_FIELDS[type];
}

export function osmViewpointIdentity(
  type: OsmViewpointElementType,
  id: string | number
): string {
  const canonicalId = canonicalOsmViewpointId(id);
  if (!canonicalId) throw new Error(`Invalid OSM ID: ${String(id)}`);
  return `${type}:${canonicalId}`;
}

export function buildViewpointExternalIds(
  type: OsmViewpointElementType,
  id: string | number
): Record<OsmViewpointExternalIdField, string> {
  const canonicalId = canonicalOsmViewpointId(id);
  if (!canonicalId) throw new Error(`Invalid OSM ID: ${String(id)}`);
  return { [osmViewpointExternalIdField(type)]: canonicalId } as Record<
    OsmViewpointExternalIdField,
    string
  >;
}

export function deterministicViewpointDestinationId(
  type: OsmViewpointElementType,
  id: string | number
): string {
  return createHash("sha256")
    .update(`osm-viewpoint:${osmViewpointIdentity(type, id)}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export function normalizeViewpointName(value: string): string {
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

export function parseViewpointElevationMeters(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim().replace(/,/g, "");
  const match = text.match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(m|meter|meters|ft|feet|foot)?$/i
  );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  return unit === "ft" || unit === "feet" || unit === "foot"
    ? value / 3.28084
    : value;
}

export function parseOsmViewpointElement(value: unknown): OsmViewpointCandidate | null {
  if (!isRecord(value) || !isElementType(value.type)) return null;
  const osmId = canonicalOsmViewpointId(value.id);
  if (!osmId) return null;

  const tags = stringTags(value.tags);
  if (!tags || tags.tourism?.trim().toLowerCase() !== "viewpoint") return null;
  const access = tags.access?.trim().toLowerCase();
  if (access === "no" || access === "private") return null;

  const name = tags["name:en"]?.trim() || tags.name?.trim() || "";
  const normalizedName = normalizeViewpointName(name);
  if (!name || !normalizedName) return null;

  const point = value.type === "node"
    ? readPoint(value) ?? readPoint(value.center)
    : readPoint(value.center) ?? centerFromGeometry(value.geometry);
  if (!point) return null;

  return {
    osmId,
    osmType: value.type,
    name,
    normalizedName,
    lat: point.lat,
    lng: point.lng,
    tags,
    elevationM: parseViewpointElevationMeters(tags.ele),
  };
}

export function parseOsmViewpointElements(value: unknown): OsmViewpointCandidate[] {
  const elements = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.elements)
      ? value.elements
      : [];
  const seen = new Set<string>();
  const result: OsmViewpointCandidate[] = [];
  for (const element of elements) {
    const candidate = parseOsmViewpointElement(element);
    if (!candidate) continue;
    const identity = osmViewpointIdentity(candidate.osmType, candidate.osmId);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(candidate);
  }
  return result;
}

export function haversineViewpointMeters(
  left: ViewpointPoint,
  right: ViewpointPoint
): number {
  const radius = 6_371_000;
  const dLat = ((right.lat - left.lat) * Math.PI) / 180;
  let dLngDegrees = right.lng - left.lng;
  if (dLngDegrees > 180) dLngDegrees -= 360;
  if (dLngDegrees < -180) dLngDegrees += 360;
  const dLng = (dLngDegrees * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((left.lat * Math.PI) / 180) *
      Math.cos((right.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function exactNameProximityMatches<T extends ViewpointDestinationPoint>(
  candidate: Pick<OsmViewpointCandidate, "name" | "lat" | "lng">,
  destinations: T[],
  thresholdMeters = DEFAULT_VIEWPOINT_NAME_PROXIMITY_METERS
): Array<{ destination: T; distanceMeters: number }> {
  const normalized = normalizeViewpointName(candidate.name);
  return destinations
    .filter((destination) =>
      destination.name != null && normalizeViewpointName(destination.name) === normalized
    )
    .map((destination) => ({
      destination,
      distanceMeters: haversineViewpointMeters(candidate, destination),
    }))
    .filter((match) => match.distanceMeters <= thresholdMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters ||
      left.destination.id.localeCompare(right.destination.id));
}
