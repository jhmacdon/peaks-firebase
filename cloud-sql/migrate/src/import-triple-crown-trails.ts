/**
 * Import the official centerlines for the three U.S. hiking Triple Crown trails.
 *
 * The official layers are far denser than a phone or the route matcher needs
 * (roughly 0.8-1.8 million points each). The server path stays within 10 m of
 * the source and has a vertex at least every 100 m so partial-coverage matching
 * remains useful. The client polyline stays within 20 m and has a vertex at
 * least every 500 m so a continent-scale route does not dominate search and
 * detail responses.
 *
 * Dry-run is the default. Applying is idempotent and keeps stable route IDs so
 * existing session_routes rows survive annual centerline updates.
 *
 *   npm run import:triple-crown-trails
 *   npm run import:triple-crown-trails -- --apply
 */

import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import db from "./db";

export type Coordinate = [lng: number, lat: number];

interface ArcGISGeometry {
  type: "LineString" | "MultiLineString";
  coordinates: Coordinate[] | Coordinate[][];
}

interface ArcGISFeature {
  type: "Feature";
  geometry: ArcGISGeometry;
  properties: Record<string, unknown>;
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

interface ArcGISItem {
  id?: string;
  owner?: string;
  title?: string;
  url?: string;
  licenseInfo?: string;
  error?: { message?: string };
}

export interface TrailSource {
  key: "pct" | "at" | "cdt";
  routeId: string;
  segmentId: string;
  name: string;
  officialMiles: number;
  itemId: string;
  itemTitle: string;
  itemOwner: string;
  layerUrl: string;
  layer?: number;
  licenseNeedle: string;
  sourceKind: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  rawMilesRange: [number, number];
  southTerminus: Coordinate;
  northTerminus: Coordinate;
}

const ARC_GIS_ITEMS = "https://www.arcgis.com/sharing/rest/content/items";
const CONNECT_TOLERANCE_METERS = 20;
const SOURCE_FRAGMENT_MIN_METERS = 10;
const SERVER_DEVIATION_METERS = 10;
const SERVER_MAX_VERTEX_SPACING_METERS = 100;
const CLIENT_DEVIATION_METERS = 20;
const CLIENT_MAX_VERTEX_SPACING_METERS = 500;
const TERMINUS_TOLERANCE_METERS = 5_000;
const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_MILE = 1_609.344;

export const TRAIL_SOURCES: TrailSource[] = [
  {
    key: "pct",
    routeId: "triple-crown-pct",
    segmentId: "triple-crown-pct-main",
    name: "Pacific Crest Trail",
    officialMiles: 2_655.84,
    itemId: "71882372584549e3ab6b61fb9c1a0263",
    itemTitle: "Pacific Crest Trail Centerline",
    itemOwner: "PCTA_Admin",
    layerUrl: "https://services5.arcgis.com/ZldHa25efPFpMmfB/arcgis/rest/services/PCTA_Centerline/FeatureServer",
    layer: 0,
    licenseNeedle: "creativecommons.org/licenses/by/4.0/",
    sourceKind: "pcta",
    licenseName: "Creative Commons Attribution 4.0 International",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Pacific Crest Trail Association",
    rawMilesRange: [2_600, 2_700],
    southTerminus: [-116.46698, 32.58974],
    northTerminus: [-120.80211, 49.00030],
  },
  {
    key: "at",
    routeId: "triple-crown-at",
    segmentId: "triple-crown-at-main",
    name: "Appalachian Trail",
    officialMiles: 2_197.9,
    itemId: "2739a451a90c4a3283be4ccd6a6a12a9",
    itemTitle: "APPA  Features and Facilities",
    itemOwner: "jlfoster@nps.gov_nps",
    layerUrl: "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/ANST_Facilities/FeatureServer",
    layer: 7,
    licenseNeedle: "general reference purposes only",
    sourceKind: "nps-atc",
    licenseName: "General reference terms; no warranty",
    licenseUrl: "https://www.arcgis.com/home/item.html?id=2739a451a90c4a3283be4ccd6a6a12a9",
    attribution: "National Park Service Appalachian National Scenic Trail & Appalachian Trail Conservancy",
    rawMilesRange: [2_100, 2_250],
    southTerminus: [-84.19382, 34.62662],
    northTerminus: [-68.92149, 45.90447],
  },
  {
    key: "cdt",
    routeId: "triple-crown-cdt",
    segmentId: "triple-crown-cdt-main",
    name: "Continental Divide Trail",
    officialMiles: 3_100,
    itemId: "4ede52020cd64dd7914e436ef516ad56",
    itemTitle: "Continental Divide NST",
    itemOwner: "CDTCGIS",
    layerUrl: "https://services8.arcgis.com/WyuHwdftppQLa5KO/arcgis/rest/services/Continental_Divide_Trail_2/FeatureServer",
    layer: 0,
    licenseNeedle: "cc by",
    sourceKind: "cdtc",
    licenseName: "Creative Commons Attribution (version not stated)",
    licenseUrl: "https://www.arcgis.com/home/item.html?id=4ede52020cd64dd7914e436ef516ad56",
    attribution: "Continental Divide Trail Coalition",
    rawMilesRange: [2_950, 3_150],
    southTerminus: [-108.20851, 31.49706],
    northTerminus: [-113.90606, 48.99868],
  },
];

export interface ImportArgs {
  apply: boolean;
}

export function parseArgs(args = process.argv.slice(2)): ImportArgs {
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.includes("--apply") && args.includes("--dry-run")) {
    throw new Error("Pass --dry-run or --apply, not both");
  }
  return { apply };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function distanceMeters(left: Coordinate, right: Coordinate): number {
  const deltaLat = radians(right[1] - left[1]);
  const rawDeltaLng = right[0] - left[0];
  const deltaLng = radians(((rawDeltaLng + 540) % 360) - 180);
  const leftLat = radians(left[1]);
  const rightLat = radians(right[1]);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function lineLengthMeters(points: Coordinate[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += distanceMeters(points[index - 1], points[index]);
  }
  return distance;
}

function distanceToSegmentMeters(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate
): number {
  const meanLatitude = radians((point[1] + start[1] + end[1]) / 3);
  const xScale = Math.cos(meanLatitude) * Math.PI / 180 * EARTH_RADIUS_METERS;
  const yScale = Math.PI / 180 * EARTH_RADIUS_METERS;
  const relativeX = (longitude: number) =>
    (((longitude - point[0] + 540) % 360) - 180) * xScale;
  const startX = relativeX(start[0]);
  const startY = (start[1] - point[1]) * yScale;
  const endX = relativeX(end[0]);
  const endY = (end[1] - point[1]) * yScale;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(startX, startY);
  const projection = Math.max(
    0,
    Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared)
  );
  return Math.hypot(startX + projection * deltaX, startY + projection * deltaY);
}

/** Iterative Ramer-Douglas-Peucker so million-point sources cannot overflow the stack. */
export function simplifyLine(points: Coordinate[], toleranceMeters: number): Coordinate[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let furthestIndex = -1;
    let furthestDistance = toleranceMeters;
    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = distanceToSegmentMeters(
        points[index], points[startIndex], points[endIndex]
      );
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex >= 0) {
      keep[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Add vertices to long straight spans without moving the simplified line. */
export function segmentizeLine(points: Coordinate[], maxSpacingMeters: number): Coordinate[] {
  if (points.length <= 1) return [...points];
  const result: Coordinate[] = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const pieces = Math.max(1, Math.ceil(distanceMeters(start, end) / maxSpacingMeters));
    const rawDeltaLng = end[0] - start[0];
    const deltaLng = ((rawDeltaLng + 540) % 360) - 180;
    for (let piece = 1; piece <= pieces; piece++) {
      const fraction = piece / pieces;
      let lng = start[0] + deltaLng * fraction;
      if (lng > 180) lng -= 360;
      if (lng < -180) lng += 360;
      result.push([lng, start[1] + (end[1] - start[1]) * fraction]);
    }
  }
  return result;
}

function flattenLines(collection: FeatureCollection): Array<{
  points: Coordinate[];
  properties: Record<string, unknown>;
}> {
  const lines: Array<{ points: Coordinate[]; properties: Record<string, unknown> }> = [];
  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === "LineString") {
      lines.push({
        points: feature.geometry.coordinates as Coordinate[],
        properties: feature.properties,
      });
    } else if (feature.geometry.type === "MultiLineString") {
      for (const points of feature.geometry.coordinates as Coordinate[][]) {
        lines.push({ points, properties: feature.properties });
      }
    }
  }
  return lines;
}

