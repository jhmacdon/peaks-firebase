-- Glaciers skip the generic outline match in the destination insert trigger.
-- Glacier reaches come only from real crossings (refresh_session_glacier_crossings,
-- queued by queue_glacier_matches). On Mount Rainier, matching every saved
-- session against a new glacier outline exceeded the import's 30 s statement
-- timeout. Body copied from production's current definition
-- (20261010_forgiving_lake_match.sql) with one added condition.
-- No new infrastructure; $0/month.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.link_sessions_on_destination_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  WITH point_session_candidates AS MATERIALIZED (
    SELECT
      destination.id AS destination_id,
      destination.location AS destination_location,
      destination_match_radius(destination.features) AS radius_m,
      ts.id AS session_id
    FROM new_destinations destination
    JOIN tracking_sessions ts
      ON destination.boundary IS NULL
     AND destination.location IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND (destination.owner = 'peaks' OR destination.owner = ts.user_id)
     AND ST_DWithin(
       destination.location,
       ts.path,
       destination_match_radius(destination.features)
     )
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
    -- Indexed boundary pieces, never the whole polygon: a lake outline can
    -- hold 475k points (20261008_destination_boundary_parts.sql). The
    -- pieces trigger is row-level, so they exist before this statement
    -- trigger fires.
    SELECT DISTINCT
      destination.id AS destination_id,
      destination_boundary_match_radius(destination.features) AS radius_m,
      ts.id AS session_id
    FROM new_destinations destination
    JOIN destination_boundary_parts bp
      ON bp.destination_id = destination.id
    JOIN tracking_sessions ts
      ON ts.ended = true
     AND ts.path IS NOT NULL
     AND (destination.owner = 'peaks' OR destination.owner = ts.user_id)
     AND ST_DWithin(bp.boundary_part, ts.path, 50)
     AND ST_DWithin(bp.boundary_part, ts.path, destination_boundary_match_radius(destination.features))
    WHERE destination.boundary IS NOT NULL
      AND NOT ('glacier'::destination_feature = ANY(destination.features))
  ), boundary_matches AS MATERIALIZED (
    SELECT candidate.session_id, candidate.destination_id
    FROM boundary_session_candidates candidate
    WHERE EXISTS (
      SELECT 1
      FROM destination_boundary_parts bp
      JOIN tracking_points tp
        ON tp.session_id = candidate.session_id
       AND tp.location IS NOT NULL
       AND ST_DWithin(bp.boundary_part, tp.location, 50)
       AND ST_DWithin(bp.boundary_part, tp.location, candidate.radius_m)
      WHERE bp.destination_id = candidate.destination_id
    )
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
  -- The user's "I didn't reach this" veto. Same anti-join as
  -- buildSessionDestinationMatchSql (api/src/processing.ts) and
  -- backfillDestinationToSessions (web/src/lib/destination-backfill.ts) —
  -- scripts/check-cross-refs.sh fails CI if one of the three drops it.
  WHERE NOT EXISTS (
    SELECT 1 FROM session_destination_rejections r
    WHERE r.session_id = matches.session_id
      AND r.destination_id = matches.destination_id
  )
  ON CONFLICT (session_id, destination_id) DO NOTHING;
  RETURN NULL;
END;
$function$
;
COMMIT;
