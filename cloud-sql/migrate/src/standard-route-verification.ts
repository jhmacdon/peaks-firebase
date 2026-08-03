type Queryable = {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
};

export interface StandardRouteVerification {
  verdict: "PASS" | "FAIL";
  checked_at: string;
  route_id: string;
  destination_id: string;
  trailhead_id: string;
  route_name: string | null;
  public_url: string;
  public_status: number;
  gates: {
    owner: boolean;
    active: boolean;
    destination_order: boolean;
    segments: boolean;
    provenance: boolean;
    summit_contact: boolean;
    elevation_profile: boolean;
    public_http: boolean;
  };
  errors: string[];
}

type RouteRow = {
  id: string;
  name: string;
  owner: string;
  status: string;
  provenance_valid: boolean;
  point_count: number;
  elevation_string: string | null;
  profile_count: number;
  segment_count: number;
  matching_segment_count: number;
  usable_elevation_segment_count: number;
  ordered_segment_count: number;
  connected_segment_pair_count: number;
  expected_segment_pair_count: number;
  assembled_point_count: number;
  matching_assembly_point_count: number;
  summit_count: number;
  summit_fault_count: number;
  summit_max_gap_meters: number | null;
  endpoint_gap_meters: number | null;
  final_destination_features: string[] | null;
  shape: string | null;
  publish_integrity_valid: boolean;
  destination_ids: string[];
  destination_features: string[][];
};

