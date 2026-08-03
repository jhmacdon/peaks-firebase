import { NextResponse } from "next/server";
import db from "../../../../../lib/db";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const result = await db.query(
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
     WHERE r.id = $1
       AND r.owner = 'peaks'
       AND r.status = 'active'`,
    [id]
  );
  if (!result.rows[0]) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }
  return NextResponse.json(result.rows[0], {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