/** Join an unbranched set of sections from its southern endpoint northward. */
export function chainConnectedLines(
  input: Coordinate[][],
  toleranceMeters = CONNECT_TOLERANCE_METERS
): Coordinate[] {
  const lines = input.filter(
    (points) => points.length >= 2 && lineLengthMeters(points) >= SOURCE_FRAGMENT_MIN_METERS
  );
  if (lines.length === 0) throw new Error("source contains no usable trail line");

  const endpoints = lines.flatMap((points, lineIndex) => [
    { lineIndex, side: 0 as const, point: points[0] },
    { lineIndex, side: 1 as const, point: points[points.length - 1] },
  ]);
  const loose = endpoints.filter((endpoint) => !endpoints.some((other) =>
    other.lineIndex !== endpoint.lineIndex &&
    distanceMeters(endpoint.point, other.point) <= toleranceMeters
  ));
  if (loose.length !== 2) {
    throw new Error(`trail source must have two loose endpoints; found ${loose.length}`);
  }
  const start = [...loose].sort((left, right) => left.point[1] - right.point[1])[0];
  const used = new Set<number>();
  let lineIndex = start.lineIndex;
  let reverse = start.side === 1;
  let result: Coordinate[] = [];

  while (true) {
    let nextLine = reverse ? [...lines[lineIndex]].reverse() : lines[lineIndex];
    if (
      result.length > 0 &&
      distanceMeters(result[result.length - 1], nextLine[0]) <= toleranceMeters
    ) {
      nextLine = nextLine.slice(1);
    }
    result = result.concat(nextLine);
    used.add(lineIndex);

    let nearest:
      | { distance: number; lineIndex: number; reverse: boolean }
      | undefined;
    for (let candidate = 0; candidate < lines.length; candidate++) {
      if (used.has(candidate)) continue;
      for (const candidateReverse of [false, true]) {
        const candidatePoint = candidateReverse
          ? lines[candidate][lines[candidate].length - 1]
          : lines[candidate][0];
        const distance = distanceMeters(result[result.length - 1], candidatePoint);
        if (!nearest || distance < nearest.distance) {
          nearest = { distance, lineIndex: candidate, reverse: candidateReverse };
        }
      }
    }
    if (!nearest || nearest.distance > toleranceMeters) break;
    lineIndex = nearest.lineIndex;
    reverse = nearest.reverse;
  }

  if (used.size !== lines.length) {
    throw new Error(`trail source chain used ${used.size} of ${lines.length} line parts`);
  }
  return result;
}

