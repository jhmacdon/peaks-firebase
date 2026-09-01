#!/usr/bin/env node

import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import officialArcgisRequestImport from "../../../../cloud-sql/migrate/src/official-arcgis-request";
import type {
  ArcgisTrailService,
  LatLng,
  OfficialNetworkPath,
  OfficialRouteReview,
} from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialRouteGeometryImport from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialTrailSourcesImport from "../../../../cloud-sql/migrate/src/official-trail-sources";

const { officialArcgisRequestOptions } = officialArcgisRequestImport;

const {
  buildOfficialArcgisQueryUrl,
  haversineMeters,
  isSimpleClosedRoute,
  parseOfficialArcgisPaths,
  parseOfficialFeatureIdsFromSourceUrl,
  reviewLollipopRetrace,
  reviewOfficialRouteGeometry,
} = officialRouteGeometryImport;
const {
  getPublishableArcgisTrailSource,
  reviewOfficialTrailAccess,
} = officialTrailSourcesImport;

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
    osm_way_urls?: unknown[];
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

type RegistrySource = NonNullable<
  ReturnType<typeof getPublishableArcgisTrailSource>
>;

function usage(): never {
  console.log(
    "Usage: check_pending_official_routes.mts --route-id ID " +
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

async function fetchOfficialPaths(
  source: RegistrySource,
  featureIds: string[]
): Promise<OfficialNetworkPath[]> {
  const url = buildOfficialArcgisQueryUrl(source.service, featureIds);
  const response = await fetch(
    url,
    officialArcgisRequestOptions(
      "Peaks official route approval/1.0 " +
        "(https://github.com/jhmacdon/peaks-firebase)"
    )
  );
  if (!response.ok) {
    throw new Error(`${source.authority} returned HTTP ${response.status}`);
  }
  return parseOfficialArcgisPaths(
    (await response.json()) as unknown,
    source.service as ArcgisTrailService,
    featureIds
  );
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
  let source: RegistrySource | null = null;
  const registryId = provenance?.source_kind ?? "";
  try {
    source = registryId ? getPublishableArcgisTrailSource(registryId) ?? null : null;
  } catch (error) {
    errors.push(
      `official source registry lookup failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!source) {
    errors.push("provenance source_kind is not a publishable official source");
  }

  let featureIds: string[] = [];
  if (source && provenance?.source_url) {
    try {
      featureIds = parseOfficialFeatureIdsFromSourceUrl(
        source.service,
        provenance.source_url
      );
    } catch (error) {
      errors.push(
        `official source URL is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else {
    errors.push("provenance does not contain a reusable official source URL");
  }

  if (source && provenance) {
    if (
      provenance.source_kind !== source.id ||
      provenance.license_name !== source.license.name ||
      provenance.license_url !== source.license.url ||
      provenance.attribution !== source.license.attribution ||
      provenance.contains_osm_geometry !== false ||
      (provenance.osm_way_ids?.length ?? 0) !== 0 ||
      (provenance.osm_way_urls?.length ?? 0) !== 0
    ) {
      errors.push("provenance metadata does not match the official source registry");
    }
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
  const paths =
    source && featureIds.length > 0
      ? await fetchOfficialPaths(source, featureIds)
      : [];
  const accessReview = source
    ? reviewOfficialTrailAccess(source, paths)
    : {
        passed: false,
        checkedFeatureIds: [],
        errors: ["official access policy could not be checked"],
      };
  for (const error of accessReview.errors) errors.push(error);
  const review =
    paths.length > 0 && featureIds.length > 0
      ? reviewOfficialRouteGeometry(points, paths, featureIds, {
          internalConnectorSegmentIndexes: internalSummitValid
            ? [summitIndex - 1, summitIndex]
            : [],
        })
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
      `trailhead connector joins official geometry ` +
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
      `${loopLike ? "return trailhead" : "summit"} connector joins official ` +
        `geometry ${review.endConnectorJoinOffsetM.toFixed(1)} m away`
    );
  }
  if (
    loopLike &&
    review.internalConnectorMaxM > CONNECTOR_MAX_OFFSET_M
  ) {
    errors.push(
      `summit connector leg is ${review.internalConnectorMaxM.toFixed(1)} m`
    );
  }
  if (
    loopLike &&
    review.internalConnectorJoinMaxOffsetM > CONNECTOR_JOIN_MAX_OFFSET_M
  ) {
    errors.push(
      `summit connector joins official geometry ` +
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
      "route changes official source lines outside reviewed endpoint joins"
    );
  }
  if (review.unusedFeatureIds.length > 0) {
    errors.push(
      `official features do not contribute: ${review.unusedFeatureIds.join(",")}`
    );
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
      cited_feature_count: featureIds.length,
      used_feature_count: review.usedFeatureIds.length,
      access_policy_passed: accessReview.passed,
      access_feature_count: accessReview.checkedFeatureIds.length,
    },
    used_feature_ids: review.usedFeatureIds,
  };
  const sourceRegistry = source
    ? {
        id: source.id,
        geometry_use: "publishable",
        license_name: source.license.name,
        license_url: source.license.url,
        attribution: source.license.attribution,
      }
    : null;
  if (format === "json") {
    console.log(
      JSON.stringify({
        checked_at: new Date().toISOString(),
        verdict: result.passed ? "PASS" : "FAIL",
        source_registry: sourceRegistry,
        results: [result],
      })
    );
  } else {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${route.name} (${route.id})`
    );
    if (sourceRegistry) {
      console.log(
        `  source: ${sourceRegistry.id}; ${sourceRegistry.license_name}; ` +
          sourceRegistry.attribution
      );
    }
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
