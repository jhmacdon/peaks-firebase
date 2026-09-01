#!/usr/bin/env node

import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import type {
  LatLng,
  OfficialNetworkPath,
  OfficialRouteReview,
} from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialRouteGeometryImport from "../../../../cloud-sql/migrate/src/official-route-geometry";
import usgsTrailsSourceImport from "../../../../cloud-sql/migrate/src/usgs-trails-source";

const {
  haversineMeters,
  isSimpleClosedRoute,
  reviewLollipopRetrace,
  reviewOfficialRouteGeometry,
} = officialRouteGeometryImport;
const {
  assertExactUsgsTrailObjectIds,
  buildUsgsTrailAttribution,
  normalizeUsgsTrailOriginators,
  parseUsgsTrailsQueryUrl,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
  usgsTrailOriginatorFromProperties,
} = usgsTrailsSourceImport;

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

const CORE_MIN_COVERAGE_PCT = 99;
const CORE_MAX_OFFSET_M = 5;
const CORE_P95_OFFSET_M = 2;
const CONNECTOR_MAX_OFFSET_M = 125;
const CONNECTOR_JOIN_MAX_OFFSET_M = 5;
const DESTINATION_CONTACT_MAX_M = 20;

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
    license_url?: string;
    attribution?: string;
    contains_osm_geometry?: boolean;
    osm_way_ids?: unknown[];
  } | null;
  provenance_valid: boolean;
  is_simple: boolean;
  active_standard_exists: boolean;
  replacement_route_valid: boolean;
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
    "Usage: check_pending_usgs_routes.mts --route-id ID " +
      "[--replace-active-route ID] [--format summary|json]"
  );
  process.exit(0);
}

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index < 0 ? "" : argv[index + 1] ?? "";
}

async function loadRoute(
  routeId: string,
  replaceActiveRouteId: string
): Promise<RouteRow> {
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
                AND (
                  $2 = ''
                  OR (
                    active_route.id <> $2
                    AND lower(active_route.name) = lower(r.name)
                  )
                )
            ) AS active_standard_exists,
            CASE
              WHEN $2 = '' THEN true
              ELSE EXISTS (
                SELECT 1
                FROM route_destinations target_rd
                JOIN destinations target_destination
                  ON target_destination.id = target_rd.destination_id
                JOIN route_destinations replacement_rd
                  ON replacement_rd.destination_id = target_rd.destination_id
                JOIN routes replacement_route
                  ON replacement_route.id = replacement_rd.route_id
                WHERE target_rd.route_id = r.id
                  AND 'summit'::destination_feature =
                      ANY(target_destination.features)
                  AND replacement_route.id = $2
                  AND replacement_route.owner = 'peaks'
                  AND replacement_route.status = 'active'
              )
            END AS replacement_route_valid,
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
    [routeId, replaceActiveRouteId]
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
  paths: OfficialNetworkPath[];
  objectIds: number[];
  attribution: string;
}> {
  const expectedObjectIds = parseUsgsTrailsQueryUrl(sourceUrl);
  const url = new URL(sourceUrl);
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
    error?: { code?: unknown; message?: unknown };
    features?: Array<{
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  if (payload.error) {
    throw new Error(
      `USGS National Map returned ArcGIS error ${String(
        payload.error.code ?? "unknown"
      )}: ${String(payload.error.message ?? "unknown")}`
    );
  }
  if (!Array.isArray(payload.features)) {
    throw new Error("USGS source returned no feature array");
  }
  const paths: OfficialNetworkPath[] = [];
  const returnedObjectIds: number[] = [];
  for (const feature of payload.features) {
    const properties = feature.properties ?? {};
    const objectId = Number(
      properties.objectid ?? properties.OBJECTID ?? properties.ObjectID
    );
    if (!Number.isSafeInteger(objectId) || objectId <= 0) {
      throw new Error("USGS source returned an invalid object ID");
    }
    if (!expectedObjectIds.includes(objectId)) {
      throw new Error(`USGS source returned unexpected object ID ${objectId}`);
    }
    returnedObjectIds.push(objectId);
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
          !Number.isFinite(coordinate[1]) ||
          Number(coordinate[0]) < -180 ||
          Number(coordinate[0]) > 180 ||
          Number(coordinate[1]) < -90 ||
          Number(coordinate[1]) > 90
        ) {
          throw new Error("USGS source returned invalid coordinates");
        }
        return [Number(coordinate[0]), Number(coordinate[1])] as [
          number,
          number,
        ];
      });
      if (line.length < 2) {
        throw new Error(`USGS object ${objectId} returned a short line`);
      }
      paths.push({
        featureId: String(objectId),
        properties,
        coordinates: line,
        names: [],
        access: [],
      });
    }
  }
  assertExactUsgsTrailObjectIds(expectedObjectIds, returnedObjectIds);
  if (paths.length === 0) throw new Error("USGS source returned no lines");
  const originators = normalizeUsgsTrailOriginators(
    paths.map(({ properties }) =>
      usgsTrailOriginatorFromProperties(properties)
    )
  );
  return {
    paths,
    objectIds: expectedObjectIds,
    attribution: buildUsgsTrailAttribution(originators),
  };
}

