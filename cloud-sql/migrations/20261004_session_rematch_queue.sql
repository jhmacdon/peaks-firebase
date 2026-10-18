-- Keep every session's reached destinations and matched routes current when the
-- catalog changes under it.
--
-- processSession (api/src/processing.ts) is the one definition of "this session
-- reached that place / did that route": it clears a session's auto rows and
-- re-matches with the canonical radii, owner scope and rejection veto. Catalog
-- edits used to bypass it:
--
--  * Moving a destination ran link_sessions_on_destination_update, which had
--    its own radius CASE (50 m for viewpoints, waterfalls and campsites, which
--    destination_match_radius() gives 200/200/100 m), never removed auto rows
--    that stopped matching, and ignored owner scope.
--  * Changing a destination's features changes its radius but fired nothing.
--  * Adding or activating a route fired nothing, so older sessions never got
--    the route.
--
-- Production audit 2026-10-04: one user's 95 sessions were missing reached
-- rows for three trailheads and a waterfall, 2-34 m from the track.
--
-- Now a catalog change queues the sessions near the old and the new geometry,
-- and the 2-minute sweep (/internal/sweep, already scheduled) re-runs
-- processSession on them. The queue is a superset; processSession decides.
-- Destination INSERT keeps its immediate trigger (a new place shows its visits
-- at once) with owner scope added.
--
-- Cost: no new service or schedule. The queue holds session ids only.

BEGIN;

CREATE TABLE IF NOT EXISTS session_rematch_queue (
    session_id  TEXT PRIMARY KEY REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    queued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_rematch_queue_queued_at
  ON session_rematch_queue (queued_at, session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON session_rematch_queue TO "peaks-api";

-- Queue ended sessions whose track comes within `radius_m` of `target`.
-- SECURITY DEFINER: catalog writers include restricted worker roles that hold
-- no rights on this table.
CREATE OR REPLACE FUNCTION queue_sessions_near(target geography, radius_m double precision, why text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO session_rematch_queue (session_id, reason)
  SELECT s.id, why
  FROM tracking_sessions s
  WHERE target IS NOT NULL
    AND s.ended = true
    AND s.path IS NOT NULL
    AND ST_DWithin(s.path, target, radius_m)
  ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
$$;

-- Destinations: 200 m is the widest destination_match_radius() (the API's
-- MAX_DESTINATION_MATCH_RADIUS_M); a boundary matches within 10 m.
CREATE OR REPLACE FUNCTION queue_rematch_on_destination_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- peaks_destination_rematch_xy_guard_v1
  -- An elevation-only (Z) repair is not a move: it must not re-match history.
  IF NOT (
       (OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)
    OR ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)
    OR ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)
    OR (OLD.boundary IS NULL) IS DISTINCT FROM (NEW.boundary IS NULL)
    OR COALESCE(NOT ST_Equals(OLD.boundary::geometry, NEW.boundary::geometry), false)
    OR OLD.features IS DISTINCT FROM NEW.features
    OR OLD.owner IS DISTINCT FROM NEW.owner
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM queue_sessions_near(
    COALESCE(OLD.boundary, OLD.location),
    CASE WHEN OLD.boundary IS NOT NULL THEN 10 ELSE 200 END,
    'destination:' || NEW.id
  );
  PERFORM queue_sessions_near(
    COALESCE(NEW.boundary, NEW.location),
    CASE WHEN NEW.boundary IS NOT NULL THEN 10 ELSE 200 END,
    'destination:' || NEW.id
  );
  RETURN NULL;
END;
$$;

-- Routes: processSession's route candidates come from a 0.005-degree planar
-- band; 600 m covers it at any latitude routes exist. Pieces of 512 points
-- keep a continent-scale route from matching every session in its bbox.
CREATE OR REPLACE FUNCTION queue_sessions_near_route(route_path geography, why text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO session_rematch_queue (session_id, reason)
  SELECT DISTINCT s.id, why
  FROM ST_Subdivide(route_path::geometry, 512) AS piece(geom)
  JOIN tracking_sessions s
    ON s.ended = true
   AND s.path IS NOT NULL
   AND ST_DWithin(s.path, piece.geom::geography, 600)
  WHERE route_path IS NOT NULL
  ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
$$;

CREATE OR REPLACE FUNCTION queue_rematch_on_route_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      PERFORM queue_sessions_near_route(NEW.path, 'route:' || NEW.id);
    END IF;
    RETURN NULL;
  END IF;

  -- Only an active route can be matched, so only a change that touches an
  -- active route matters.
  IF OLD.status IS DISTINCT FROM 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.owner IS NOT DISTINCT FROM NEW.owner
     AND ST_Equals(OLD.path::geometry, NEW.path::geometry) IS TRUE THEN
    RETURN NULL;
  END IF;

  IF OLD.status = 'active' THEN
    PERFORM queue_sessions_near_route(OLD.path, 'route:' || NEW.id);
  END IF;
  IF NEW.status = 'active'
     AND NOT (OLD.status = 'active' AND ST_Equals(OLD.path::geometry, NEW.path::geometry) IS TRUE) THEN
    PERFORM queue_sessions_near_route(NEW.path, 'route:' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION queue_sessions_near(geography, double precision, text) OWNER TO postgres;
ALTER FUNCTION queue_rematch_on_destination_change() OWNER TO postgres;
ALTER FUNCTION queue_sessions_near_route(geography, text) OWNER TO postgres;
ALTER FUNCTION queue_rematch_on_route_change() OWNER TO postgres;

-- apply-destination-elevation-fractions checks this before a Z-only repair.
COMMENT ON FUNCTION queue_rematch_on_destination_change() IS
  'peaks:destination-rematch-queue:xy-only-v1';

-- The old update trigger is replaced, not patched: processSession now does
-- what it did, with the right radii, and also removes stale rows.
DROP TRIGGER IF EXISTS trg_destination_update_link_sessions ON destinations;
DROP FUNCTION IF EXISTS link_sessions_on_destination_update();

DROP TRIGGER IF EXISTS trg_destination_queue_rematch ON destinations;
CREATE TRIGGER trg_destination_queue_rematch
AFTER UPDATE OF location, boundary, features, owner ON destinations
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_destination_change();

DROP TRIGGER IF EXISTS trg_route_queue_rematch_insert ON routes;
CREATE TRIGGER trg_route_queue_rematch_insert
AFTER INSERT ON routes
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_route_change();

DROP TRIGGER IF EXISTS trg_route_queue_rematch_update ON routes;
CREATE TRIGGER trg_route_queue_rematch_update
AFTER UPDATE OF path, status, owner ON routes
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_route_change();

-- Destination INSERT: same body as before, plus owner scope. A user-owned
-- place must only tag its owner's sessions (processSession,
-- backfillDestinationToSessions and the plan matcher already scope this way).
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
    SELECT
      destination.id AS destination_id,
      destination.boundary,
      ts.id AS session_id
    FROM new_destinations destination
    JOIN tracking_sessions ts
      ON destination.boundary IS NOT NULL
     AND ts.ended = true
     AND ts.path IS NOT NULL
     AND (destination.owner = 'peaks' OR destination.owner = ts.user_id)
     AND ST_DWithin(destination.boundary::geography, ts.path, 10)
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

-- One-time repair: re-match every finished session once under today's rules.
INSERT INTO session_rematch_queue (session_id, reason)
SELECT id, 'repair:2026-10-04'
FROM tracking_sessions
WHERE ended = true AND path IS NOT NULL
ON CONFLICT (session_id) DO NOTHING;

COMMIT;
