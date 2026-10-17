import { GAP_TOLERANCE_MAX_M, GAP_TOLERANCE_MIN_M, GAP_TOLERANCE_ROUTE_FRAC } from "./route-coverage";

export const TRIPLE_CROWN_INDEXED_ROUTE_IDS = ["triple-crown-pct", "triple-crown-at", "triple-crown-cdt"] as const;

/** WGS 84 UTM zone (EPSG 32601-32660 north, 32701-32760 south) at a lon/lat
 * geometry's centroid. Plain SQL so read-only tooling can run it unchanged. */
export function utmSridSql(geom: string): string {
  return `(CASE WHEN ST_Y(ST_Centroid(${geom})) < 0 THEN 32700 ELSE 32600 END
    + LEAST(60, GREATEST(1, floor((ST_X(ST_Centroid(${geom})) + 180) / 6)::int + 1)))`;
}

/** Session track, its 600 m index bbox, and the track in the UTM zone at its
 * centroid. Per-sample 30 m tests run in that projection: geodesic ST_DWithin
 * on every 10 m sample cost seconds per session on db-f1-micro. Inside a zone
 * UTM scale is within 0.04% of true, about 1 cm at 30 m; 6 degrees of longitude
 * past the zone edge it is still within 0.3%. Reported lengths stay geodesic.
 */
export function sessionTrackCte(): string {
  return `session_track AS MATERIALIZED (
    SELECT t.track, t.track_bbox, t.srid, ST_Transform(ST_Force2D(t.track::geometry), t.srid) AS track_m
    FROM (SELECT s.path AS track, session_match_bbox(s.path) AS track_bbox,
        ${utmSridSql("s.path::geometry")} AS srid
      FROM tracking_sessions s WHERE s.id = $1 AND s.path IS NOT NULL) t
  )`;
}

/** source_lines(line_id, path) excludes Triple Crown routes. Only intersecting
 * parts of large lines are dumped. A part's offset is the geodesic length of
 * the prefix, never a planar fraction multiplied by the route's length.
 * Indexed routes read nearby index rows plus PK neighbours, not their paths.
 */
