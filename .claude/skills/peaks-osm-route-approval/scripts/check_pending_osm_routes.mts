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
const WAY_USAGE_DISTANCE_M = 5;

type Options = {
  routeIds: string[];
  replaceActiveRouteId: string;
  format: "summary" | "json";
};

type LatLng = {
  lat: number;
  lng: number;
};

type OsmNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
};

type OsmWay = {
  type: "way";
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
};

type SourceSegment = {
  wayId: number;
  start: LatLng;
  end: LatLng;
};

type RouteProvenance = {
  source_kind: string;
  source_url: string;
  license_name: string;
  license_url: string;
  attribution: string;
  retrieved_at: string;
  osm_way_ids: number[];
  osm_way_urls: string[];
  contains_osm_geometry: boolean;
};

type RouteRow = {
  id: string;
  name: string;
  owner: string;
  status: string;
  shape: "out_and_back" | "loop" | "point_to_point" | "lollipop" | null;
  provenance: RouteProvenance | null;
  provenance_valid: boolean;
  is_simple: boolean;
  active_standard_exists: boolean;
  replacement_route_valid: boolean;
  linked_destinations: Array<{
    id: string;
    name: string;
    ordinal: number;
    features: string[];
    lat: number;
    lng: number;
  }>;
  segment_count: number;
  segment_provenance_matches: boolean;
};

type CheckResult = {
  route_id: string;
  route_name: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    route_points: number;
    core_samples: number;
    start_connector_m: number;
    end_connector_m: number;
    return_connector_m: number;
    core_max_offset_m: number;
    core_p95_offset_m: number;
    core_coverage_pct: number;
    cited_way_count: number;
    used_way_count: number;
  };
  used_way_ids: number[];
  foot_access_override_way_ids: number[];
};

function usage(): string {
  return [
    "Usage:",
    "  tsx check_pending_osm_routes.mts --route-id ID [--route-id ID ...]",
    "      [--replace-active-route ID] [--format summary|json]",
    "",
    "Read-only. Compares pending route geometry with its current cited OSM ways.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const routeIds: string[] = [];
  let replaceActiveRouteId = "";
  let format: Options["format"] = "summary";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--route-id") {
      routeIds.push(argv[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--route-id=")) {
      routeIds.push(arg.slice("--route-id=".length));
    } else if (arg === "--replace-active-route") {
      replaceActiveRouteId = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--replace-active-route=")) {
      replaceActiveRouteId = arg.slice(
        "--replace-active-route=".length
      );
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (value !== "summary" && value !== "json") {
        throw new Error("--format must be summary or json");
      }
      format = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const uniqueIds = [...new Set(routeIds)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))
  ) {
    throw new Error("At least one valid --route-id is required");
  }
  if (
    replaceActiveRouteId &&
    !/^[A-Za-z0-9_-]+$/.test(replaceActiveRouteId)
  ) {
    throw new Error("--replace-active-route must be a valid route id");
  }
  return { routeIds: uniqueIds, replaceActiveRouteId, format };
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const radiusM = 6371000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
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
  const radiusM = 6371000;
  const latScale = (Math.PI / 180) * radiusM;
  const lngScale =
    latScale * Math.cos((point.lat * Math.PI) / 180);
  const ax = (segment.start.lng - point.lng) * lngScale;
  const ay = (segment.start.lat - point.lat) * latScale;
  const bx = (segment.end.lng - point.lng) * lngScale;
  const by = (segment.end.lat - point.lat) * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t =
    denominator === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function nearestSource(
  point: LatLng,
  segments: SourceSegment[]
): { distance: number; wayId: number } {
  let distance = Number.POSITIVE_INFINITY;
  let wayId = -1;
  for (const segment of segments) {
    const candidate = pointToSegmentMeters(point, segment);
    if (candidate < distance) {
      distance = candidate;
      wayId = segment.wayId;
    }
  }
  return { distance, wayId };
}

function sampleCore(
  points: LatLng[],
  excludedSegmentIndexes = new Set<number>()
): LatLng[] {
  const samples: LatLng[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    if (excludedSegmentIndexes.has(index)) continue;
    const start = points[index];
    const end = points[index + 1];
    const distance = haversineMeters(start, end);
    const steps = Math.max(1, Math.ceil(distance / CORE_SAMPLE_STEP_M));
    for (let step = 0; step < steps; step += 1) {
      const fraction = step / steps;
      samples.push({
        lat: start.lat + (end.lat - start.lat) * fraction,
        lng: start.lng + (end.lng - start.lng) * fraction,
      });
    }
  }
  if (!excludedSegmentIndexes.has(points.length - 2)) {
    samples.push(points[points.length - 2]);
  }
  return samples;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index];
}

function pointsMatch(
  left: LatLng,
  right: LatLng,
  toleranceM = 0.25
): boolean {
  return haversineMeters(left, right) <= toleranceM;
}

function segmentsMatch(
  leftStart: LatLng,
  leftEnd: LatLng,
  rightStart: LatLng,
  rightEnd: LatLng
): boolean {
  return (
    (
      pointsMatch(leftStart, rightStart) &&
      pointsMatch(leftEnd, rightEnd)
    ) ||
    (
      pointsMatch(leftStart, rightEnd) &&
      pointsMatch(leftEnd, rightStart)
    )
  );
}

function pointOnSegmentInterior(
  point: LatLng,
  start: LatLng,
  end: LatLng,
  toleranceM = 0.25
): boolean {
  const latitude = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const xScale = 111_320 * Math.cos(latitude);
  const yScale = 110_540;
  const px = (point.lng - start.lng) * xScale;
  const py = (point.lat - start.lat) * yScale;
  const ex = (end.lng - start.lng) * xScale;
  const ey = (end.lat - start.lat) * yScale;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared <= toleranceM * toleranceM) return false;
  const fraction = (px * ex + py * ey) / lengthSquared;
  const endpointMargin = toleranceM / Math.sqrt(lengthSquared);
  if (fraction <= endpointMargin || fraction >= 1 - endpointMargin) {
    return false;
  }
  return Math.hypot(px - fraction * ex, py - fraction * ey) <= toleranceM;
}