function failedReview(): OfficialRouteReview {
  return {
    startConnectorM: Number.POSITIVE_INFINITY,
    endConnectorM: Number.POSITIVE_INFINITY,
    startConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
    endConnectorJoinOffsetM: Number.POSITIVE_INFINITY,
    internalConnectorMaxM: Number.POSITIVE_INFINITY,
    internalConnectorJoinMaxOffsetM: Number.POSITIVE_INFINITY,
    coreMaxOffsetM: Number.POSITIVE_INFINITY,
    coreP95OffsetM: Number.POSITIVE_INFINITY,
    coreCoveragePct: 0,
    coreSampleCount: 0,
    sourceTopologyValid: false,
    usedFeatureIds: [],
    unusedFeatureIds: [],
  };
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) usage();
const routeId = valueAfter(argv, "--route-id");
const replaceActiveRouteId = valueAfter(argv, "--replace-active-route");
const format = valueAfter(argv, "--format") || "summary";
if (!/^[A-Za-z0-9_-]+$/.test(routeId)) {
  throw new Error("--route-id is required");
}
if (format !== "summary" && format !== "json") {
  throw new Error("--format must be summary or json");
}
if (
  replaceActiveRouteId &&
  !/^[A-Za-z0-9_-]+$/.test(replaceActiveRouteId)
) {
  throw new Error("--replace-active-route must be a valid route id");
}

