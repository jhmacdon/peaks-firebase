-- Let a track reach a lake from up to 50 m away.
--
-- Outlined destinations matched only when a track came within 10 m of the
-- outline. That fits places a hiker walks into, like campgrounds, but not
-- lakes: a hiker stops at the shore, often on slabs or cliffs above the water,
-- and GPS and outline error add tens of metres. Production, 2026-10-10: a
-- Lake Ingalls hike spent 17 minutes on the slabs at the outlet, 36-50 m from
-- the mapped shore, and did not log the lake.
--
-- destination_boundary_match_radius() gives lakes 50 m and every other
-- outline 10 m, the way destination_match_radius() does for point
-- destinations. Each match checks a constant 50 m first so the GIST index on
-- destination_boundary_parts still prunes, then the per-feature distance.
-- Same change in api/src/processing.ts and web/src/lib/destination-backfill.ts.
--
-- queue_sessions_near_boundary_parts queues at 50 m for every outline. An
-- extra queued session costs one re-match, which applies the exact distance.
--
-- Cost: no new service. Past sessions near lakes are re-matched separately
-- through session_rematch_queue.

BEGIN;

CREATE OR REPLACE FUNCTION destination_boundary_match_radius(features destination_feature[])
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  -- Keep MAX_BOUNDARY_MATCH_RADIUS_M (api/src/processing.ts) >= every value.
  SELECT CASE
    WHEN 'lake' = ANY(features) THEN 50
    ELSE 10
  END;
$$;

-- Queue ended sessions whose track comes within 50 m, the widest boundary
-- match distance, of a destination's stored boundary pieces.
CREATE OR REPLACE FUNCTION queue_sessions_near_boundary_parts(target_id text, why text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO session_rematch_queue (session_id, reason)
  SELECT DISTINCT s.id, why
  FROM destination_boundary_parts bp
  JOIN tracking_sessions s
    ON s.ended = true
   AND s.path IS NOT NULL
   AND ST_DWithin(s.path, bp.boundary_part, 50)
  WHERE bp.destination_id = target_id
  ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
$$;

CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
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
$function$;

COMMIT;