function lollipopRetraceCheck(points: LatLng[]): {
  valid: boolean;
  retracedPairs: number;
} {
  const segmentCount = points.length - 1;
  if (!pointsMatch(points[0], points[points.length - 1])) {
    return { valid: false, retracedPairs: 0 };
  }

  const retracedPairs: Array<{ left: number; right: number }> = [];
  for (let leftIndex = 0; leftIndex < points.length - 1; leftIndex += 1) {
    const leftStart = points[leftIndex];
    const leftEnd = points[leftIndex + 1];
    for (
      let rightIndex = leftIndex + 2;
      rightIndex < points.length - 1;
      rightIndex += 1
    ) {
      const rightStart = points[rightIndex];
      const rightEnd = points[rightIndex + 1];
      const isRetrace = segmentsMatch(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd
      );
      if (isRetrace) {
        retracedPairs.push({ left: leftIndex, right: rightIndex });
        continue;
      }
      if (
        pointOnSegmentInterior(leftStart, rightStart, rightEnd) ||
        pointOnSegmentInterior(leftEnd, rightStart, rightEnd) ||
        pointOnSegmentInterior(rightStart, leftStart, leftEnd) ||
        pointOnSegmentInterior(rightEnd, leftStart, leftEnd)
      ) {
        return { valid: false, retracedPairs: retracedPairs.length };
      }
      if (
        pointsMatch(leftStart, rightStart) ||
        pointsMatch(leftStart, rightEnd) ||
        pointsMatch(leftEnd, rightStart) ||
        pointsMatch(leftEnd, rightEnd)
      ) {
        continue;
      }

      const latitude =
        (leftStart.lat + leftEnd.lat + rightStart.lat + rightEnd.lat) / 4;
      const lngScale = Math.cos(latitude * Math.PI / 180);
      const ax = leftStart.lng * lngScale;
      const ay = leftStart.lat;
      const bx = leftEnd.lng * lngScale;
      const by = leftEnd.lat;
      const cx = rightStart.lng * lngScale;
      const cy = rightStart.lat;
      const dx = rightEnd.lng * lngScale;
      const dy = rightEnd.lat;
      const rx = bx - ax;
      const ry = by - ay;
      const sx = dx - cx;
      const sy = dy - cy;
      const denominator = rx * sy - ry * sx;
      const qpx = cx - ax;
      const qpy = cy - ay;
      const crossQpR = qpx * ry - qpy * rx;
      if (Math.abs(denominator) < 1e-14) {
        if (Math.abs(crossQpR) < 1e-14) {
          return { valid: false, retracedPairs: retracedPairs.length };
        }
        continue;
      }
      const t = (qpx * sy - qpy * sx) / denominator;
      const u = crossQpR / denominator;
      const withinLeft = t >= -1e-8 && t <= 1 + 1e-8;
      const withinRight = u >= -1e-8 && u <= 1 + 1e-8;
      const leftInterior = t > 1e-8 && t < 1 - 1e-8;
      const rightInterior = u > 1e-8 && u < 1 - 1e-8;
      if (
        withinLeft &&
        withinRight &&
        (leftInterior || rightInterior)
      ) {
        return { valid: false, retracedPairs: retracedPairs.length };
      }
    }
  }
  if (retracedPairs.length === 0) {
    return { valid: false, retracedPairs: 0 };
  }

  const groups: Array<Array<{ left: number; right: number }>> = [];
  for (const pair of retracedPairs) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (
      previous &&
      pair.left === previous.left + 1 &&
      pair.right === previous.right - 1
    ) {
      group.push(pair);
    } else {
      groups.push([pair]);
    }
  }
  const groupIsJoinedStem = (
    group: Array<{ left: number; right: number }>
  ): boolean => {
    const lastPair = group[group.length - 1];
    return pointsMatch(
      points[lastPair.left + 1],
      points[lastPair.right]
    );
  };
  if (!groups.every(groupIsJoinedStem)) {
    return { valid: false, retracedPairs: retracedPairs.length };
  }

  const endpointGroup = groups.find(
    (group) =>
      group[0].left === 0 &&
      group[0].right === segmentCount - 1
  );
  if (groups.length === 1) {
    return {
      valid: true,
      retracedPairs: retracedPairs.length,
    };
  }
  if (groups.length !== 2 || !endpointGroup) {
    return { valid: false, retracedPairs: retracedPairs.length };
  }
  const endpointConnectorLengthM = endpointGroup.reduce(
    (total, pair) =>
      total + haversineMeters(points[pair.left], points[pair.left + 1]),
    0
  );
  return {
    valid: endpointConnectorLengthM <= CONNECTOR_MAX_OFFSET_M,
    retracedPairs: retracedPairs.length,
  };
}

