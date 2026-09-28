-- Correct the legacy balcony pin and retain its ID and existing links.
-- Source: https://www.openstreetmap.org/node/1733479723 (version 6).
-- See docs/data-audits/2026-09-28-dirty-harrys-balcony.md.
-- This single DO statement is atomic. For a preview, run it inside BEGIN
-- and ROLLBACK. Apply with psql -v ON_ERROR_STOP=1 -f <this file>.
DO $repair$
DECLARE
  keeper_id CONSTANT text := 'hYq0TiVHKb5zFQsm519H';
  duplicate_id CONSTANT text := '2EF77C90D623341371D5';
  keeper destinations%ROWTYPE;
  duplicate destinations%ROWTYPE;
  target geography := ST_SetSRID(ST_MakePoint(-121.6102647, 47.4337029, 769.43359375), 4326)::geography;
  fk record;
  has_reference boolean;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  -- Block concurrent FK inserts while checking and removing the duplicate.
  PERFORM id FROM destinations WHERE id IN (keeper_id, duplicate_id) ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT keeper FROM destinations WHERE id = keeper_id;
  SELECT * INTO duplicate FROM destinations WHERE id = duplicate_id;

  IF NOT FOUND THEN
    IF keeper.location IS NOT NULL
       AND ST_DWithin(keeper.location, target, 0.01)
       AND keeper.external_ids->>'osm_node' = '1733479723'
       AND keeper.metadata->>'coordinate_repair' = '20260928_dirty_harrys_balcony' THEN
      RAISE NOTICE 'Dirty Harry''s Balcony is already corrected';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Duplicate is missing but the keeper has not been corrected';
  END IF;

  IF keeper.name IS DISTINCT FROM 'Dirty Harrys Balcony'
     OR keeper.owner IS DISTINCT FROM 'peaks'
     OR keeper.location IS NULL
     OR NOT ST_DWithin(keeper.location, ST_SetSRID(ST_MakePoint(-121.61243, 47.434126), 4326)::geography, 0.01)
     OR keeper.elevation IS DISTINCT FROM 796::double precision
     OR keeper.boundary IS NOT NULL
     OR duplicate.name IS DISTINCT FROM 'Dirty Harry''s Balcony'
     OR duplicate.owner IS DISTINCT FROM 'peaks'
     OR duplicate.location IS NULL
     OR NOT ST_DWithin(duplicate.location, target, 0.01)
     OR duplicate.elevation IS DISTINCT FROM 769.43359375::double precision
     OR duplicate.external_ids->>'osm_node' IS DISTINCT FROM '1733479723'
     OR duplicate.boundary IS NOT NULL THEN
    RAISE EXCEPTION 'Balcony identity or coordinates changed; review again before applying';
  END IF;

  -- These values cannot be merged by this narrowly scoped repair.
  IF duplicate.hero_image IS NOT NULL OR duplicate.description IS NOT NULL
     OR duplicate.explicitly_saved
     OR COALESCE(duplicate.session_count_offset, 0) <> 0
     OR COALESCE(duplicate.success_count_offset, 0) <> 0
     OR duplicate.averages_offset IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate has new content or offsets; review before deleting';
  END IF;

  -- The only observed duplicate link is already present on the keeper.
  -- Compare every column, including relation and manual/auto source.
  IF EXISTS (
    SELECT 1 FROM session_destinations d
    WHERE d.destination_id = duplicate_id
      AND NOT EXISTS (
        SELECT 1 FROM session_destinations k
        WHERE k.destination_id = keeper_id
          AND (to_jsonb(k) - 'destination_id') = (to_jsonb(d) - 'destination_id')
      )
  ) THEN
    RAISE EXCEPTION 'Duplicate has a session link not already preserved on the keeper';
  END IF;

  -- Check every other live FK, including tables added after this repair.
  -- Abort rather than let ON DELETE CASCADE or SET NULL lose a reference.
  FOR fk IN
    SELECT c.conrelid, a.attname, cardinality(c.conkey) AS key_count
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'destinations'::regclass AND c.contype = 'f'
      AND c.conrelid <> 'session_destinations'::regclass
  LOOP
    IF fk.key_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected composite destination FK on %', fk.conrelid::regclass;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', fk.conrelid::regclass, fk.attname)
      INTO has_reference USING duplicate_id;
    IF has_reference THEN
      RAISE EXCEPTION 'Duplicate has a reference in %.%; review before deleting', fk.conrelid::regclass, fk.attname;
    END IF;
  END LOOP;

  UPDATE destinations
  SET name = duplicate.name,
      search_name = duplicate.search_name,
      location = target,
      elevation = duplicate.elevation,
      geohash = ST_GeoHash(target::geometry, 12),
      -- Keep the legacy summit classification and its history; also identify
      -- the viewpoint so the OSM importer recognizes the merged record.
      features = ARRAY(SELECT DISTINCT unnest(keeper.features || duplicate.features)),
      country_code = COALESCE(keeper.country_code, duplicate.country_code),
      state_code = COALESCE(keeper.state_code, duplicate.state_code),
      external_ids = COALESCE(keeper.external_ids, '{}'::jsonb) || duplicate.external_ids,
      metadata = COALESCE(keeper.metadata, '{}'::jsonb) || COALESCE(duplicate.metadata, '{}'::jsonb)
        || jsonb_build_object('coordinate_repair', '20260928_dirty_harrys_balcony',
                              'previous_lat', 47.434126, 'previous_lng', -121.61243),
      updated_at = now()
  WHERE id = keeper_id;

  DELETE FROM destinations WHERE id = duplicate_id;

  -- Let clients refresh sessions that embed this destination's location.
  UPDATE tracking_sessions SET server_updated_at = now()
  WHERE id IN (SELECT session_id FROM session_destinations WHERE destination_id = keeper_id);

  IF (SELECT count(*) FROM destinations WHERE id IN (keeper_id, duplicate_id)) <> 1
     OR NOT EXISTS (SELECT 1 FROM destinations WHERE id = keeper_id
                    AND ST_DWithin(location, target, 0.01)
                    AND elevation = ST_Z(location::geometry)) THEN
    RAISE EXCEPTION 'Balcony repair verification failed';
  END IF;
END
$repair$;
