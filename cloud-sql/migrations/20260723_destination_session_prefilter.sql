-- Production already has this schema-declared 76 MB index, so the current
-- incremental cost is $0/month. IF NOT EXISTS only repairs schema drift.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracking_points_location
ON tracking_points USING GIST (location)
WHERE location IS NOT NULL;

-- A statement-level destination insert can contain many peaks near one long
-- recording. Use the spatial index to prove one real tracking point reaches
-- each destination, then stop at the first proof instead of scanning the whole
-- recording once per peak.
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
BEGIN
  WITH point_session_candidates AS MATERIALIZED (
    SELECT
      d.id AS destination_id,
      d.location AS destination_location,
      destination_match_radius(d.features) AS radius_m,
      ts.id AS session_id
    FROM new_destinations d
    JOIN tracking_sessions ts
      ON d.boundary IS NULL
     AND d.location IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND ST_DWithin(d.location, ts.path, destination_match_radius(d.features))
  ), point_matches AS MATERIALIZED (
    SELECT candidate.session_id, candidate.destination_id
    FROM point_session_candidates candidate
    JOIN LATERAL (
      SELECT 1
      FROM tracking_points tp
      WHERE tp.session_id = candidate.session_id
        AND tp.location IS NOT NULL
        AND ST_DWithin(
          candidate.destination_location,
          tp.location,
          candidate.radius_m
        )
      LIMIT 1
    ) proof ON true
  ), boundary_session_candidates AS MATERIALIZED (
    SELECT
      d.id AS destination_id,
      d.boundary,
      ts.id AS session_id
    FROM new_destinations d
    JOIN tracking_sessions ts
      ON d.boundary IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND ST_DWithin(d.boundary::geography, ts.path, 10)
  ), boundary_matches AS MATERIALIZED (
    SELECT candidate.session_id, candidate.destination_id
    FROM boundary_session_candidates candidate
    JOIN LATERAL (
      SELECT 1
      FROM tracking_points tp
      WHERE tp.session_id = candidate.session_id
        AND tp.location IS NOT NULL
        AND ST_DWithin(candidate.boundary::geography, tp.location, 10)
      LIMIT 1
    ) proof ON true
  ), matches AS (
    SELECT * FROM point_matches
    UNION ALL
    SELECT * FROM boundary_matches
  )
  INSERT INTO session_destinations (session_id, destination_id, relation, source)
  SELECT DISTINCT
    matches.session_id,
    matches.destination_id,
    'reached'::session_destination_relation,
    'auto'
  FROM matches
  ON CONFLICT (session_id, destination_id) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