function footAccess(
  way: OsmWay
): { blocked: boolean; override: boolean } {
  const tags = way.tags ?? {};
  const footAllows = ["yes", "designated", "permissive", "permit"].includes(
    tags.foot ?? ""
  );
  const footBlocks = ["no", "private"].includes(tags.foot ?? "");
  const genericBlocks = ["no", "private"].includes(tags.access ?? "");
  return {
    blocked: footBlocks || (genericBlocks && !footAllows),
    override:
      (genericBlocks && footAllows) ||
      tags.foot === "permit" ||
      tags.access === "permit",
  };
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
                  'name', d.name,
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
              SELECT count(*)::int
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
  if (result.rows.length !== 1) {
    throw new Error(`Route not found: ${routeId}`);
  }
  const row = result.rows[0];
  row.linked_destinations = Array.isArray(row.linked_destinations)
    ? row.linked_destinations
    : [];
  return row;
}

async function loadRoutePoints(routeId: string): Promise<LatLng[]> {
  const result = await db.query(
    `SELECT ST_Y((dp).geom) AS lat, ST_X((dp).geom) AS lng
     FROM routes r
     CROSS JOIN LATERAL ST_DumpPoints(r.path::geometry) dp
     WHERE r.id = $1
     ORDER BY (dp).path[1]`,
    [routeId]
  );
  return result.rows.map((row) => ({
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

const wayCache = new Map<number, Promise<{ way: OsmWay; nodes: Map<number, OsmNode> }>>();

async function fetchWay(
  wayId: number
): Promise<{ way: OsmWay; nodes: Map<number, OsmNode> }> {
  let pending = wayCache.get(wayId);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(
        `https://api.openstreetmap.org/api/0.6/way/${wayId}/full.json`,
        {
          headers: {
            "user-agent":
              process.env.PEAKS_OSM_USER_AGENT ??
              "Peaks OSM route approval/1.0",
          },
        }
      );
      if (!response.ok) {
        throw new Error(`OSM way ${wayId} returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        elements?: Array<OsmNode | OsmWay>;
      };
      const elements = payload.elements ?? [];
      const way = elements.find(
        (element): element is OsmWay =>
          element.type === "way" && element.id === wayId
      );
      if (!way) throw new Error(`OSM response omitted way ${wayId}`);
      const nodes = new Map<number, OsmNode>();
      for (const element of elements) {
        if (element.type === "node") nodes.set(element.id, element);
      }
      return { way, nodes };
    })();
    wayCache.set(wayId, pending);
  }
  return pending;
}

async function sourceGeometry(wayIds: number[]): Promise<{
  segments: SourceSegment[];
  blockedWayIds: number[];
  overrideWayIds: number[];
}> {
  const fetched = await Promise.all(wayIds.map(fetchWay));
  const segments: SourceSegment[] = [];
  const blockedWayIds: number[] = [];
  const overrideWayIds: number[] = [];

  for (const { way, nodes } of fetched) {
    const access = footAccess(way);
    if (access.blocked) blockedWayIds.push(way.id);
    if (access.override) overrideWayIds.push(way.id);
    const nodeIds = way.nodes ?? [];
    for (let index = 1; index < nodeIds.length; index += 1) {
      const start = nodes.get(nodeIds[index - 1]);
      const end = nodes.get(nodeIds[index]);
      if (!start || !end) {
        throw new Error(`OSM way ${way.id} is missing node geometry`);
      }
      segments.push({
        wayId: way.id,
        start: { lat: start.lat, lng: start.lon },
        end: { lat: end.lat, lng: end.lon },
      });
    }
  }
  return { segments, blockedWayIds, overrideWayIds };
}

function emptyMetrics(): CheckResult["metrics"] {
  return {
    route_points: 0,
    core_samples: 0,
    start_connector_m: Number.POSITIVE_INFINITY,
    end_connector_m: Number.POSITIVE_INFINITY,
    return_connector_m: Number.POSITIVE_INFINITY,
    core_max_offset_m: Number.POSITIVE_INFINITY,
    core_p95_offset_m: Number.POSITIVE_INFINITY,
    core_coverage_pct: 0,
    cited_way_count: 0,
    used_way_count: 0,
  };
}

async function checkRoute(
  routeId: string,
  replaceActiveRouteId: string
): Promise<CheckResult> {
  const route = await loadRoute(routeId, replaceActiveRouteId);
  const result: CheckResult = {
    route_id: route.id,
    route_name: route.name,
    passed: false,
    errors: [],
    warnings: [],
    metrics: emptyMetrics(),
    used_way_ids: [],
    foot_access_override_way_ids: [],
  };

  if (route.owner !== "peaks") {
    result.errors.push(`owner is ${route.owner}, not peaks`);
  }
  if (route.status !== "pending") {
    result.errors.push(`status is ${route.status}, not pending`);
  }
  if (!route.provenance || !route.provenance_valid) {
    result.errors.push("route provenance is missing or invalid");
  }
  if (route.active_standard_exists) {
    result.errors.push("an active Peaks standard route already covers the summit");
  }
  if (!route.replacement_route_valid) {
    result.errors.push("named active replacement route is not eligible");
  }
  if (route.segment_count < 1 || !route.segment_provenance_matches) {
    result.errors.push("route and source segment provenance do not agree");
  }

  const destinations = route.linked_destinations;
  const first = destinations[0];
  const last = destinations[destinations.length - 1];
  if (!first?.features?.includes("trailhead")) {
    result.errors.push("first linked destination is not a trailhead");
  }
  if (!last?.features?.includes("summit")) {
    result.errors.push("last linked destination is not a summit");
  }

  const provenance = route.provenance;
  if (!provenance) return result;
  const wayIds = Array.isArray(provenance.osm_way_ids)
    ? provenance.osm_way_ids
    : [];
  result.metrics.cited_way_count = wayIds.length;
  if (
    provenance.source_kind !== "openstreetmap" ||
    provenance.contains_osm_geometry !== true ||
    wayIds.length === 0
  ) {
    result.errors.push("provenance does not identify OSM geometry and ways");
    return result;
  }

  const points = await loadRoutePoints(routeId);
  result.metrics.route_points = points.length;
  if (points.length < 5) {
    result.errors.push("route has fewer than five geometry points");
    return result;
  }
  if (!route.is_simple) {
    const retrace = lollipopRetraceCheck(points);
    if (route.shape !== "lollipop" || !retrace.valid) {
      result.errors.push("route geometry is not simple");
    } else {
      result.warnings.push(
        `lollipop geometry has ${retrace.retracedPairs} exact retraced segments`
      );
    }
  }

  const trailhead = destinations[0];
  const summit = destinations[destinations.length - 1];
  const trailheadPoint = {
    lat: Number(trailhead?.lat),
    lng: Number(trailhead?.lng),
  };
  const summitPoint = {
    lat: Number(summit?.lat),
    lng: Number(summit?.lng),
  };
  const loopLike = route.shape === "loop" || route.shape === "lollipop";
  let summitIndex = points.length - 1;
  if (loopLike) {
    let nearestSummitDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = haversineMeters(point, summitPoint);
      if (distance < nearestSummitDistance) {
        nearestSummitDistance = distance;
        summitIndex = index;
      }
    });
    if (
      summitIndex === 0 ||
      summitIndex === points.length - 1 ||
      nearestSummitDistance > 20
    ) {
      result.errors.push(
        `loop summit is ${nearestSummitDistance.toFixed(1)} m from stored geometry`
      );
    }
  }
  const trailheadStartDistance = haversineMeters(points[0], trailheadPoint);
  const routeEndTarget = loopLike ? trailheadPoint : summitPoint;
  const routeEndDistance = haversineMeters(
    points[points.length - 1],
    routeEndTarget
  );
  if (trailheadStartDistance > 20) {
    result.errors.push(
      `stored route starts ${trailheadStartDistance.toFixed(1)} m from its trailhead`
    );
  }
  if (routeEndDistance > 20) {
    result.errors.push(
      `stored route ends ${routeEndDistance.toFixed(1)} m from its ` +
        `${loopLike ? "trailhead" : "summit"}`
    );
  }

  const source = await sourceGeometry(wayIds);
  if (source.segments.length === 0) {
    result.errors.push("cited OSM ways contain no line segments");
    return result;
  }
  if (source.blockedWayIds.length > 0) {
    result.errors.push(
      `pedestrian access is blocked on OSM ways ${source.blockedWayIds.join(",")}`
    );
  }
  result.foot_access_override_way_ids = source.overrideWayIds;
  if (source.overrideWayIds.length > 0) {
    result.warnings.push(
      `conditional or foot-specific access requires review on ways ` +
        source.overrideWayIds.join(",")
    );
  }

  const startConnector = nearestSource(points[0], source.segments).distance;
  const summitConnector = nearestSource(
    points[summitIndex],
    source.segments
  ).distance;
  const returnConnector = loopLike
    ? nearestSource(points[points.length - 1], source.segments).distance
    : summitConnector;
  result.metrics.start_connector_m = startConnector;
  result.metrics.end_connector_m = summitConnector;
  result.metrics.return_connector_m = returnConnector;
  if (startConnector > CONNECTOR_MAX_OFFSET_M) {
    result.errors.push(
      `trailhead connector is ${startConnector.toFixed(1)} m from cited OSM geometry`
    );
  }
  if (summitConnector > CONNECTOR_MAX_OFFSET_M) {
    result.errors.push(
      `summit connector is ${summitConnector.toFixed(1)} m from cited OSM geometry`
    );
  }
  if (loopLike && returnConnector > CONNECTOR_MAX_OFFSET_M) {
    result.errors.push(
      `return trailhead connector is ${returnConnector.toFixed(1)} m from ` +
        `cited OSM geometry`
    );
  }

  const excludedCoreSegments = new Set<number>();
  if (loopLike) {
    const inboundSummitLegM = haversineMeters(
      points[summitIndex - 1],
      points[summitIndex]
    );
    const outboundSummitLegM = haversineMeters(
      points[summitIndex],
      points[summitIndex + 1]
    );
    if (
      inboundSummitLegM > CONNECTOR_MAX_OFFSET_M ||
      outboundSummitLegM > CONNECTOR_MAX_OFFSET_M
    ) {
      result.errors.push(
        `summit connector legs are ${inboundSummitLegM.toFixed(1)} m and ` +
          `${outboundSummitLegM.toFixed(1)} m; each must be at most ` +
          `${CONNECTOR_MAX_OFFSET_M} m`
      );
    } else {
      excludedCoreSegments.add(summitIndex - 1);
      excludedCoreSegments.add(summitIndex);
    }
  }
  const samples = sampleCore(points, excludedCoreSegments);
  result.metrics.core_samples = samples.length;
  const nearest = samples.map((point) =>
    nearestSource(point, source.segments)
  );
  const offsets = nearest.map((item) => item.distance);
  const maximum = Math.max(...offsets);
  const p95 = percentile(offsets, 0.95);
  const coverage =
    offsets.filter((offset) => offset <= CORE_COVERAGE_DISTANCE_M).length /
    offsets.length;
  result.metrics.core_max_offset_m = maximum;
  result.metrics.core_p95_offset_m = p95;
  result.metrics.core_coverage_pct = coverage * 100;

  if (maximum > CORE_MAX_OFFSET_M) {
    result.errors.push(
      `maximum core offset is ${maximum.toFixed(2)} m`
    );
  }
  if (p95 > CORE_P95_OFFSET_M) {
    result.errors.push(`p95 core offset is ${p95.toFixed(2)} m`);
  }
  if (coverage < CORE_MIN_COVERAGE) {
    result.errors.push(
      `only ${(coverage * 100).toFixed(2)}% of core samples are within ` +
        `${CORE_COVERAGE_DISTANCE_M} m`
    );
  }

  const usedWayIds = wayIds.filter((wayId) => {
    const waySegments = source.segments.filter(
      (segment) => segment.wayId === wayId
    );
    return samples.some(
      (point) =>
        nearestSource(point, waySegments).distance <= WAY_USAGE_DISTANCE_M
    );
  });
  result.used_way_ids = usedWayIds;
  result.metrics.used_way_count = usedWayIds.length;
  const unusedWayIds = wayIds.filter((wayId) => !usedWayIds.includes(wayId));
  if (unusedWayIds.length > 0) {
    result.errors.push(
      `cited OSM ways do not contribute to the stored route: ` +
        unusedWayIds.join(",")
    );
  }

  result.passed = result.errors.length === 0;
  return result;
}

function printSummary(result: CheckResult): void {
  const metrics = result.metrics;
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.route_name} ` +
      `(${result.route_id})`
  );
  console.log(
    `  connectors: ${metrics.start_connector_m.toFixed(1)} m / ` +
      `${metrics.end_connector_m.toFixed(1)} m; core max ` +
      `${metrics.core_max_offset_m.toFixed(2)} m, p95 ` +
      `${metrics.core_p95_offset_m.toFixed(2)} m, coverage ` +
      `${metrics.core_coverage_pct.toFixed(2)}%`
  );
  console.log(
    `  OSM ways: ${metrics.used_way_count}/${metrics.cited_way_count}; ` +
      `${metrics.core_samples} samples`
  );
  for (const warning of result.warnings) console.log(`  WARN: ${warning}`);
  for (const error of result.errors) console.log(`  ERROR: ${error}`);
}

const options = parseArgs(process.argv.slice(2));

try {
  const results: CheckResult[] = [];
  for (const routeId of options.routeIds) {
    try {
      results.push(
        await checkRoute(routeId, options.replaceActiveRouteId)
      );
    } catch (error) {
      results.push({
        route_id: routeId,
        route_name: routeId,
        passed: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        metrics: emptyMetrics(),
        used_way_ids: [],
        foot_access_override_way_ids: [],
      });
    }
  }

  if (options.format === "json") {
    console.log(
      JSON.stringify({
        checked_at: new Date().toISOString(),
        verdict: results.every((result) => result.passed) ? "PASS" : "FAIL",
        results,
      })
    );
  } else {
    for (const result of results) printSummary(result);
  }
  if (results.some((result) => !result.passed)) process.exitCode = 2;
} finally {
  await db.end();
}
