import { createHash } from "node:crypto";

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface OsmRouteMember {
  type: string;
  ref: number;
  role?: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OsmRouteRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: OsmRouteMember[];
}

export interface RouteChain {
  key: string;
  points: RoutePoint[];
  wayIds: number[];
  distanceMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const CHAIN_JOIN_TOLERANCE_METERS = 20;

export function explicitOsmRouteName(
  tags: Record<string, string> | undefined
): string | null {
  const name = tags?.name?.replace(/\s+/g, " ").trim();
  if (!name || name.length < 3) return null;
  if (/^(unnamed|unknown|route|trail|path)$/i.test(name)) return null;
  return name;
}

export function isNamedPublicRecording(
  name: string | null | undefined,
  summitNames: string[]
): boolean {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (
    /^(activity|afternoon|evening|hike|hiking|morning|recording|route|run|trail|untitled|walk|walking)( \d+)?$/
      .test(normalized)
  ) {
    return false;
  }

  const recordingParts = normalized.split(/\s+(?:and|via)\s+|\s*\/\s*/).filter(Boolean);
  return summitNames.some((summitName) => {
    const summit = normalizeName(summitName);
    if (!summit) return false;
    const shortSummit = summit.replace(/\b(mount|mountain|mt|peak)\b/g, "").replace(/\s+/g, " ").trim();
    return recordingParts.some((part) =>
      part === summit ||
      part === shortSummit ||
      part.replace(/\b(mount|mountain|mt|peak)\b/g, "").replace(/\s+/g, " ").trim() === shortSummit
    ) ||
      normalized.includes(summit) ||
      summit.includes(normalized);
  });
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stitchOsmRouteChains(
  relation: OsmRouteRelation
): RouteChain[] {
  const chains: Array<{ points: RoutePoint[]; wayIds: number[] }> = [];
  for (const member of relation.members ?? []) {
    if (member.type !== "way" || !member.geometry || member.geometry.length < 2) continue;
    if (/^(platform|stop|guidepost)$/i.test(member.role ?? "")) continue;

    const points = dedupeConsecutive(
      member.geometry.map((point) => ({ lat: point.lat, lng: point.lon }))
    );
    if (points.length < 2) continue;
    addSegmentToChains(chains, points, member.ref);
  }

  mergeTouchingChains(chains);

  return chains
    .map((chain) => ({
      key: createHash("sha1")
        .update([...chain.wayIds].sort((a, b) => a - b).join(","))
        .digest("hex")
        .slice(0, 10),
      points: chain.points,
      wayIds: chain.wayIds,
      distanceMeters: polylineDistanceMeters(chain.points),
    }))
    .filter((chain) => chain.points.length >= 2 && chain.distanceMeters >= 100)
    .sort((left, right) => right.distanceMeters - left.distanceMeters);
}

export function polylineDistanceMeters(points: RoutePoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += haversineMeters(points[index - 1], points[index]);
  }
  return distance;
}

export function pointToPolylineDistanceMeters(
  point: RoutePoint,
  line: RoutePoint[]
): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineMeters(point, line[0]);

  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index++) {
    nearest = Math.min(nearest, pointToSegmentDistanceMeters(point, line[index - 1], line[index]));
  }
  return nearest;
}

export function encodePolyline6(points: RoutePoint[]): string {
  let result = "";
  let previousLat = 0;
  let previousLng = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * 1e6);
    const lng = Math.round(point.lng * 1e6);
    result += encodeSigned(lat - previousLat);
    result += encodeSigned(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }
  return result;
}