export function validateItem(source: TrailSource, item: ArcGISItem): void {
  if (item.error) throw new Error(`${source.name} item failed: ${item.error.message ?? "unknown"}`);
  if (item.title !== source.itemTitle || item.owner !== source.itemOwner) {
    throw new Error(
      `${source.name} item identity changed: ${String(item.owner)} / ${String(item.title)}`
    );
  }
  if (item.url?.replace(/\/$/, "") !== source.layerUrl) {
    throw new Error(`${source.name} item service URL changed`);
  }
  if (!(item.licenseInfo ?? "").toLowerCase().includes(source.licenseNeedle)) {
    throw new Error(`${source.name} item reuse terms changed`);
  }
}

export function sourceLine(
  source: TrailSource,
  collection: FeatureCollection
): Coordinate[] {
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error(`${source.name} source is not GeoJSON`);
  }
  if (collection.exceededTransferLimit) {
    throw new Error(`${source.name} source exceeded the ArcGIS transfer limit`);
  }
  let lines = flattenLines(collection);
  if (source.key === "pct") {
    if (collection.features.length !== 1 || lines.length !== 1) {
      throw new Error(`PCT source changed from one centerline feature`);
    }
  } else if (source.key === "at") {
    const rejected = collection.features.filter((feature) =>
      feature.properties.Status !== "Official A.T. Route" ||
      feature.properties.Publish !== "Yes"
    );
    if (rejected.length > 0) {
      throw new Error(`A.T. source contains ${rejected.length} unpublished or non-official features`);
    }
    lines = [{ points: chainConnectedLines(lines.map((line) => line.points)), properties: {} }];
  } else {
    const primary = lines.filter((line) => line.properties.Label === "CDT Primary Route");
    const states = new Set(primary.map((line) => line.properties.State));
    const expectedStates = ["New Mexico", "Colorado", "Wyoming", "Montana"];
    if (primary.length !== 4 || expectedStates.some((state) => !states.has(state))) {
      throw new Error(`CDT source no longer has one primary section for each expected state`);
    }
    lines = [{ points: chainConnectedLines(primary.map((line) => line.points)), properties: {} }];
  }

  let points = lines[0].points;
  if (points[0][1] > points[points.length - 1][1]) points = [...points].reverse();
  const rawMiles = lineLengthMeters(points) / METERS_PER_MILE;
  if (rawMiles < source.rawMilesRange[0] || rawMiles > source.rawMilesRange[1]) {
    throw new Error(`${source.name} geometry length ${rawMiles.toFixed(1)} mi is outside its review range`);
  }
  if (
    distanceMeters(points[0], source.southTerminus) > TERMINUS_TOLERANCE_METERS ||
    distanceMeters(points[points.length - 1], source.northTerminus) > TERMINUS_TOLERANCE_METERS
  ) {
    throw new Error(`${source.name} terminus moved outside the 5 km review bound`);
  }
  return points;
}

