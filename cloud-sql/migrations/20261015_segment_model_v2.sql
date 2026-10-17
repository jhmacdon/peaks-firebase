-- Segment matching v2: length-based route facts, one primary route, and segment visits.
-- Additive DDL only: PG11+ constant defaults do not update rows or fire the
-- standard-route factory / reviewed-catalog segment guards. No history backfill
-- runs here. Use rematch-all-sessions.ts separately after deploying the matcher.
BEGIN;

-- Take every table lock this file needs up front, in one order. Later steps
-- would otherwise lock session_segments, then routes, while a processing
-- transaction holding routes waits on session_segments: a deadlock on replay.
DO $$ DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['routes','segments','route_segments','route_destinations','session_routes','session_segments'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', tbl);
    END IF;
  END LOOP;
END $$;

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
  -- 0-based; a new pass starts after 10 min outside the 30 m corridor or a
  -- reversal of more than 100 m along the segment (api/src/segment-passes.ts).
  pass_index INTEGER NOT NULL DEFAULT 0 CHECK (pass_index >= 0),
  PRIMARY KEY (session_id, segment_id, pass_index)
);
-- A table created by an earlier draft of this file has one row per segment.
ALTER TABLE session_segments ADD COLUMN IF NOT EXISTS pass_index INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'session_segments'::regclass
      AND conname = 'session_segments_pass_index_check') THEN
    ALTER TABLE session_segments ADD CONSTRAINT session_segments_pass_index_check CHECK (pass_index >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'session_segments'::regclass AND i.indisprimary
      AND i.indnatts = 3) THEN
    ALTER TABLE session_segments DROP CONSTRAINT IF EXISTS session_segments_pkey,
      ADD CONSTRAINT session_segments_pkey PRIMARY KEY (session_id, segment_id, pass_index);
  END IF;
END $$;
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
  elevation_gain DOUBLE PRECISION;
  elevation_loss DOUBLE PRECISION;
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
    FILTER (WHERE idx > 1 OR previous_pt IS NULL OR NOT ST_DWithin(previous_pt::geography, pt::geography, 0.1))
    INTO assembled FROM joints;
  SELECT stats.gain,stats.loss INTO elevation_gain,elevation_loss
    FROM route_elevation_stats(assembled::geography) stats;
  UPDATE routes SET path = assembled::geography,
    polyline6 = ST_AsEncodedPolyline(ST_Force2D(assembled), 6),
    distance = ST_Length(assembled::geography),
    elevation_string = encode_route_elevation_profile(assembled::geography),
    gain = elevation_gain, gain_loss = elevation_loss
  WHERE id = route_id;
END;
$$;
ALTER FUNCTION rebuild_route_path(TEXT) OWNER TO postgres;

-- Conservative metre-sized query box without buffering thousands of GPS
-- vertices. Polar/dateline tracks retain PostGIS's geography buffer handling.
CREATE OR REPLACE FUNCTION session_match_bbox(track geography, radius_m DOUBLE PRECISION DEFAULT 600)
RETURNS geometry LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE box geometry; west FLOAT8; east FLOAT8; south FLOAT8; north FLOAT8;
  dy FLOAT8; dx FLOAT8;
BEGIN
  box:=ST_Envelope(track::geometry);
  west:=ST_XMin(box); east:=ST_XMax(box); south:=ST_YMin(box); north:=ST_YMax(box);
  -- 100 km per degree is below Earth's minimum meridional scale.
  dy:=radius_m/100000.0;
  IF GREATEST(abs(south),abs(north))+dy>=89.9 OR east-west>180 THEN
    RETURN ST_Envelope(ST_Buffer(track,radius_m)::geometry);
  END IF;
  dx:=dy/cos(radians(GREATEST(abs(south),abs(north))+dy));
  IF west-dx < -180 OR east+dx > 180 THEN RETURN ST_Envelope(ST_Buffer(track,radius_m)::geometry); END IF;
  RETURN ST_MakeEnvelope(west-dx,south-dy,east+dx,north+dy,4326);
END;
$$;
ALTER FUNCTION session_match_bbox(geography,DOUBLE PRECISION) OWNER TO postgres;

