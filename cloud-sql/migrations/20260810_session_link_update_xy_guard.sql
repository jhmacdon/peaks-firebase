BEGIN;

-- A PointZ elevation repair changes location's Z coordinate. PostgreSQL and
-- PostGIS compare that as a location change, so the destination UPDATE trigger
-- used to rerun historical session matching for a Z-only edit. Keep the trigger
-- for true XY/nullness changes while ignoring elevation-only updates.
--
-- This function predates schema.sql. Do not create it in databases where it is
-- absent, and do not replace an unknown deployed body. The reviewed production
-- definition had pg_get_functiondef md5 9997517e801c4dc233f86b26a5168fde;
-- the prosrc check lets the same reviewed body be tested in an isolated schema.
DO $patch$
DECLARE
  function_oid oid;
  function_definition text;
  function_source text;
  function_comment text;
  safe_comment constant text :=
    'peaks:destination-session-link-update:xy-only-with-rejection-v1';
  safe_body_marker constant text :=
    'peaks_destination_session_link_xy_guard_v1';
  reviewed_definition_md5 constant text :=
    '9997517e801c4dc233f86b26a5168fde';
  reviewed_source_md5 constant text :=
    'eea9ad395d9b4fe04c6c8630f4e4eee6';
BEGIN
  function_oid := to_regprocedure(
    format('%I.link_sessions_on_destination_update()', current_schema())
  );

  IF function_oid IS NULL THEN
    RAISE NOTICE 'link_sessions_on_destination_update absent — nothing to patch';
    RETURN;
  END IF;

  SELECT pg_get_functiondef(function_oid), p.prosrc,
         obj_description(function_oid, 'pg_proc')
  INTO function_definition, function_source, function_comment
  FROM pg_proc p
  WHERE p.oid = function_oid;

  IF function_comment = safe_comment THEN
    IF position(safe_body_marker IN function_definition) = 0
       OR position('ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)'
                   IN function_definition) = 0
       OR position('ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)'
                   IN function_definition) = 0
       OR position('(OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)'
                   IN function_definition) = 0
       OR position('OLD.location != NEW.location' IN function_definition) <> 0
       OR (
         length(function_definition) -
         length(replace(function_definition, 'FROM session_destination_rejections r', ''))
       ) / length('FROM session_destination_rejections r') <> 2 THEN
      RAISE EXCEPTION
        'link_sessions_on_destination_update has the safe comment but an unknown body';
    END IF;
    RAISE NOTICE 'link_sessions_on_destination_update already has the XY-only guard';
    RETURN;
  END IF;

  IF md5(function_definition) <> reviewed_definition_md5
     AND md5(function_source) <> reviewed_source_md5 THEN
    RAISE EXCEPTION
      'refusing to replace unknown link_sessions_on_destination_update definition (md5 %, prosrc md5 %) ',
      md5(function_definition), md5(function_source);
  END IF;

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

    -- Location changed in XY or nullness (and no boundary — boundary takes precedence).
    -- peaks_destination_session_link_xy_guard_v1
    ELSIF NEW.boundary IS NULL
      AND (
        (OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)
        OR ST_X(OLD.location::geometry) IS DISTINCT FROM ST_X(NEW.location::geometry)
        OR ST_Y(OLD.location::geometry) IS DISTINCT FROM ST_Y(NEW.location::geometry)
      ) THEN
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

  EXECUTE format(
    'COMMENT ON FUNCTION %I.link_sessions_on_destination_update() IS %L',
    current_schema(), safe_comment
  );

  function_oid := to_regprocedure(
    format('%I.link_sessions_on_destination_update()', current_schema())
  );
  SELECT pg_get_functiondef(function_oid), obj_description(function_oid, 'pg_proc')
  INTO function_definition, function_comment;

  IF function_comment <> safe_comment
     OR position(safe_body_marker IN function_definition) = 0
     OR position('(OLD.location IS NULL) IS DISTINCT FROM (NEW.location IS NULL)'
                 IN function_definition) = 0
     OR position('OLD.location != NEW.location' IN function_definition) <> 0
     OR (
       length(function_definition) -
       length(replace(function_definition, 'FROM session_destination_rejections r', ''))
     ) / length('FROM session_destination_rejections r') <> 2 THEN
    RAISE EXCEPTION 'link_sessions_on_destination_update XY-only guard verification failed';
  END IF;

  RAISE NOTICE 'link_sessions_on_destination_update patched with the XY-only and rejection guards';
END
$patch$;

COMMIT;