function addSegmentToChains(
  chains: Array<{ points: RoutePoint[]; wayIds: number[] }>,
  segment: RoutePoint[],
  wayId: number
): void {
  let best:
    | { chainIndex: number; mode: "append" | "append-reverse" | "prepend" | "prepend-reverse"; distance: number }
    | null = null;

  for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
    const chain = chains[chainIndex].points;
    const candidates = [
      { mode: "append" as const, distance: haversineMeters(chain.at(-1)!, segment[0]) },
      { mode: "append-reverse" as const, distance: haversineMeters(chain.at(-1)!, segment.at(-1)!) },
      { mode: "prepend" as const, distance: haversineMeters(chain[0], segment.at(-1)!) },
      { mode: "prepend-reverse" as const, distance: haversineMeters(chain[0], segment[0]) },
    ];
    for (const candidate of candidates) {
      if (candidate.distance > CHAIN_JOIN_TOLERANCE_METERS) continue;
      if (!best || candidate.distance < best.distance) {
        best = { chainIndex, ...candidate };
      }
    }
  }

  if (!best) {
    chains.push({ points: segment, wayIds: [wayId] });
    return;
  }

  const chain = chains[best.chainIndex];
  if (best.mode === "append") {
    chain.points.push(...withoutSharedEndpoint(chain.points.at(-1)!, segment));
  } else if (best.mode === "append-reverse") {
    chain.points.push(...withoutSharedEndpoint(chain.points.at(-1)!, [...segment].reverse()));
  } else if (best.mode === "prepend") {
    chain.points.unshift(...withoutSharedEndpoint(chain.points[0], segment).reverse());
  } else {
    chain.points.unshift(...withoutSharedEndpoint(chain.points[0], [...segment].reverse()).reverse());
  }
  chain.wayIds.push(wayId);
}

function mergeTouchingChains(
  chains: Array<{ points: RoutePoint[]; wayIds: number[] }>
): void {
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let leftIndex = 0; leftIndex < chains.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < chains.length; rightIndex++) {
        const left = chains[leftIndex];
        const right = chains[rightIndex];
        const joins = [
          {
            distance: haversineMeters(left.points.at(-1)!, right.points[0]),
            points: [...left.points, ...withoutSharedEndpoint(left.points.at(-1)!, right.points)],
          },
          {
            distance: haversineMeters(left.points.at(-1)!, right.points.at(-1)!),
            points: [...left.points, ...withoutSharedEndpoint(left.points.at(-1)!, [...right.points].reverse())],
          },
          {
            distance: haversineMeters(left.points[0], right.points.at(-1)!),
            points: [...right.points, ...withoutSharedEndpoint(right.points.at(-1)!, left.points)],
          },
          {
            distance: haversineMeters(left.points[0], right.points[0]),
            points: [[...right.points].reverse(), left.points]
              .flatMap((part, index) => index === 0
                ? part
                : withoutSharedEndpoint(right.points[0], part)),
          },
        ].sort((a, b) => a.distance - b.distance);

        if (joins[0].distance <= CHAIN_JOIN_TOLERANCE_METERS) {
          left.points = dedupeConsecutive(joins[0].points);
          left.wayIds.push(...right.wayIds);
          chains.splice(rightIndex, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
}

function withoutSharedEndpoint(endpoint: RoutePoint, points: RoutePoint[]): RoutePoint[] {
  return haversineMeters(endpoint, points[0]) <= CHAIN_JOIN_TOLERANCE_METERS
    ? points.slice(1)
    : points;
}

function dedupeConsecutive(points: RoutePoint[]): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous || haversineMeters(previous, point) > 0.05) result.push(point);
  }
  return result;
}

function haversineMeters(left: RoutePoint, right: RoutePoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(right.lat - left.lat);
  const rawDeltaLng = right.lng - left.lng;
  const wrappedDeltaLng = ((rawDeltaLng + 540) % 360) - 180;
  const deltaLng = radians(wrappedDeltaLng);
  const leftLat = radians(left.lat);
  const rightLat = radians(right.lat);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointToSegmentDistanceMeters(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint
): number {
  const meanLat = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const scaleX = Math.cos(meanLat) * Math.PI / 180 * EARTH_RADIUS_METERS;
  const scaleY = Math.PI / 180 * EARTH_RADIUS_METERS;
  const unwrap = (lng: number) => {
    const delta = ((lng - point.lng + 540) % 360) - 180;
    return delta * scaleX;
  };
  const startX = unwrap(start.lng);
  const startY = (start.lat - point.lat) * scaleY;
  const endX = unwrap(end.lng);
  const endY = (end.lat - point.lat) * scaleY;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(startX, startY);
  const projection = Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared));
  return Math.hypot(startX + projection * deltaX, startY + projection * deltaY);
}

function encodeSigned(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let result = "";
  while (shifted >= 0x20) {
    result += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return result + String.fromCharCode(shifted + 63);
}