try {
  const route = await loadRoute(routeId, replaceActiveRouteId);
  const errors: string[] = [];
  if (route.owner !== "peaks") errors.push("route owner is not peaks");
  if (route.status !== "pending") errors.push("route status is not pending");
  if (!route.provenance_valid || !route.provenance) {
    errors.push("route provenance is missing or invalid");
  }
  if (route.active_standard_exists) {
    errors.push("an active Peaks route already covers the summit");
  }
  if (!route.replacement_route_valid) {
    errors.push("named active replacement route is not eligible");
  }
  if (
    route.shape !== "out_and_back" &&
    route.shape !== "loop" &&
    route.shape !== "lollipop"
  ) {
    errors.push("route shape is not supported for a standard hiking route");
  }
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
    provenance.license_name !== USGS_TRAILS_LICENSE_NAME ||
    provenance.license_url !== USGS_TRAILS_LICENSE_URL ||
    provenance.contains_osm_geometry !== false ||
    (provenance.osm_way_ids?.length ?? 0) !== 0
  ) {
    errors.push("provenance does not identify public-domain USGS geometry");
  }

  const points = await loadRoutePoints(routeId);
  if (points.length < 5) errors.push("route has fewer than five points");
  const loopLike = route.shape === "loop" || route.shape === "lollipop";
  if (route.shape === "loop") {
    if (!isSimpleClosedRoute(points)) {
      errors.push("stored loop is not a simple closed route");
    }
  } else if (route.shape === "lollipop") {
    const retrace = reviewLollipopRetrace(points);
    if (!retrace.valid) {
      errors.push(
        "stored lollipop lacks one safe retraced stem and a non-retraced loop"
      );
    }
  } else if (!route.is_simple) {
    errors.push("stored route geometry is not simple");
  }
  let summitIndex = points.length - 1;
  let summitContactM = Number.POSITIVE_INFINITY;
  if (summit && points.length > 0) {
    points.forEach((point, index) => {
      const distance = haversineMeters(point, summit);
      if (distance < summitContactM) {
        summitContactM = distance;
        summitIndex = index;
      }
    });
  }
  const internalSummitValid =
    loopLike &&
    summitIndex > 0 &&
    summitIndex < points.length - 1 &&
    summitContactM <= DESTINATION_CONTACT_MAX_M;
  if (loopLike && !internalSummitValid) {
    errors.push(
      `loop summit is ${summitContactM.toFixed(1)} m from stored geometry`
    );
  }
  const source = provenance?.source_url
    ? await fetchSource(provenance.source_url)
    : { paths: [], objectIds: [], attribution: "" };
  if (provenance?.attribution !== source.attribution) {
    errors.push("USGS attribution does not match the fetched source originators");
  }
  const review =
    source.paths.length > 0 && source.objectIds.length > 0
      ? reviewOfficialRouteGeometry(
          points,
          source.paths,
          source.objectIds.map(String),
          {
            internalConnectorSegmentIndexes: internalSummitValid
              ? [summitIndex - 1, summitIndex]
              : [],
          }
        )
      : failedReview();
  const gatedEndConnectorM = loopLike
    ? Math.max(review.endConnectorM, review.internalConnectorMaxM)
    : review.endConnectorM;
  if (review.startConnectorM > CONNECTOR_MAX_OFFSET_M) {
    errors.push(
      `trailhead connector length is ${review.startConnectorM.toFixed(1)} m`
    );
  }
  if (review.startConnectorJoinOffsetM > CONNECTOR_JOIN_MAX_OFFSET_M) {
    errors.push(
      `trailhead connector joins USGS geometry ` +
        `${review.startConnectorJoinOffsetM.toFixed(1)} m away`
    );
  }
  if (review.endConnectorM > CONNECTOR_MAX_OFFSET_M) {
    errors.push(
      `${loopLike ? "return trailhead" : "summit"} connector length is ` +
        `${review.endConnectorM.toFixed(1)} m`
    );
  }
  if (review.endConnectorJoinOffsetM > CONNECTOR_JOIN_MAX_OFFSET_M) {
    errors.push(
      `${loopLike ? "return trailhead" : "summit"} connector joins USGS ` +
        `geometry ${review.endConnectorJoinOffsetM.toFixed(1)} m away`
    );
  }
  if (loopLike && review.internalConnectorMaxM > CONNECTOR_MAX_OFFSET_M) {
    errors.push(
      `summit connector leg is ${review.internalConnectorMaxM.toFixed(1)} m`
    );
  }
  if (
    loopLike &&
    review.internalConnectorJoinMaxOffsetM > CONNECTOR_JOIN_MAX_OFFSET_M
  ) {
    errors.push(
      `summit connector joins USGS geometry ` +
        `${review.internalConnectorJoinMaxOffsetM.toFixed(1)} m away`
    );
  }
  if (
    points[0] &&
    trailhead &&
    haversineMeters(points[0], trailhead) > DESTINATION_CONTACT_MAX_M
  ) {
    errors.push("stored route start does not match the trailhead");
  }
  const routeEndTarget = loopLike ? trailhead : summit;
  if (
    points.at(-1) &&
    routeEndTarget &&
    haversineMeters(points.at(-1)!, routeEndTarget) >
      DESTINATION_CONTACT_MAX_M
  ) {
    errors.push(
      `stored route end does not match the ${loopLike ? "trailhead" : "summit"}`
    );
  }
  if (review.coreMaxOffsetM > CORE_MAX_OFFSET_M) {
    errors.push(`maximum core offset is ${review.coreMaxOffsetM.toFixed(2)} m`);
  }
  if (review.coreP95OffsetM > CORE_P95_OFFSET_M) {
    errors.push(`p95 core offset is ${review.coreP95OffsetM.toFixed(2)} m`);
  }
  if (review.coreCoveragePct < CORE_MIN_COVERAGE_PCT) {
    errors.push(`core coverage is ${review.coreCoveragePct.toFixed(2)}%`);
  }
  if (!review.sourceTopologyValid) {
    errors.push(
      "route changes USGS source lines outside reviewed endpoint joins"
    );
  }
  const usedObjectIds = review.usedFeatureIds.map(Number);
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
      core_samples: review.coreSampleCount,
      start_connector_m: review.startConnectorM,
      end_connector_m: gatedEndConnectorM,
      return_connector_m: loopLike ? review.endConnectorM : null,
      summit_connector_m: loopLike
        ? review.internalConnectorMaxM
        : review.endConnectorM,
      start_connector_join_offset_m: review.startConnectorJoinOffsetM,
      end_connector_join_offset_m: review.endConnectorJoinOffsetM,
      summit_connector_join_offset_m: loopLike
        ? review.internalConnectorJoinMaxOffsetM
        : review.endConnectorJoinOffsetM,
      core_max_offset_m: review.coreMaxOffsetM,
      core_p95_offset_m: review.coreP95OffsetM,
      core_coverage_pct: review.coreCoveragePct,
      source_topology_valid: review.sourceTopologyValid,
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
      `  connectors: ${review.startConnectorM.toFixed(1)} m / ` +
        `${gatedEndConnectorM.toFixed(1)} m; core max ` +
        `${review.coreMaxOffsetM.toFixed(2)} m, p95 ` +
        `${review.coreP95OffsetM.toFixed(2)} m, coverage ` +
        `${review.coreCoveragePct.toFixed(2)}%`
    );
    for (const error of errors) console.log(`  ERROR: ${error}`);
  }
  if (!result.passed) process.exitCode = 2;
} finally {
  await db.end();
}
