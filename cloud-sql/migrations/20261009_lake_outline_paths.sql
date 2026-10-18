-- Finish moving lake outlines off the hot paths.
--
-- 20261008_destination_boundary_parts.sql moved session and plan matching to
-- indexed boundary pieces. Four paths still read whole outlines, which for
-- the largest lakes hold 200k-475k points:
--
--  * The app downloads them. Destination detail and session detail return
--    the boundary as GeoJSON, an estimated 15-20 MB for Lake Huron, and
--    session detail repeats it for every lake a session reached.
--    `boundary_display` stores a simplified copy for outlines over 2,000
--    points, with the adaptive tolerance areas use (bbox extent / 1500,
--    clamped to 0.00005-0.02 degrees). The API serves
--    COALESCE(boundary_display, boundary). Smaller outlines are served as
--    stored. `boundary` stays the matching geometry.
--  * link_sessions_on_destination_insert matched a new lake against whole
--    outlines. It now uses the pieces.
--  * queue_rematch_on_destination_change ran ST_Equals on the whole outline
--    for every update to a lake row, even a description edit, and queued
--    sessions against the whole outline. It now compares bytes and queues
--    against the pieces. Sessions near a changed outline's new shape are
--    queued by the pieces trigger once it has rebuilt the pieces.
--  * refresh_destination_boundary_parts rebuilt the pieces whenever an
--    UPDATE listed `boundary`, even with an unchanged value (importer
--    upserts). It now skips an unchanged outline.
--
-- Trigger order on UPDATE (alphabetical, same timing): trg_destination_queue_rematch
-- fires before trg_destinations_refresh_boundary_parts, so it still sees the
-- old pieces.
--
-- Cost: no new service. A one-time simplification of about 300 outlines.

BEGIN;

ALTER TABLE destinations ADD COLUMN IF NOT EXISTS boundary_display geography;

COMMENT ON COLUMN destinations.boundary_display IS
  'Simplified copy of boundary for map display, set only when boundary has over 2,000 points. Serve COALESCE(boundary_display, boundary). boundary remains the matching geometry.';

CREATE OR REPLACE FUNCTION destination_display_boundary(boundary geography)
RETURNS geography AS $$
  SELECT CASE
    WHEN boundary IS NULL
      OR ST_NPoints(boundary::geometry) <= 2000
      OR GeometryType(boundary::geometry) NOT IN ('POLYGON', 'MULTIPOLYGON')
      THEN NULL
    ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(
      ST_Simplify(
        boundary::geometry,
        GREATEST(0.00005, LEAST(0.02,
          GREATEST(
            ST_XMax(boundary::geometry) - ST_XMin(boundary::geometry),
            ST_YMax(boundary::geometry) - ST_YMin(boundary::geometry)
          ) / 1500.0
        )),
        true
      )
    ), 3))::geography
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION destinations_refresh_boundary_display()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ST_AsBinary(OLD.boundary) IS NOT DISTINCT FROM ST_AsBinary(NEW.boundary) THEN
    RETURN NEW;
  END IF;
  NEW.boundary_display := destination_display_boundary(NEW.boundary);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_destinations_boundary_display ON destinations;
CREATE TRIGGER trg_destinations_boundary_display
BEFORE INSERT OR UPDATE OF boundary ON destinations
FOR EACH ROW EXECUTE FUNCTION destinations_refresh_boundary_display();

-- Queue ended sessions whose track comes within 10 m of a destination's
-- stored boundary pieces.
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
   AND ST_DWithin(s.path, bp.boundary_part, 10)
  WHERE bp.destination_id = target_id
  ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
$$;

CREATE OR REPLACE FUNCTION refresh_destination_boundary_parts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND ST_AsBinary(OLD.boundary) IS NOT DISTINCT FROM ST_AsBinary(NEW.boundary) THEN
        RETURN NEW;
    END IF;
    DELETE FROM destination_boundary_parts WHERE destination_id = NEW.id;
    INSERT INTO destination_boundary_parts (destination_id, ordinal, boundary_part)
    SELECT NEW.id, (row_number() OVER () - 1)::int, piece
    FROM destination_boundary_pieces(NEW.boundary) AS piece;
    -- A changed outline: queue the sessions near its new shape.
    -- queue_rematch_on_destination_change already queued the old one.
    IF TG_OP = 'UPDATE' AND NEW.boundary IS NOT NULL THEN
        PERFORM queue_sessions_near_boundary_parts(NEW.id, 'destination:' || NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION queue_rematch_on_destination_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- peaks_destination_rematch_xy_guard_v1
  -- An elevation-only (Z) repair is not a move: it must not re-match history.
  -- Outlines compare by bytes: ST_Equals on a 475k-point lake ran on every
  -- update to the row.
  IF NOT (
       (OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)
    OR ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)
    OR ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)
    OR ST_AsBinary(OLD.boundary) IS DISTINCT FROM ST_AsBinary(NEW.boundary)
    OR OLD.features IS DISTINCT FROM NEW.features
    OR OLD.owner IS DISTINCT FROM NEW.owner
  ) THEN
    RETURN NULL;
  END IF;

  -- Old shape. This trigger fires before the pieces are rebuilt, so the
  -- stored pieces are still the old outline's.
  IF OLD.boundary IS NOT NULL THEN
    PERFORM queue_sessions_near_boundary_parts(OLD.id, 'destination:' || NEW.id);
  ELSE
    PERFORM queue_sessions_near(OLD.location, 200, 'destination:' || NEW.id);
  END IF;

  -- New shape. An unchanged outline has the same pieces, queued above; a
  -- changed one is queued by refresh_destination_boundary_parts after the
  -- rebuild.
  IF NEW.boundary IS NULL THEN
    PERFORM queue_sessions_near(NEW.location, 200, 'destination:' || NEW.id);
  END IF;
  RETURN NULL;
END;
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
      ts.id AS session_id
    FROM new_destinations destination
    JOIN destination_boundary_parts bp
      ON bp.destination_id = destination.id
    JOIN tracking_sessions ts
      ON ts.ended = true
     AND ts.path IS NOT NULL
     AND (destination.owner = 'peaks' OR destination.owner = ts.user_id)
     AND ST_DWithin(bp.boundary_part, ts.path, 10)
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
       AND ST_DWithin(bp.boundary_part, tp.location, 10)
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

-- Backfill display outlines for the large ones (about 300 rows).
UPDATE destinations
SET boundary_display = destination_display_boundary(boundary)
WHERE boundary IS NOT NULL
  AND boundary_display IS NULL
  AND ST_NPoints(boundary::geometry) > 2000;

COMMIT;