export const DEFAULT_PEAKS_PUBLIC_WEB_URL =
  "https://peaks-firebase--donner-a8608.us-central1.hosted.app";

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function verifyStandardRoute(
  queryable: Queryable,
  input: {
    routeId: string;
    destinationId: string;
    trailheadId: string;
    publicBaseUrl?: string;
  }
): Promise<StandardRouteVerification> {
  const result = await queryable.query<RouteRow>(
    `WITH ordered_segments AS (
       SELECT rs.route_id,
              rs.ordinal,
              CASE rs.direction
                WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
                ELSE s.path::geometry
              END AS directed_path
       FROM route_segments rs
       JOIN segments s ON s.id = rs.segment_id
       WHERE rs.route_id = $1 AND s.path IS NOT NULL
     ), chained_segments AS (
       SELECT *, lag(directed_path) OVER (ORDER BY ordinal) AS prior_path
       FROM ordered_segments
     ), segment_points AS (
       SELECT ordered_segments.ordinal,
              (dumped).path[1]::int AS segment_vertex,
              (dumped).geom AS geom
       FROM ordered_segments
       CROSS JOIN LATERAL ST_DumpPoints(ordered_segments.directed_path) AS dumped
       WHERE ordered_segments.ordinal = 0 OR (dumped).path[1] > 1
     ), assembled AS (
       SELECT ST_SetSRID(
                ST_MakeLine(geom ORDER BY ordinal, segment_vertex),
                4326
              ) AS path
       FROM segment_points
     ), route_points AS (
       SELECT (dumped).path[1]::int AS vertex, (dumped).geom AS geom
       FROM routes route_for_points
       CROSS JOIN LATERAL ST_DumpPoints(route_for_points.path::geometry) AS dumped
       WHERE route_for_points.id = $1
     ), assembled_points AS (
       SELECT (dumped).path[1]::int AS vertex, (dumped).geom AS geom
       FROM assembled
       CROSS JOIN LATERAL ST_DumpPoints(assembled.path) AS dumped
     )
     SELECT r.id,
            r.name,
            r.owner,
            r.status,
            r.shape::text AS shape,
            is_valid_route_provenance(r.provenance) AS provenance_valid,
            ST_NPoints(r.path::geometry)::int AS point_count,
            r.elevation_string,
            CASE WHEN r.elevation_string IS NOT NULL
                       AND r.elevation_string = encode_route_elevation_profile(r.path)
                 THEN ST_NPoints(r.path::geometry)::int ELSE 0 END AS profile_count,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND s.path IS NOT NULL
            ) AS segment_count,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND s.path IS NOT NULL
                AND s.provenance IS NOT DISTINCT FROM r.provenance
            ) AS matching_segment_count,
            (
              SELECT COUNT(*)::int
              FROM route_segments rs
              JOIN segments s ON s.id = rs.segment_id
              WHERE rs.route_id = r.id
                AND encode_route_elevation_profile(s.path) IS NOT NULL
            ) AS usable_elevation_segment_count,
            (
              SELECT CASE
                WHEN COUNT(*) >= 1
                  AND COUNT(*) = COUNT(DISTINCT rs.ordinal)
                  AND min(rs.ordinal) = 0
                  AND max(rs.ordinal) = COUNT(*) - 1
                THEN COUNT(*)::int ELSE 0 END
              FROM route_segments rs
              WHERE rs.route_id = r.id
            ) AS ordered_segment_count,
            (
              SELECT COUNT(*) FILTER (
                WHERE prior_path IS NOT NULL
                  AND ST_DWithin(
                    ST_EndPoint(prior_path)::geography,
                    ST_StartPoint(directed_path)::geography,
                    0.1
                  )
                  AND abs(
                    ST_Z(ST_EndPoint(prior_path))
                    - ST_Z(ST_StartPoint(directed_path))
                  ) <= 0.01
              )::int
              FROM chained_segments
            ) AS connected_segment_pair_count,
            greatest((SELECT count(*)::int FROM ordered_segments) - 1, 0)
              AS expected_segment_pair_count,
            (SELECT count(*)::int FROM assembled_points)
              AS assembled_point_count,
            (
              SELECT count(*) FILTER (
                WHERE route_points.geom IS NOT NULL
                  AND assembled_points.geom IS NOT NULL
                  AND abs(ST_X(route_points.geom) - ST_X(assembled_points.geom)) <= 1e-9
                  AND abs(ST_Y(route_points.geom) - ST_Y(assembled_points.geom)) <= 1e-9
                  AND abs(ST_Z(route_points.geom) - ST_Z(assembled_points.geom)) <= 0.01
              )::int
              FROM route_points
              FULL JOIN assembled_points USING (vertex)
            ) AS matching_assembly_point_count,
            (
              SELECT count(*) FILTER (
                WHERE 'summit'::destination_feature = ANY(summit.features)
              )::int
              FROM route_destinations summit_rd
              JOIN destinations summit ON summit.id = summit_rd.destination_id
              WHERE summit_rd.route_id = r.id
            ) AS summit_count,
            (
              SELECT count(*) FILTER (
                WHERE 'summit'::destination_feature = ANY(summit.features)
                  AND (summit.location IS NULL OR NOT ST_DWithin(r.path, summit.location, 5))
              )::int
              FROM route_destinations summit_rd
              JOIN destinations summit ON summit.id = summit_rd.destination_id
              WHERE summit_rd.route_id = r.id
            ) AS summit_fault_count,
            (
              SELECT max(ST_Distance(r.path, summit.location))
                FILTER (WHERE summit.location IS NOT NULL)
              FROM route_destinations summit_rd
              JOIN destinations summit ON summit.id = summit_rd.destination_id
              WHERE summit_rd.route_id = r.id
                AND 'summit'::destination_feature = ANY(summit.features)
            ) AS summit_max_gap_meters,
            (
              SELECT CASE WHEN final_destination.location IS NULL THEN NULL
                     ELSE ST_Distance(
                       ST_EndPoint(r.path::geometry)::geography,
                       final_destination.location
                     ) END
              FROM route_destinations final_rd
              JOIN destinations final_destination
                ON final_destination.id = final_rd.destination_id
              WHERE final_rd.route_id = r.id
              ORDER BY final_rd.ordinal DESC
              LIMIT 1
            ) AS endpoint_gap_meters,
            (
              SELECT final_destination.features
              FROM route_destinations final_rd
              JOIN destinations final_destination
                ON final_destination.id = final_rd.destination_id
              WHERE final_rd.route_id = r.id
              ORDER BY final_rd.ordinal DESC
              LIMIT 1
            ) AS final_destination_features,
            peaks_route_passes_publish_integrity(r.id, NULL, 'active')
              AS publish_integrity_valid,
            (
              SELECT ARRAY_AGG(rd.destination_id ORDER BY rd.ordinal)
              FROM route_destinations rd
              WHERE rd.route_id = r.id
            ) AS destination_ids,
            (
              SELECT JSONB_AGG(to_jsonb(d.features) ORDER BY rd.ordinal)
              FROM route_destinations rd
              JOIN destinations d ON d.id = rd.destination_id
              WHERE rd.route_id = r.id
            ) AS destination_features
     FROM routes r
     WHERE r.id = $1`,
    [input.routeId]
  );
  const route = result.rows[0];
  const destinationIds = route?.destination_ids ?? [];
  const features = route?.destination_features ?? [];
  const destinationOrder =
    destinationIds.length >= 2 &&
    destinationIds[0] === input.trailheadId &&
    destinationIds[destinationIds.length - 1] === input.destinationId &&
    features[0]?.includes("trailhead") &&
    features[features.length - 1]?.includes("summit");
  const segments =
    (route?.segment_count ?? 0) >= 1 &&
    route?.matching_segment_count === route?.segment_count &&
    route?.usable_elevation_segment_count === route?.segment_count &&
    route?.ordered_segment_count === route?.segment_count &&
    route?.connected_segment_pair_count === route?.expected_segment_pair_count &&
    route?.assembled_point_count === route?.point_count &&
    route?.matching_assembly_point_count === route?.point_count &&
    route?.publish_integrity_valid === true &&
    (route?.point_count ?? 0) >= 5;
  const summitContact =
    (route?.summit_count ?? 0) >= 1 &&
    route?.summit_fault_count === 0 &&
    route?.summit_max_gap_meters !== null &&
    (route?.summit_max_gap_meters ?? Number.POSITIVE_INFINITY) <= 5 &&
    (route?.shape !== "out_and_back" && route?.shape !== "point_to_point" ||
      Boolean(route?.final_destination_features?.includes("summit")) &&
      route?.endpoint_gap_meters !== null &&
      (route?.endpoint_gap_meters ?? Number.POSITIVE_INFINITY) <= 5);
  const elevationProfile =
    typeof route?.elevation_string === "string" &&
    route.elevation_string.length > 0 &&
    route.profile_count === route.point_count &&
    route.point_count >= 2;

  const publicBaseUrl = (
    input.publicBaseUrl ||
    process.env.PEAKS_PUBLIC_WEB_URL ||
    DEFAULT_PEAKS_PUBLIC_WEB_URL
  ).replace(/\/+$/, "");
  const publicUrl =
    `${publicBaseUrl}/api/public/routes/${encodeURIComponent(input.routeId)}`;
  let publicStatus = 0;
  let publicPayload: RouteRow | null = null;
  let publicError: string | null = null;
  try {
    const response = await fetch(publicUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "cache-control": "no-cache",
        "user-agent":
          "Peaks standard-route verifier/1.0 " +
          "(https://github.com/jhmacdon/peaks-firebase)",
      },
    });
    publicStatus = response.status;
    if (response.ok) {
      publicPayload = (await response.json()) as RouteRow;
    } else {
      await response.body?.cancel();
    }
  } catch (error) {
    publicError = error instanceof Error ? error.message : String(error);
  }
  const publicMatches =
    publicStatus === 200 &&
    publicPayload?.id === input.routeId &&
    publicPayload.owner === "peaks" &&
    publicPayload.status === "active" &&
    publicPayload.provenance_valid === true &&
    publicPayload.point_count === route?.point_count &&
    publicPayload.segment_count === route?.segment_count &&
    publicPayload.matching_segment_count === route?.matching_segment_count &&
    publicPayload.elevation_string === route?.elevation_string &&
    publicPayload.profile_count === route?.profile_count &&
    publicPayload.usable_elevation_segment_count === route?.usable_elevation_segment_count &&
    publicPayload.ordered_segment_count === route?.ordered_segment_count &&
    publicPayload.connected_segment_pair_count === route?.connected_segment_pair_count &&
    publicPayload.expected_segment_pair_count === route?.expected_segment_pair_count &&
    publicPayload.assembled_point_count === route?.assembled_point_count &&
    publicPayload.matching_assembly_point_count === route?.matching_assembly_point_count &&
    publicPayload.summit_count === route?.summit_count &&
    publicPayload.summit_fault_count === route?.summit_fault_count &&
    publicPayload.summit_max_gap_meters === route?.summit_max_gap_meters &&
    publicPayload.endpoint_gap_meters === route?.endpoint_gap_meters &&
    publicPayload.shape === route?.shape &&
    route?.publish_integrity_valid === true &&
    publicPayload.publish_integrity_valid === true &&
    arraysEqual(publicPayload.final_destination_features ?? [], route?.final_destination_features ?? []) &&
    arraysEqual(publicPayload.destination_ids ?? [], destinationIds);

  const gates = {
    owner: route?.owner === "peaks",
    active: route?.status === "active",
    destination_order: destinationOrder,
    segments,
    provenance: route?.provenance_valid === true,
    summit_contact: summitContact,
    elevation_profile: elevationProfile,
    public_http: publicMatches,
  };
  const errors = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
  if (publicError) errors.push(`public_http: ${publicError}`);
  return {
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    route_id: input.routeId,
    destination_id: input.destinationId,
    trailhead_id: input.trailheadId,
    route_name: route?.name ?? null,
    public_url: publicUrl,
    public_status: publicStatus,
    gates,
    errors,
  };
}
