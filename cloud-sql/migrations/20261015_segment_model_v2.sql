-- Segment matching v2: length-based route facts, one primary route, and segment visits.
-- Additive DDL only: PG11+ constant defaults do not update rows or fire the
-- standard-route factory / reviewed-catalog segment guards. No history backfill
-- runs here. Use rematch-all-sessions.ts separately after deploying the matcher.
BEGIN;

ALTER TABLE segments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'trail',
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url TEXT,
  ADD COLUMN IF NOT EXISTS state_code TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'segments'::regclass AND conname = 'segments_kind_check') THEN
    ALTER TABLE segments ADD CONSTRAINT segments_kind_check
      CHECK (kind IN ('trail','road','snowfield','glacier','scramble','climb','xc'));
  END IF;
END $$;

ALTER TABLE session_routes
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS covered_m DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_routes_one_primary
  ON session_routes (session_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS session_segments (
  session_id TEXT NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  covered_fraction DOUBLE PRECISION,
  covered_m DOUBLE PRECISION,
  entered_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  direction TEXT CHECK (direction IN ('forward','reverse')),
  PRIMARY KEY (session_id, segment_id)
);
ALTER TABLE session_segments OWNER TO postgres;
CREATE INDEX IF NOT EXISTS idx_session_segments_segment ON session_segments (segment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON session_segments TO "peaks-api";
DROP TRIGGER IF EXISTS trg_session_segments_touch_session ON session_segments;
CREATE TRIGGER trg_session_segments_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_segments
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

-- Invoker rights and ordinary UPDATE preserve all catalog/worker guards.
CREATE OR REPLACE FUNCTION rebuild_route_path(route_id TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  assembled geometry;
  missing_segment TEXT;
BEGIN
  PERFORM 1 FROM routes WHERE id = route_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown route: %', route_id; END IF;
  PERFORM 1 FROM route_segments rs WHERE rs.route_id = rebuild_route_path.route_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route % has no segments', route_id; END IF;
  SELECT s.id INTO missing_segment
    FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
    WHERE rs.route_id = rebuild_route_path.route_id AND (s.path IS NULL OR ST_IsEmpty(s.path::geometry)) LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Segment % has no path', missing_segment; END IF;

  WITH ordered AS (
    SELECT rs.ordinal, rs.segment_id,
      CASE WHEN rs.direction = 'reverse' THEN ST_Reverse(s.path::geometry)
           ELSE s.path::geometry END AS geom
    FROM route_segments rs JOIN segments s ON s.id = rs.segment_id
    WHERE rs.route_id = rebuild_route_path.route_id
  ), vertices AS (
    SELECT ordinal, segment_id, (dp).path[1] AS idx, (dp).geom AS pt
    FROM ordered CROSS JOIN LATERAL ST_DumpPoints(geom) dp
  ), joints AS (
    SELECT *, lag(pt) OVER (ORDER BY ordinal, segment_id, idx) AS previous_pt FROM vertices
  )
  SELECT ST_MakeLine(pt ORDER BY ordinal, segment_id, idx)
    FILTER (WHERE idx > 1 OR previous_pt IS NULL OR NOT ST_Equals(previous_pt, pt))
    INTO assembled FROM joints;
  UPDATE routes SET path = assembled::geography,
    polyline6 = ST_AsEncodedPolyline(ST_Force2D(assembled), 6),
    distance = ST_Length(assembled::geography)
  WHERE id = route_id;
END;
$$;
ALTER FUNCTION rebuild_route_path(TEXT) OWNER TO postgres;

-- Link edits can change both route geometry and the objective. Queue old and
-- new routes on reassignment; include linked sessions even after path removal.
CREATE OR REPLACE FUNCTION queue_rematch_on_route_link_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid TEXT; ids TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP <> 'INSERT' THEN ids := array_append(ids, OLD.route_id); END IF;
  IF TG_OP <> 'DELETE' THEN ids := array_append(ids, NEW.route_id); END IF;
  IF TG_TABLE_NAME = 'route_segments' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM queue_sessions_near_route(path, 'route-links:' || OLD.route_id) FROM segments WHERE id = OLD.segment_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM queue_sessions_near_route(path, 'route-links:' || NEW.route_id) FROM segments WHERE id = NEW.segment_id;
    END IF;
  END IF;
  FOR rid IN SELECT DISTINCT unnest(ids) LOOP
    PERFORM queue_sessions_near_route(path, 'route-links:' || rid) FROM routes WHERE id = rid;
    PERFORM queue_sessions_near_route(seg.path, 'route-links:' || rid)
      FROM route_segments rs JOIN segments seg ON seg.id = rs.segment_id WHERE rs.route_id = rid;
    INSERT INTO session_rematch_queue (session_id, reason)
      SELECT session_id, 'route-links:' || rid FROM session_routes WHERE route_id = rid
      ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_route_link_change() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_route_segments_queue_rematch ON route_segments;
CREATE TRIGGER trg_route_segments_queue_rematch AFTER INSERT OR UPDATE OR DELETE ON route_segments
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_route_link_change();
DROP TRIGGER IF EXISTS trg_route_destinations_queue_rematch ON route_destinations;
CREATE TRIGGER trg_route_destinations_queue_rematch AFTER INSERT OR UPDATE OR DELETE ON route_destinations
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_route_link_change();

CREATE OR REPLACE FUNCTION queue_rematch_on_segment_path_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid TEXT;
BEGIN
  IF ST_Equals(OLD.path::geometry, NEW.path::geometry) IS TRUE THEN RETURN NULL; END IF;
  FOR rid IN SELECT DISTINCT route_id FROM route_segments WHERE segment_id = NEW.id LOOP
    PERFORM queue_sessions_near_route(path, 'segment:' || NEW.id) FROM routes WHERE id = rid;
    PERFORM queue_sessions_near_route(OLD.path, 'segment:' || NEW.id);
    PERFORM queue_sessions_near_route(NEW.path, 'segment:' || NEW.id);
    INSERT INTO session_rematch_queue (session_id, reason)
      SELECT session_id, 'segment:' || NEW.id FROM session_routes WHERE route_id = rid
      ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_segment_path_change() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_segment_path_queue_rematch ON segments;
CREATE TRIGGER trg_segment_path_queue_rematch AFTER UPDATE OF path ON segments
FOR EACH ROW EXECUTE FUNCTION queue_rematch_on_segment_path_change();

-- Changing an explicit objective also changes primary-route selection.
CREATE OR REPLACE FUNCTION queue_rematch_on_route_objective_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM queue_sessions_near_route(NEW.path, 'route-objective:' || NEW.id);
  INSERT INTO session_rematch_queue (session_id, reason)
    SELECT session_id, 'route-objective:' || NEW.id FROM session_routes WHERE route_id = NEW.id
    ON CONFLICT (session_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now();
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_route_objective_change() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_route_objective_queue_rematch ON routes;
CREATE TRIGGER trg_route_objective_queue_rematch AFTER UPDATE OF objective_destination_id, kind ON routes
FOR EACH ROW WHEN (OLD.objective_destination_id IS DISTINCT FROM NEW.objective_destination_id OR OLD.kind IS DISTINCT FROM NEW.kind)
EXECUTE FUNCTION queue_rematch_on_route_objective_change();
COMMIT;