export function encodePolyline6(points: Coordinate[]): string {
  let encoded = "";
  let previousLat = 0;
  let previousLng = 0;
  const encodeSigned = (value: number): string => {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    let part = "";
    while (shifted >= 0x20) {
      part += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    return part + String.fromCharCode(shifted + 63);
  };
  for (const [lng, lat] of points) {
    const latE6 = Math.round(lat * 1e6);
    const lngE6 = Math.round(lng * 1e6);
    encoded += encodeSigned(latE6 - previousLat);
    encoded += encodeSigned(lngE6 - previousLng);
    previousLat = latE6;
    previousLng = lngE6;
  }
  return encoded;
}

export interface TrailPlan {
  source: TrailSource;
  retrievedAt: string;
  rawPoints: number;
  rawMiles: number;
  serverPoints: Coordinate[];
  serverMiles: number;
  clientPoints: Coordinate[];
  polyline6: string;
  geometryHash: string;
  provenance: Record<string, unknown>;
}

export function buildTrailPlan(
  source: TrailSource,
  rawPoints: Coordinate[],
  retrievedAt: string
): TrailPlan {
  const serverPoints = segmentizeLine(
    simplifyLine(rawPoints, SERVER_DEVIATION_METERS),
    SERVER_MAX_VERTEX_SPACING_METERS
  );
  const clientPoints = segmentizeLine(
    simplifyLine(rawPoints, CLIENT_DEVIATION_METERS),
    CLIENT_MAX_VERTEX_SPACING_METERS
  );
  const rawMiles = lineLengthMeters(rawPoints) / METERS_PER_MILE;
  const serverMiles = lineLengthMeters(serverPoints) / METERS_PER_MILE;
  const lengthLoss = (rawMiles - serverMiles) / rawMiles;
  if (serverPoints.length < 20_000 || serverPoints.length > 100_000 || lengthLoss > 0.05) {
    throw new Error(
      `${source.name} simplification failed review bounds: ${serverPoints.length} points, ` +
      `${(lengthLoss * 100).toFixed(2)}% length loss`
    );
  }
  const maxServerGap = serverPoints.slice(1).reduce(
    (max, point, index) => Math.max(max, distanceMeters(serverPoints[index], point)),
    0
  );
  if (maxServerGap > SERVER_MAX_VERTEX_SPACING_METERS + 0.1) {
    throw new Error(`${source.name} server path has a ${maxServerGap.toFixed(1)} m vertex gap`);
  }
  const polyline6 = encodePolyline6(clientPoints);
  const geometryHash = createHash("sha256")
    .update(JSON.stringify(serverPoints))
    .digest("hex");
  return {
    source,
    retrievedAt,
    rawPoints: rawPoints.length,
    rawMiles,
    serverPoints,
    serverMiles,
    clientPoints,
    polyline6,
    geometryHash,
    provenance: {
      source_kind: source.sourceKind,
      source_url: `https://www.arcgis.com/home/item.html?id=${source.itemId}`,
      license_name: source.licenseName,
      license_url: source.licenseUrl,
      attribution: source.attribution,
      retrieved_at: retrievedAt,
      osm_way_ids: [],
      osm_way_urls: [],
      contains_osm_geometry: false,
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Peaks Triple Crown importer (https://github.com/jhmacdon/peaks-firebase)",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function layerQueryUrl(source: TrailSource): string {
  const url = new URL(`${source.layerUrl}/${source.layer ?? 0}/query`);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("resultRecordCount", "2000");
  url.searchParams.set("f", "geojson");
  return url.toString();
}

async function fetchTrailPlan(source: TrailSource, retrievedAt: string): Promise<TrailPlan> {
  console.error(`[triple-crown] Fetching ${source.name} metadata`);
  const item = await fetchJson<ArcGISItem>(`${ARC_GIS_ITEMS}/${source.itemId}?f=json`);
  validateItem(source, item);
  console.error(`[triple-crown] Fetching ${source.name} centerline`);
  const collection = await fetchJson<FeatureCollection>(layerQueryUrl(source));
  return buildTrailPlan(source, sourceLine(source, collection), retrievedAt);
}

async function assertSafeTargets(client: PoolClient, plans: TrailPlan[]): Promise<void> {
  const ids = plans.map((plan) => plan.source.routeId);
  const names = plans.map((plan) => plan.source.name.toLowerCase());
  const conflicts = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM routes
     WHERE status = 'active' AND lower(name) = ANY($1::text[])
       AND NOT (id = ANY($2::text[]))`,
    [names, ids]
  );
  if (conflicts.rows.length > 0) {
    throw new Error(
      `Active route name conflict: ${conflicts.rows.map((row) => `${row.id}:${row.name}`).join(", ")}`
    );
  }

  const existing = await client.query<{
    id: string;
    owner: string;
    source_kind: string | null;
  }>(
    `SELECT id, owner, provenance->>'source_kind' AS source_kind
     FROM routes WHERE id = ANY($1::text[])`,
    [ids]
  );
  const sourceById = new Map(plans.map((plan) => [plan.source.routeId, plan.source.sourceKind]));
  for (const row of existing.rows) {
    if (row.owner !== "peaks" || row.source_kind !== sourceById.get(row.id)) {
      throw new Error(`${row.id} exists but is not managed by the Triple Crown importer`);
    }
  }
}

async function applyPlans(client: PoolClient, plans: TrailPlan[]): Promise<void> {
  await client.query("BEGIN");
  try {
    await assertSafeTargets(client, plans);
    for (const plan of plans) {
      const source = plan.source;
      const geometry = JSON.stringify({
        type: "LineString",
        coordinates: plan.serverPoints.map(([lng, lat]) => [lng, lat, 0]),
      });
      const provenance = JSON.stringify(plan.provenance);
      const officialMeters = source.officialMiles * METERS_PER_MILE;

      await client.query(
        `INSERT INTO segments (
           id, name, path, polyline6, distance, gain, gain_loss, provenance
         ) VALUES (
           $1, $2,
           ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography,
           $4, $5, NULL, NULL, $6::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           path = EXCLUDED.path,
           polyline6 = EXCLUDED.polyline6,
           distance = EXCLUDED.distance,
           gain = NULL,
           gain_loss = NULL,
           provenance = EXCLUDED.provenance,
           updated_at = now()`,
        [source.segmentId, source.name, geometry, plan.polyline6, officialMeters, provenance]
      );

      await client.query(
        `INSERT INTO routes (
           id, name, path, polyline6, owner, distance, gain, gain_loss,
           elevation_string, external_links, provenance, completion, shape, status
         ) VALUES (
           $1, $2,
           ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography,
           $4, 'peaks', $5, NULL, NULL,
           NULL, '[]'::jsonb, $6::jsonb, 'none', 'point_to_point', 'active'
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           path = EXCLUDED.path,
           polyline6 = EXCLUDED.polyline6,
           distance = EXCLUDED.distance,
           gain = NULL,
           gain_loss = NULL,
           elevation_string = NULL,
           elevation_source = NULL,
           elevation_source_url = NULL,
           elevation_attribution = NULL,
           elevation_license_url = NULL,
           elevation_retrieved_at = NULL,
           external_links = EXCLUDED.external_links,
           provenance = EXCLUDED.provenance,
           completion = EXCLUDED.completion,
           shape = EXCLUDED.shape,
           status = EXCLUDED.status,
           updated_at = now()`,
        [source.routeId, source.name, geometry, plan.polyline6, officialMeters, provenance]
      );

      await client.query(
        "DELETE FROM triple_crown_route_points WHERE route_id = $1",
        [source.routeId]
      );
      const indexed = await client.query(
        `WITH points AS (
           SELECT (dumped).path[1] AS idx,
                  ST_Force2D((dumped).geom)::geometry(Point, 4326) AS pt
           FROM routes r
           CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) AS dumped
           WHERE r.id = $1
         ), stepped AS (
           SELECT idx, pt, lag(pt) OVER (ORDER BY idx) AS prev_pt
           FROM points
         ), measured AS (
           SELECT idx, pt,
                  SUM(
                    CASE WHEN prev_pt IS NULL THEN 0
                         ELSE ST_Distance(pt::geography, prev_pt::geography, false)
                    END
                  ) OVER (ORDER BY idx ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS along_m
           FROM stepped
         )
         INSERT INTO triple_crown_route_points (route_id, idx, pt, along_m)
         SELECT $1, idx, pt, along_m FROM measured`,
        [source.routeId]
      );
      if (indexed.rowCount !== plan.serverPoints.length) {
        throw new Error(
          `${source.name} indexed ${indexed.rowCount ?? 0} of ${plan.serverPoints.length} points`
        );
      }

      await client.query("DELETE FROM route_segments WHERE route_id = $1", [source.routeId]);
      await client.query(
        `INSERT INTO route_segments (route_id, segment_id, ordinal, direction)
         VALUES ($1, $2, 0, 'forward')`,
        [source.routeId, source.segmentId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function currentRows(client: PoolClient, plans: TrailPlan[]): Promise<unknown[]> {
  const ids = plans.map((plan) => plan.source.routeId);
  const result = await client.query(
    `SELECT id, name, status, distance,
            CASE WHEN path IS NULL THEN NULL ELSE ST_NPoints(path::geometry) END AS path_points,
            (SELECT count(*)::int FROM triple_crown_route_points tcp
             WHERE tcp.route_id = routes.id) AS coverage_points,
            length(polyline6) AS polyline_bytes,
            provenance->>'retrieved_at' AS retrieved_at
     FROM routes WHERE id = ANY($1::text[]) ORDER BY id`,
    [ids]
  );
  return result.rows;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const retrievedAt = new Date().toISOString();
  const plans: TrailPlan[] = [];
  for (const source of TRAIL_SOURCES) {
    plans.push(await fetchTrailPlan(source, retrievedAt));
  }

  const client = await db.connect();
  try {
    await assertSafeTargets(client, plans);
    const before = await currentRows(client, plans);
    if (args.apply) await applyPlans(client, plans);
    const after = args.apply ? await currentRows(client, plans) : before;
    console.log(JSON.stringify({
      apply: args.apply,
      recurringMonthlyCostUpperBoundUsd: 0.01,
      before,
      trails: plans.map((plan) => ({
        id: plan.source.routeId,
        name: plan.source.name,
        officialMiles: plan.source.officialMiles,
        rawMiles: Number(plan.rawMiles.toFixed(2)),
        rawPoints: plan.rawPoints,
        serverMiles: Number(plan.serverMiles.toFixed(2)),
        serverPoints: plan.serverPoints.length,
        clientPoints: plan.clientPoints.length,
        polylineBytes: plan.polyline6.length,
        geometryHash: plan.geometryHash,
        source: plan.provenance.source_url,
        license: plan.source.licenseName,
      })),
      after,
    }, null, 2));
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
