#!/usr/bin/env node

import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

const CORE_SAMPLE_STEP_M = 20;
const CORE_COVERAGE_DISTANCE_M = 3;
const CORE_MIN_COVERAGE = 0.99;
const CORE_MAX_OFFSET_M = 5;
const CORE_P95_OFFSET_M = 2;
const CONNECTOR_MAX_OFFSET_M = 125;
const SOURCE_USAGE_DISTANCE_M = 5;

type LatLng = { lat: number; lng: number };
type SourceSegment = {
  objectId: number;
  start: LatLng;
  end: LatLng;
};
type RouteRow = {
  id: string;
  name: string;
  owner: string;
  status: string;
  shape: string | null;
  provenance: {
    source_kind?: string;
    source_url?: string;
    license_name?: string;
    contains_osm_geometry?: boolean;
    osm_way_ids?: unknown[];
  } | null;
  provenance_valid: boolean;
  is_simple: boolean;
  active_standard_exists: boolean;
  linked_destinations: Array<{
    id: string;
    ordinal: number;
    features: string[];
    lat: number;
    lng: number;
  }>;
  segment_count: number;
  segment_provenance_matches: boolean;
};

function usage(): never {
  console.log(
    "Usage: check_pending_usgs_routes.mts --route-id ID [--format summary|json]"
  );
  process.exit(0);
}

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index < 0 ? "" : argv[index + 1] ?? "";
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const radiusM = 6_371_000;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function pointToSegmentMeters(point: LatLng, segment: SourceSegment): number {
  const radiusM = 6_371_000;
  const latScale = Math.PI / 180 * radiusM;
  const lngScale = latScale * Math.cos(radians(point.lat));
  const ax = (segment.start.lng - point.lng) * lngScale;
  const ay = (segment.start.lat - point.lat) * latScale;
  const bx = (segment.end.lng - point.lng) * lngScale;
  const by = (segment.end.lat - point.lat) * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + fraction * dx, ay + fraction * dy);
}

function nearest(point: LatLng, segments: SourceSegment[]): {
  distance: number;
  objectId: number;
} {
  let distance = Number.POSITIVE_INFINITY;
  let objectId = -1;
  for (const segment of segments) {
    const candidate = pointToSegmentMeters(point, segment);
    if (candidate < distance) {
      distance = candidate;
      objectId = segment.objectId;
    }
  }
  return { distance, objectId };
}

