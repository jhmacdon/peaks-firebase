/** Shared length measurement for routes and segments.
 *
 * source_lines(line_id, path) and session_track(track, track_bbox) must exist.
 * Measure original edges once, then densify only edges near the track. This
 * bounds work on long trails without trusting their uneven vertex spacing.
 * Spherical distances keep edge and sample lengths in the same domain.
 */
export function lineCoverageCtes(): string {
  return `line_vertices AS (
    SELECT l.line_id, (dp).path[1] AS idx, (dp).geom AS pt
    FROM source_lines l CROSS JOIN LATERAL ST_DumpPoints(l.path::geometry) dp
  ), line_edges AS (
    SELECT line_id, idx, ST_MakeLine(pt, next_pt) AS geom,
           ST_Distance(pt::geography, next_pt::geography, false) AS edge_m
    FROM (
      SELECT *, lead(pt) OVER (PARTITION BY line_id ORDER BY idx) AS next_pt
      FROM line_vertices
    ) v WHERE next_pt IS NOT NULL
  ), positioned_edges AS MATERIALIZED (
    SELECT *, COALESCE(sum(edge_m) OVER (PARTITION BY line_id ORDER BY idx
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS offset_m
    FROM line_edges
  ), line_stats AS (
    SELECT line_id, sum(edge_m) AS length_m FROM positioned_edges GROUP BY line_id
  ), near_edges AS MATERIALIZED (
    SELECT e.* FROM positioned_edges e, session_track st
    WHERE e.edge_m > 0 AND e.geom && st.track_bbox
  ), dense_vertices AS (
    SELECT e.line_id, e.idx, e.offset_m, (dp).path[1] AS part_idx, (dp).geom AS pt
    FROM near_edges e
    CROSS JOIN LATERAL ST_DumpPoints(ST_Segmentize(e.geom::geography, 10)::geometry) dp
  ), sample_edges AS (
    SELECT *, ST_MakeLine(pt, next_pt) AS geom,
      ST_Distance(pt::geography, next_pt::geography, false) AS sample_m
    FROM (
      SELECT *, lead(pt) OVER (PARTITION BY line_id, idx ORDER BY part_idx) AS next_pt
      FROM dense_vertices
    ) d WHERE next_pt IS NOT NULL
  ), positioned_samples AS (
    SELECT *, offset_m + COALESCE(sum(sample_m) OVER (PARTITION BY line_id, idx ORDER BY part_idx
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS start_m
    FROM sample_edges
  ), covered_samples AS MATERIALIZED (
    SELECT p.line_id, p.idx, p.part_idx, p.geom, p.start_m,
      p.start_m + p.sample_m AS end_m, p.sample_m,
      ST_LineInterpolatePoint(p.geom, 0.5) AS midpoint
    FROM positioned_samples p, session_track st
    WHERE ST_DWithin(ST_LineInterpolatePoint(p.geom, 0.5)::geography, st.track, 30)
  ), covered_breaks AS (
    SELECT *, CASE WHEN start_m <= lag(end_m) OVER
      (PARTITION BY line_id ORDER BY idx, part_idx) + 0.00001 THEN 0 ELSE 1 END AS new_run
    FROM covered_samples
  ), covered_runs AS (
    SELECT *, sum(new_run) OVER (PARTITION BY line_id ORDER BY idx, part_idx) AS run
    FROM covered_breaks
  ), covered_ranges AS (
    SELECT line_id, run, min(start_m) AS start_m, max(end_m) AS end_m
    FROM covered_runs GROUP BY line_id, run
  ), coverage_stats AS (
    SELECT ls.line_id, ls.length_m,
      COALESCE((SELECT sum(c.sample_m) FROM covered_samples c WHERE c.line_id = ls.line_id), 0) AS covered_m,
      COALESCE((SELECT jsonb_agg(jsonb_build_array(round(GREATEST(0.0, LEAST(1.0, c.start_m / ls.length_m))::numeric, 6)::float8,
        round(GREATEST(0.0, LEAST(1.0, c.end_m / ls.length_m))::numeric, 6)::float8) ORDER BY c.start_m)
        FROM covered_ranges c WHERE c.line_id = ls.line_id), '[]'::jsonb) AS covered_intervals
    FROM line_stats ls WHERE ls.length_m > 0
  )`;
}

/** Prefer the ordered segment graph; legacy routes keep their own path. */
export function routeSourceLinesSql(): string {
  return `SELECT r.id AS line_id, COALESCE(chain.path, r.path::geometry)::geography AS path
    FROM routes r
    LEFT JOIN LATERAL (
      SELECT ST_MakeLine(CASE WHEN rs.direction = 'reverse' THEN ST_Reverse(seg.path::geometry)
                        ELSE seg.path::geometry END ORDER BY rs.ordinal, rs.segment_id) AS path
      FROM route_segments rs JOIN segments seg ON seg.id = rs.segment_id
      WHERE rs.route_id = r.id
    ) chain ON true
    WHERE r.id = ANY($2::text[])`;
}