-- Queue each distinct route once. Triple Crown routes use the point index;
-- neither their cached path nor their whole-route segments are scanned here.
CREATE OR REPLACE FUNCTION queue_matching_routes(route_ids TEXT[], why TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE rid TEXT;
BEGIN
  FOR rid IN SELECT DISTINCT unnest(route_ids) LOOP
    IF rid = ANY(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']) THEN
      INSERT INTO session_rematch_queue (session_id, reason)
      SELECT DISTINCT s.id, why FROM tracking_sessions s
      JOIN triple_crown_route_points p ON p.route_id = rid
        AND p.pt && session_match_bbox(s.path)
        AND ST_DWithin(p.pt::geography,s.path,600)
      WHERE s.ended AND s.path IS NOT NULL
      ON CONFLICT (session_id) DO UPDATE SET reason=EXCLUDED.reason, queued_at=now();
    ELSE
      PERFORM queue_sessions_near_route(path,why) FROM routes WHERE id=rid;
    END IF;
    INSERT INTO session_rematch_queue (session_id, reason)
      SELECT session_id,why FROM session_routes WHERE route_id=rid
      ON CONFLICT (session_id) DO UPDATE SET reason=EXCLUDED.reason, queued_at=now();
  END LOOP;
END;
$$;
ALTER FUNCTION queue_matching_routes(TEXT[],TEXT) OWNER TO postgres;

-- One invocation per INSERT/UPDATE/DELETE statement, regardless of link count.
-- Only links of active routes queue anything: no session can match a pending
-- or retired route, and activation queues through trg_route_queue_rematch_update.
-- The WA catalog loader writes thousands of links for pending routes.
CREATE OR REPLACE FUNCTION queue_rematch_on_route_link_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE ids TEXT[]; pieces TEXT[];
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT array_agg(DISTINCT l.route_id) INTO ids FROM new_links l
      JOIN routes r ON r.id=l.route_id WHERE r.status='active';
  ELSIF TG_OP='DELETE' THEN
    SELECT array_agg(DISTINCT l.route_id) INTO ids FROM old_links l
      JOIN routes r ON r.id=l.route_id WHERE r.status='active';
  ELSE
    SELECT array_agg(DISTINCT changed.route_id) INTO ids FROM (
      SELECT route_id FROM old_links UNION SELECT route_id FROM new_links
    ) changed JOIN routes r ON r.id=changed.route_id WHERE r.status='active';
  END IF;
  IF ids IS NULL THEN RETURN NULL; END IF;
  PERFORM queue_matching_routes(ids,'route-links:' || TG_TABLE_NAME);
  -- Only changed segments need extra geometry scans, never every segment of
  -- the route for every row. Exclude the three whole-trail imported segments.
  IF TG_TABLE_NAME='route_segments' THEN
    IF TG_OP='INSERT' THEN
      SELECT array_agg(DISTINCT segment_id) INTO pieces FROM new_links
        WHERE route_id = ANY(ids) AND route_id <> ALL(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']);
    ELSIF TG_OP='DELETE' THEN
      SELECT array_agg(DISTINCT segment_id) INTO pieces FROM old_links
        WHERE route_id = ANY(ids) AND route_id <> ALL(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']);
    ELSE
      SELECT array_agg(DISTINCT segment_id) INTO pieces FROM (
        SELECT route_id,segment_id FROM old_links UNION SELECT route_id,segment_id FROM new_links
      ) changed WHERE route_id = ANY(ids) AND route_id <> ALL(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']);
    END IF;
    PERFORM queue_sessions_near_route(s.path,'route-links:segments') FROM segments s
      WHERE s.id=ANY(pieces) AND NOT EXISTS (
        SELECT 1 FROM route_segments rs WHERE rs.segment_id=s.id
          AND rs.route_id=ANY(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt'])
      );
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_route_link_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_route_segments_queue_rematch ON route_segments;
DROP TRIGGER IF EXISTS trg_route_destinations_queue_rematch ON route_destinations;
DO $$ DECLARE tbl TEXT; evt TEXT; old_ref TEXT; new_ref TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_segments','route_destinations'] LOOP
    FOREACH evt IN ARRAY ARRAY['insert','update','delete'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','trg_'||tbl||'_queue_'||evt,tbl);
      old_ref:=CASE WHEN evt IN ('update','delete') THEN 'OLD TABLE AS old_links ' ELSE '' END;
      new_ref:=CASE WHEN evt IN ('update','insert') THEN 'NEW TABLE AS new_links ' ELSE '' END;
      EXECUTE format('CREATE TRIGGER %I AFTER %s ON %I REFERENCING %s%s FOR EACH STATEMENT EXECUTE FUNCTION queue_rematch_on_route_link_change()',
        'trg_'||tbl||'_queue_'||evt,upper(evt),tbl,old_ref,new_ref);
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION queue_rematch_on_segment_path_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE ids TEXT[];
BEGIN
  -- Segments used only by pending or retired routes queue nothing.
  SELECT array_agg(DISTINCT rs.route_id) INTO ids
    FROM old_segments o JOIN new_segments n USING(id)
    JOIN route_segments rs ON rs.segment_id=n.id
    JOIN routes r ON r.id=rs.route_id AND r.status='active'
    WHERE ((o.path IS NULL) IS DISTINCT FROM (n.path IS NULL) OR COALESCE(NOT ST_Equals(o.path::geometry,n.path::geometry),false));
  IF ids IS NULL THEN RETURN NULL; END IF;
  PERFORM queue_matching_routes(ids,'segment-path');
  PERFORM queue_sessions_near_route(piece.path,'segment-path') FROM (
    SELECT o.id,o.path FROM old_segments o JOIN new_segments n USING(id)
      WHERE ((o.path IS NULL) IS DISTINCT FROM (n.path IS NULL) OR COALESCE(NOT ST_Equals(o.path::geometry,n.path::geometry),false))
    UNION ALL
    SELECT n.id,n.path FROM old_segments o JOIN new_segments n USING(id)
      WHERE ((o.path IS NULL) IS DISTINCT FROM (n.path IS NULL) OR COALESCE(NOT ST_Equals(o.path::geometry,n.path::geometry),false))
  ) piece WHERE EXISTS (
    SELECT 1 FROM route_segments rs WHERE rs.segment_id=piece.id AND rs.route_id=ANY(ids)
  ) AND NOT EXISTS (
    SELECT 1 FROM route_segments rs WHERE rs.segment_id=piece.id
      AND rs.route_id=ANY(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt'])
  );
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_segment_path_change() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_segment_path_queue_rematch ON segments;
CREATE TRIGGER trg_segment_path_queue_rematch AFTER UPDATE ON segments
REFERENCING OLD TABLE AS old_segments NEW TABLE AS new_segments
FOR EACH STATEMENT EXECUTE FUNCTION queue_rematch_on_segment_path_change();

CREATE OR REPLACE FUNCTION queue_rematch_on_route_objective_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM queue_matching_routes(ARRAY[NEW.id],'route-objective:' || NEW.id);
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_route_objective_change() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_route_objective_queue_rematch ON routes;
CREATE TRIGGER trg_route_objective_queue_rematch AFTER UPDATE OF objective_destination_id,kind ON routes
FOR EACH ROW WHEN (NEW.status = 'active' AND (OLD.objective_destination_id IS DISTINCT FROM NEW.objective_destination_id OR OLD.kind IS DISTINCT FROM NEW.kind))
EXECUTE FUNCTION queue_rematch_on_route_objective_change();

-- Preserve the old/new path rules for ordinary routes, and keep the imported
-- long trails on their dedicated index for path, owner and status changes too.
CREATE OR REPLACE FUNCTION queue_rematch_on_route_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status='active' THEN
      PERFORM queue_matching_routes(ARRAY[NEW.id],'route:' || NEW.id);
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.status IS DISTINCT FROM 'active' AND NEW.status IS DISTINCT FROM 'active' THEN RETURN NULL; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.owner IS NOT DISTINCT FROM NEW.owner
    AND ST_Equals(OLD.path::geometry,NEW.path::geometry) IS TRUE THEN RETURN NULL; END IF;
  IF NEW.id=ANY(ARRAY['triple-crown-pct','triple-crown-at','triple-crown-cdt']) THEN
    PERFORM queue_matching_routes(ARRAY[NEW.id],'route:' || NEW.id);
  ELSE
    IF OLD.status='active' THEN PERFORM queue_sessions_near_route(OLD.path,'route:' || NEW.id); END IF;
    IF NEW.status='active' AND NOT(OLD.status='active' AND ST_Equals(OLD.path::geometry,NEW.path::geometry) IS TRUE) THEN
      PERFORM queue_sessions_near_route(NEW.path,'route:' || NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION queue_rematch_on_route_change() OWNER TO postgres;

COMMIT;
