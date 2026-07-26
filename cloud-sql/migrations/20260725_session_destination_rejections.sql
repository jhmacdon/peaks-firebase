-- Session-scoped destination rejections ("I didn't actually summit this").
--
-- A rejection is NOT a session_destinations.source value: processSession Step 1
-- deletes every source='auto' row before re-matching, so a rejection stored
-- there would be erased and the pair re-matched on the very next run. A
-- separate table survives re-processing and keeps every existing read of
-- session_destinations correct with no change.
--
-- Anti-joined by every writer of auto 'reached' rows:
--   1. buildSessionDestinationMatchSql     — cloud-sql/api/src/processing.ts
--   2. link_sessions_on_destination_insert — this file / cloud-sql/schema.sql
--   3. backfillDestinationToSessions       — web/src/lib/destination-backfill.ts
--   4. link_sessions_on_destination_update — this file, patched where it exists
--      (created by 20260411_boundary_update_trigger.sql, absent from schema.sql)
-- Another writer without the anti-join silently resurrects rejections;
-- scripts/check-cross-refs.sh discovers every file that inserts into
-- session_destinations and fails CI if one of them drops the reference.
--
-- Idempotent: safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS session_destination_rejections (
    session_id      TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    rejected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, destination_id)
);

-- "Which sessions rejected this destination" — the destination-scoped read that
-- the (session_id, destination_id) PK cannot serve (wrong leading column).
CREATE INDEX IF NOT EXISTS idx_session_destination_rejections_dest
    ON session_destination_rejections (destination_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON session_destination_rejections TO "peaks-api";

-- Re-declare the destination-insert trigger function with the rejection
-- anti-join. Body is otherwise byte-identical to the current definition in
-- cloud-sql/schema.sql (statement-level, REFERENCING NEW TABLE AS
-- new_destinations, spatial prefilter + per-point proof) — only the final
-- INSERT ... SELECT gains the NOT EXISTS.
CREATE OR REPLACE FUNCTION link_sessions_on_destination_insert()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Fourth auto-writer: link_sessions_on_destination_update.
--
-- Created by 20260411_boundary_update_trigger.sql, still live, and absent from
-- schema.sql (schema drift predating this migration). It fires AFTER UPDATE OF
-- boundary, location and inserts source='auto' rows, so an admin boundary or
-- location edit would re-insert every rejected pair in range.
--
-- Patched only where it exists: a database built from schema.sql alone never
-- had this trigger, and this migration must not introduce it there.
--
-- The body below is the deployed body byte-for-byte plus the same per-pair
-- anti-join. Its radii (summit 30 / trailhead 100 / else 50) are hardcoded and
-- have drifted from destination_match_radius() — deliberately left alone;
-- reconciling them is a separate product decision, not a rejection fix.
-- ---------------------------------------------------------------------------
DO $patch$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'link_sessions_on_destination_update') THEN
    EXECUTE $ddl$
CREATE OR REPLACE FUNCTION link_sessions_on_destination_update()
RETURNS TRIGGER AS $fn$
BEGIN
    -- Boundary changed
    IF NEW.boundary IS NOT NULL AND (OLD.boundary IS NULL OR OLD.boundary != NEW.boundary) THEN
        INSERT INTO session_destinations (session_id, destination_id, relation, source)
        SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
        FROM tracking_points tp
        JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.ended = true
          AND ST_DWithin(NEW.boundary, tp.location, 10)
          AND NOT EXISTS (
            SELECT 1 FROM session_destination_rejections r
            WHERE r.session_id = tp.session_id AND r.destination_id = NEW.id
          )
        ON CONFLICT (session_id, destination_id) DO NOTHING;

    -- Location changed (and no boundary — boundary takes precedence)
    ELSIF NEW.boundary IS NULL AND OLD.location != NEW.location THEN
        INSERT INTO session_destinations (session_id, destination_id, relation, source)
        SELECT DISTINCT tp.session_id, NEW.id, 'reached'::session_destination_relation, 'auto'
        FROM tracking_points tp
        JOIN tracking_sessions ts ON ts.id = tp.session_id
        WHERE ts.ended = true
          AND ST_DWithin(
                NEW.location,
                tp.location,
                CASE WHEN 'summit' = ANY(NEW.features) THEN 30
                     WHEN 'trailhead' = ANY(NEW.features) THEN 100
                     ELSE 50 END
              )
          AND NOT EXISTS (
            SELECT 1 FROM session_destination_rejections r
            WHERE r.session_id = tp.session_id AND r.destination_id = NEW.id
          )
        ON CONFLICT (session_id, destination_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
    $ddl$;
    RAISE NOTICE 'link_sessions_on_destination_update patched with the rejection anti-join';
  ELSE
    RAISE NOTICE 'link_sessions_on_destination_update absent — nothing to patch';
  END IF;
END
$patch$;

COMMIT;