function samples(points: LatLng[]): LatLng[] {
  const output: LatLng[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const count = Math.max(
      1,
      Math.ceil(haversineMeters(start, end) / CORE_SAMPLE_STEP_M)
    );
    for (let step = 0; step < count; step += 1) {
      const fraction = step / count;
      output.push({
        lat: start.lat + (end.lat - start.lat) * fraction,
        lng: start.lng + (end.lng - start.lng) * fraction,
      });
    }
  }
  if (points.length >= 2) output.push(points[points.length - 2]);
  return output;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

async function loadRoute(routeId: string): Promise<RouteRow> {
  const result = await db.query<RouteRow>(
    `SELECT r.id, r.name, r.owner, r.status, r.shape, r.provenance,
            is_valid_route_provenance(r.provenance) AS provenance_valid,
            ST_IsSimple(r.path::geometry) AS is_simple,
            EXISTS (
              SELECT 1
              FROM route_destinations target_rd
              JOIN route_destinations active_rd
                ON active_rd.destination_id = target_rd.destination_id
              JOIN routes active_route ON active_route.id = active_rd.route_id
              JOIN destinations target_destination
                ON target_destination.id = target_rd.destination_id
              WHERE target_rd.route_id = r.id
                AND 'summit'::destination_feature =
                    ANY(target_destination.features)
                AND active_route.owner = 'peaks'
                AND active_route.status = 'active'
            ) AS active_standard_exists,
            (
              SELECT json_agg(
                json_build_object(
                  'id', d.id,
                  'ordinal', rd.ordinal,
                  'features', d.features,
                  'lat', ST_Y(d.location::geometry),
                  'lng', ST_X(d.location::geometry)
                )
                ORDER BY rd.ordinal
              )
              FROM route_destinations rd
              JOIN destinations d ON d.id = rd.destination_id
              WHERE rd.route_id = r.id
            ) AS linked_destinations,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              WHERE rs.route_id = r.id
            ) AS segment_count,
            NOT EXISTS (
              SELECT 1
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND s.provenance IS DISTINCT FROM r.provenance
            ) AS segment_provenance_matches
     FROM routes r
     WHERE r.id = $1`,
    [routeId]
  );
  if (!result.rows[0]) throw new Error(`Route not found: ${routeId}`);
  result.rows[0].linked_destinations = Array.isArray(
    result.rows[0].linked_destinations
  )
    ? result.rows[0].linked_destinations
    : [];
  return result.rows[0];
}

async function loadRoutePoints(routeId: string): Promise<LatLng[]> {
  const result = await db.query<{ lat: number; lng: number }>(
    `SELECT ST_Y((dp).geom) AS lat, ST_X((dp).geom) AS lng
     FROM routes r
     CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dp
     WHERE r.id = $1
     ORDER BY (dp).path[1]`,
    [routeId]
  );
  return result.rows.map((point) => ({
    lat: Number(point.lat),
    lng: Number(point.lng),
  }));
}

async function fetchSource(sourceUrl: string): Promise<{
  segments: SourceSegment[];
  objectIds: number[];
}> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "partnerships.nationalmap.gov") {
    throw new Error("USGS source URL is not a National Map HTTPS URL");
  }
  url.searchParams.set("f", "geojson");
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Peaks USGS route approval/1.0 " +
        "(https://github.com/jhmacdon/peaks-firebase)",
    },
  });
  if (!response.ok) {
    throw new Error(`USGS National Map returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    features?: Array<{
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  const segments: SourceSegment[] = [];
  const objectIds: number[] = [];
  for (const feature of payload.features ?? []) {
    const properties = feature.properties ?? {};
    const objectId = Number(
      properties.objectid ?? properties.OBJECTID ?? properties.ObjectID
    );
    if (!Number.isSafeInteger(objectId) || objectId <= 0) {
      throw new Error("USGS source returned an invalid object ID");
    }
    objectIds.push(objectId);
    const rawLines =
      feature.geometry?.type === "LineString" &&
      Array.isArray(feature.geometry.coordinates)
        ? [feature.geometry.coordinates]
        : feature.geometry?.type === "MultiLineString" &&
            Array.isArray(feature.geometry.coordinates)
          ? feature.geometry.coordinates
          : [];
    for (const rawLine of rawLines) {
      if (!Array.isArray(rawLine)) continue;
      const line = rawLine.map((coordinate) => {
        if (
          !Array.isArray(coordinate) ||
          !Number.isFinite(coordinate[0]) ||
          !Number.isFinite(coordinate[1])
        ) {
          throw new Error("USGS source returned invalid coordinates");
        }
        return { lng: Number(coordinate[0]), lat: Number(coordinate[1]) };
      });
      for (let index = 1; index < line.length; index += 1) {
        segments.push({
          objectId,
          start: line[index - 1],
          end: line[index],
        });
      }
    }
  }
  if (segments.length === 0) throw new Error("USGS source returned no lines");
  return { segments, objectIds: [...new Set(objectIds)] };
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) usage();
const routeId = valueAfter(argv, "--route-id");
const format = valueAfter(argv, "--format") || "summary";
if (!/^[A-Za-z0-9_-]+$/.test(routeId)) {
  throw new Error("--route-id is required");
}
if (format !== "summary" && format !== "json") {
  throw new Error("--format must be summary or json");
}

try {
  const route = await loadRoute(routeId);
  const errors: string[] = [];
  if (route.owner !== "peaks") errors.push("route owner is not peaks");
  if (route.status !== "pending") errors.push("route status is not pending");
  if (!route.provenance_valid || !route.provenance) {
    errors.push("route provenance is missing or invalid");
  }
  if (route.active_standard_exists) {
    errors.push("an active Peaks route already covers the summit");
  }
  if (!route.is_simple) errors.push("stored route geometry is not simple");
  if (route.segment_count < 1 || !route.segment_provenance_matches) {
    errors.push("route and segment provenance do not agree");
  }
  const places = route.linked_destinations;
  const trailhead = places[0];
  const summit = places[places.length - 1];
  if (!trailhead?.features.includes("trailhead")) {
    errors.push("first linked destination is not a trailhead");
  }
  if (!summit?.features.includes("summit")) {
    errors.push("last linked destination is not a summit");
  }
  const provenance = route.provenance;
  if (
    provenance?.source_kind !== "usgs-national-map" ||
    provenance.license_name !== "Public domain" ||
    provenance.contains_osm_geometry !== false ||
    (provenance.osm_way_ids?.length ?? 0) !== 0
  ) {
    errors.push("provenance does not identify public-domain USGS geometry");
  }

  const points = await loadRoutePoints(routeId);
  if (points.length < 5) errors.push("route has fewer than five points");
  const source = provenance?.source_url
    ? await fetchSource(provenance.source_url)
    : { segments: [], objectIds: [] };
  const startConnectorM =
    points[0] && source.segments.length > 0
      ? nearest(points[0], source.segments).distance
      : Number.POSITIVE_INFINITY;
  const endConnectorM =
    points.at(-1) && source.segments.length > 0
      ? nearest(points.at(-1)!, source.segments).distance
      : Number.POSITIVE_INFINITY;
  if (startConnectorM > CONNECTOR_MAX_OFFSET_M) {
    errors.push(`trailhead connector is ${startConnectorM.toFixed(1)} m`);
  }
  if (endConnectorM > CONNECTOR_MAX_OFFSET_M) {
    errors.push(`summit connector is ${endConnectorM.toFixed(1)} m`);
  }
  if (
    points[0] &&
    trailhead &&
    haversineMeters(points[0], trailhead) > 20
  ) {
    errors.push("stored route start does not match the trailhead");
  }
  if (
    points.at(-1) &&
    summit &&
    haversineMeters(points.at(-1)!, summit) > 20
  ) {
    errors.push("stored route end does not match the summit");
  }

  const core = samples(points);
  const offsets = core.map((point) => nearest(point, source.segments).distance);
  const coreMaxOffsetM = offsets.length > 0 ? Math.max(...offsets) : Infinity;
  const coreP95OffsetM = percentile(offsets, 0.95);
  const coreCoveragePct =
    offsets.length === 0
      ? 0
      : 100 *
        offsets.filter((offset) => offset <= CORE_COVERAGE_DISTANCE_M).length /
        offsets.length;
  if (coreMaxOffsetM > CORE_MAX_OFFSET_M) {
    errors.push(`maximum core offset is ${coreMaxOffsetM.toFixed(2)} m`);
  }
  if (coreP95OffsetM > CORE_P95_OFFSET_M) {
    errors.push(`p95 core offset is ${coreP95OffsetM.toFixed(2)} m`);
  }
  if (coreCoveragePct < CORE_MIN_COVERAGE * 100) {
    errors.push(`core coverage is ${coreCoveragePct.toFixed(2)}%`);
  }
  const usedObjectIds = source.objectIds.filter((objectId) => {
    const objectSegments = source.segments.filter(
      (segment) => segment.objectId === objectId
    );
    return core.some(
      (point) => nearest(point, objectSegments).distance <= SOURCE_USAGE_DISTANCE_M
    );
  });
  const unusedObjectIds = source.objectIds.filter(
    (objectId) => !usedObjectIds.includes(objectId)
  );
  if (unusedObjectIds.length > 0) {
    errors.push(`USGS objects do not contribute: ${unusedObjectIds.join(",")}`);
  }

  const result = {
    route_id: route.id,
    route_name: route.name,
    passed: errors.length === 0,
    errors,
    metrics: {
      route_points: points.length,
      core_samples: core.length,
      start_connector_m: startConnectorM,
      end_connector_m: endConnectorM,
      core_max_offset_m: coreMaxOffsetM,
      core_p95_offset_m: coreP95OffsetM,
      core_coverage_pct: coreCoveragePct,
      cited_object_count: source.objectIds.length,
      used_object_count: usedObjectIds.length,
    },
    used_object_ids: usedObjectIds,
  };
  if (format === "json") {
    console.log(
      JSON.stringify({
        checked_at: new Date().toISOString(),
        verdict: result.passed ? "PASS" : "FAIL",
        results: [result],
      })
    );
  } else {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${route.name} (${route.id})`
    );
    console.log(
      `  connectors: ${startConnectorM.toFixed(1)} m / ` +
        `${endConnectorM.toFixed(1)} m; core max ` +
        `${coreMaxOffsetM.toFixed(2)} m, p95 ` +
        `${coreP95OffsetM.toFixed(2)} m, coverage ` +
        `${coreCoveragePct.toFixed(2)}%`
    );
    for (const error of errors) console.log(`  ERROR: ${error}`);
  }
  if (!result.passed) process.exitCode = 2;
} finally {
  await db.end();
}
