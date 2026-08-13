import type { PoolClient } from "pg";
import type { TrackPoint } from "./route-utils";
import {
  encodePolyline6,
  generateId,
  pointsToLineStringZ,
} from "./route-utils";

export type ActivationSegmentReference = {
  segmentId: string;
  direction: "forward" | "reverse";
};

export type ExistingSegmentReuseCheck = {
  profile_valid: boolean;
  stats_match: boolean;
  provenance_matches: boolean;
  segment_points: number;
  slice_points: number;
  matching_points: number;
  endpoint_gap_m: number | null;
  endpoint_z_delta_m: number | null;
};

type ExistingSegmentReuseInput = {
  client: PoolClient;
  existingSegmentId: string;
  points: TrackPoint[];
  direction: "forward" | "reverse";
  routeProvenance: string | null;
  forceRouteSpecific?: boolean;
  createRouteSpecificSegment: () => Promise<string>;
};

type RouteSpecificSegmentInput = {
  client: PoolClient;
  name: string | null;
  points: TrackPoint[];
  distance: number;
  routeProvenance: string | null;
};

const EXISTING_SEGMENT_REUSE_SQL = `
WITH route_slice AS (
  SELECT ST_GeomFromText($2, 4326) AS path
), candidate AS (
  SELECT s.path,
         s.gain AS stored_gain,
         s.gain_loss AS stored_loss,
         elevation_stats.gain AS computed_gain,
         elevation_stats.loss AS computed_loss,
         s.provenance,
         CASE $3::text
           WHEN 'reverse' THEN ST_Reverse(s.path::geometry)
           ELSE s.path::geometry
         END AS directed_path
  FROM segments s
  LEFT JOIN LATERAL route_elevation_stats(s.path)
    AS elevation_stats ON true
  WHERE s.id = $1
), segment_points AS (
  SELECT (dumped).path[1]::int AS vertex,
         (dumped).geom AS geom
  FROM candidate
  CROSS JOIN LATERAL ST_DumpPoints(candidate.directed_path) AS dumped
), slice_points AS (
  SELECT (dumped).path[1]::int AS vertex,
         (dumped).geom AS geom
  FROM route_slice
  CROSS JOIN LATERAL ST_DumpPoints(route_slice.path) AS dumped
), point_checks AS (
  SELECT count(*) FILTER (
           WHERE segment_points.geom IS NOT NULL
             AND slice_points.geom IS NOT NULL
             AND abs(ST_X(segment_points.geom) - ST_X(slice_points.geom)) <= 1e-9
             AND abs(ST_Y(segment_points.geom) - ST_Y(slice_points.geom)) <= 1e-9
             AND abs(ST_Z(segment_points.geom) - ST_Z(slice_points.geom)) <= 0.01
         )::int AS matching_points,
         count(segment_points.geom)::int AS segment_points,
         count(slice_points.geom)::int AS slice_points
  FROM segment_points
  FULL JOIN slice_points USING (vertex)
)
SELECT COALESCE((
  SELECT candidate.path IS NOT NULL
    AND encode_route_elevation_profile(candidate.path) IS NOT NULL
  FROM candidate
), false) AS profile_valid,
COALESCE((
  SELECT candidate.stored_gain IS NOT DISTINCT FROM candidate.computed_gain
    AND candidate.stored_loss IS NOT DISTINCT FROM candidate.computed_loss
  FROM candidate
), false) AS stats_match,
COALESCE((
  SELECT is_valid_route_provenance(candidate.provenance)
    AND candidate.provenance IS NOT DISTINCT FROM $4::jsonb
  FROM candidate
), false) AS provenance_matches,
point_checks.segment_points,
point_checks.slice_points,
point_checks.matching_points,
(
  SELECT GREATEST(
    ST_Distance(
      ST_StartPoint(candidate.directed_path)::geography,
      ST_StartPoint(route_slice.path)::geography
    ),
    ST_Distance(
      ST_EndPoint(candidate.directed_path)::geography,
      ST_EndPoint(route_slice.path)::geography
    )
  )
  FROM candidate
  CROSS JOIN route_slice
) AS endpoint_gap_m,
(
  SELECT GREATEST(
    abs(
      ST_Z(ST_StartPoint(candidate.directed_path))
      - ST_Z(ST_StartPoint(route_slice.path))
    ),
    abs(
      ST_Z(ST_EndPoint(candidate.directed_path))
      - ST_Z(ST_EndPoint(route_slice.path))
    )
  )
  FROM candidate
  CROSS JOIN route_slice
) AS endpoint_z_delta_m
FROM point_checks`;

export function existingSegmentReuseCheckPasses(
  check: ExistingSegmentReuseCheck | undefined
): boolean {
  return Boolean(
    check?.profile_valid &&
      check.stats_match &&
      check.provenance_matches &&
      check.segment_points >= 2 &&
      check.segment_points === check.slice_points &&
      check.segment_points === check.matching_points &&
      check.endpoint_gap_m !== null &&
      check.endpoint_gap_m <= 0.1 &&
      check.endpoint_z_delta_m !== null &&
      check.endpoint_z_delta_m <= 0.01
  );
}

async function existingSegmentIsSafeToReuse(
  client: PoolClient,
  segmentId: string,
  points: TrackPoint[],
  direction: "forward" | "reverse",
  routeProvenance: string | null
): Promise<boolean> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM segments WHERE id = $1 FOR UPDATE`,
    [segmentId]
  );
  if (locked.rows.length !== 1) return false;

  const result = await client.query<ExistingSegmentReuseCheck>(
    EXISTING_SEGMENT_REUSE_SQL,
    [segmentId, pointsToLineStringZ(points), direction, routeProvenance]
  );
  return existingSegmentReuseCheckPasses(result.rows[0]);
}

export async function insertRouteSpecificActivationSegment(
  input: RouteSpecificSegmentInput
): Promise<string> {
  const id = generateId();
  await input.client.query(
    `WITH geometry AS (
       SELECT ST_GeomFromText($3, 4326)::geography AS path
     )
     INSERT INTO segments (
       id, name, path, polyline6, distance, gain, gain_loss, provenance
     )
     SELECT $1, $2, geometry.path, $4, $5,
            elevation_stats.gain, elevation_stats.loss, $6::jsonb
     FROM geometry
     CROSS JOIN LATERAL route_elevation_stats(geometry.path)
       AS elevation_stats`,
    [
      id,
      input.name,
      pointsToLineStringZ(input.points),
      encodePolyline6(input.points),
      input.distance,
      input.routeProvenance,
    ]
  );
  return id;
}

/**
 * Reuse only a segment that already meets the publish predicate for this exact
 * route slice. A nearby match is useful for analysis, but is not proof that its
 * XYZ vertices, elevation stats, or source credit can materialize this route.
 */
export async function chooseActivationSegmentReference(
  input: ExistingSegmentReuseInput
): Promise<ActivationSegmentReference> {
  const reusable =
    !input.forceRouteSpecific &&
    (await existingSegmentIsSafeToReuse(
      input.client,
      input.existingSegmentId,
      input.points,
      input.direction,
      input.routeProvenance
    ));

  if (reusable) {
    return {
      segmentId: input.existingSegmentId,
      direction: input.direction,
    };
  }

  return {
    segmentId: await input.createRouteSpecificSegment(),
    // The new segment is built from points already ordered along this route.
    direction: "forward",
  };
}