export function lineCoverageCtes(indexedRoutes = false): string {
  const indexed = indexedRoutes ? `indexed_stats AS (
    SELECT r.id AS line_id, last_point.along_m AS length_m
    FROM routes r CROSS JOIN LATERAL (
      SELECT along_m FROM triple_crown_route_points
      WHERE route_id = r.id ORDER BY idx DESC LIMIT 1
    ) last_point WHERE r.id = ANY($2::text[]) AND r.id = ANY($3::text[])
  ), indexed_near AS MATERIALIZED (
    SELECT rp.* FROM triple_crown_route_points rp, session_track st
    WHERE rp.route_id = ANY($2::text[]) AND rp.route_id = ANY($3::text[])
      AND rp.pt && st.track_bbox
  ), indexed_starts AS (
    SELECT route_id, idx FROM indexed_near
    UNION SELECT route_id, idx - 1 FROM indexed_near WHERE idx > 0
  ), indexed_edges AS (
    SELECT a.route_id AS line_id, a.idx::bigint AS part, 1 AS idx,
      ST_MakeLine(a.pt, b.pt) AS geom, a.along_m AS offset_m,
      b.along_m - a.along_m AS edge_m
    FROM indexed_starts n
    JOIN triple_crown_route_points a ON a.route_id = n.route_id AND a.idx = n.idx
    JOIN triple_crown_route_points b ON b.route_id = a.route_id AND b.idx = a.idx + 1
  ),` : "";
  // Horizontal lengths throughout: ST_Length(geography) adds elevation change
  // while ST_Distance, which sizes every 10 m piece, does not. A 3D length
  // understated coverage by 2-4% on mountain routes (DC: 11,943 m vs 11,529 m).
  // routes.distance keeps its own convention; this only measures coverage.
  return `${indexed} line_meta AS MATERIALIZED (
    SELECT line_id, geom, ST_Length(geom::geography, false) AS length_m,
      ST_NPoints(geom) > 5000 OR ST_Length(geom::geography, false) > 50000 AS large
    FROM (SELECT line_id, ST_Force2D(path::geometry) AS geom FROM source_lines) flat
  ), line_stats AS (
    SELECT line_id, length_m FROM line_meta
    ${indexedRoutes ? "UNION ALL SELECT line_id, length_m FROM indexed_stats" : ""}
  ), bounded_parts AS MATERIALIZED (
    SELECT l.line_id, 0::bigint AS part, l.geom, 0::float8 AS offset_m
    FROM line_meta l WHERE NOT l.large
    UNION ALL
    SELECT l.line_id, piece.ordinality * 1000000 + COALESCE(clipped.path[1],0) AS part, clipped.geom,
      ST_Length(ST_LineSubstring(l.geom, 0,
        ST_LineLocatePoint(l.geom, ST_StartPoint(clipped.geom)))::geography, false) AS offset_m
    FROM line_meta l CROSS JOIN session_track st
    CROSS JOIN LATERAL ST_Subdivide(l.geom, 512) WITH ORDINALITY AS piece(geom, ordinality)
    CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(ST_Intersection(piece.geom,st.track_bbox),2)) clipped
    WHERE l.large AND piece.geom && st.track_bbox
  ), line_vertices AS (
    SELECT l.line_id, l.part, l.offset_m, (dp).path[1] AS idx, (dp).geom AS pt
    FROM bounded_parts l CROSS JOIN LATERAL ST_DumpPoints(l.geom) dp
  ), line_edges AS (
    SELECT line_id, part, offset_m, idx, ST_MakeLine(pt, next_pt) AS geom,
      ST_Distance(pt::geography, next_pt::geography, false) AS edge_m
    FROM (SELECT *, lead(pt) OVER (PARTITION BY line_id, part ORDER BY idx) AS next_pt
      FROM line_vertices) v WHERE next_pt IS NOT NULL
  ), positioned_edges AS (
    SELECT line_id, part, idx, geom, edge_m,
      offset_m + COALESCE(sum(edge_m) OVER (PARTITION BY line_id, part ORDER BY idx
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS offset_m
    FROM line_edges
    ${indexedRoutes ? "UNION ALL SELECT line_id, part, idx, geom, edge_m, offset_m FROM indexed_edges" : ""}
  ), near_edges AS MATERIALIZED (
    SELECT e.*, ST_Transform(ST_Force2D(e.geom), st.srid) AS geom_m,
      CASE WHEN e.edge_m > 10 THEN power(2, ceil(ln(e.edge_m / 10) / ln(2)))::integer ELSE 1 END AS pieces
    FROM positioned_edges e, session_track st
    WHERE e.edge_m > 0 AND e.geom && st.track_bbox
  ), covered_samples AS MATERIALIZED (
    -- The 10 m pieces of ST_Segmentize(edge::geography, 10), without building
    -- them: it halves an edge until each piece is at most 10 m, so an edge has
    -- 2^ceil(log2(edge_m / 10)) equal pieces. A piece counts when its midpoint
    -- lies within 30 m of the track; only covered pieces become geometry.
    SELECT e.line_id, ST_MakeLine(ST_LineInterpolatePoint(e.geom, k::float8 / e.pieces),
        ST_LineInterpolatePoint(e.geom, (k + 1)::float8 / e.pieces)) AS geom,
      e.offset_m + k * e.edge_m / e.pieces AS start_m,
      e.offset_m + (k + 1) * e.edge_m / e.pieces AS end_m, e.edge_m / e.pieces AS sample_m
    FROM near_edges e CROSS JOIN session_track st
    CROSS JOIN LATERAL generate_series(0, e.pieces - 1) AS k
    WHERE ST_DWithin(ST_LineInterpolatePoint(e.geom_m, (k + 0.5)::float8 / e.pieces), st.track_m, 30)
  ), covered_breaks AS (
    SELECT c.*, CASE WHEN c.start_m <= lag(c.end_m) OVER
      (PARTITION BY c.line_id ORDER BY c.start_m, c.end_m) +
      LEAST(${GAP_TOLERANCE_MAX_M}.0, GREATEST(${GAP_TOLERANCE_MIN_M}.0, ls.length_m * ${GAP_TOLERANCE_ROUTE_FRAC})) + 0.00001
      THEN 0 ELSE 1 END AS new_run
    FROM covered_samples c JOIN line_stats ls ON ls.line_id = c.line_id
  ), covered_runs AS (
    SELECT *, sum(new_run) OVER (PARTITION BY line_id ORDER BY start_m, end_m) AS run
    FROM covered_breaks
  ), covered_ranges AS (
    SELECT line_id, run, min(start_m) AS start_m, max(end_m) AS end_m
    FROM covered_runs GROUP BY line_id, run
  ), covered_totals AS (
    SELECT line_id, sum(sample_m) AS covered_m,
      encode(ST_AsEWKB(ST_LineMerge(ST_Collect(geom))), 'hex') AS covered_geometry
    FROM covered_samples GROUP BY line_id
  ), coverage_stats AS (
    SELECT ls.line_id, ls.length_m, COALESCE(ct.covered_m, 0) AS covered_m, ct.covered_geometry,
      COALESCE((SELECT jsonb_agg(jsonb_build_array(
        round(GREATEST(0.0, LEAST(1.0, c.start_m / ls.length_m))::numeric, 6)::float8,
        round(GREATEST(0.0, LEAST(1.0, c.end_m / ls.length_m))::numeric, 6)::float8) ORDER BY c.start_m)
        FROM covered_ranges c WHERE c.line_id = ls.line_id), '[]'::jsonb) AS covered_intervals
    FROM line_stats ls LEFT JOIN covered_totals ct ON ct.line_id = ls.line_id WHERE ls.length_m > 0
  )`;
}

/** The three imported long trails always use their dedicated vertex index. */
export function routeSourceLinesSql(): string {
  return `SELECT r.id AS line_id, COALESCE(chain.path, r.path::geometry)::geography AS path
    FROM routes r
    LEFT JOIN LATERAL (
      SELECT ST_MakeLine(CASE WHEN rs.direction = 'reverse' THEN ST_Reverse(seg.path::geometry)
        ELSE seg.path::geometry END ORDER BY rs.ordinal, rs.segment_id) AS path
      FROM route_segments rs JOIN segments seg ON seg.id = rs.segment_id
      WHERE rs.route_id = r.id AND NOT (r.id = ANY($3::text[]))
    ) chain ON true
    WHERE r.id = ANY($2::text[]) AND NOT (r.id = ANY($3::text[]))`;
}
