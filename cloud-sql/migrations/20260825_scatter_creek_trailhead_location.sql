-- Correct the existing Scatter Creek trailhead row, which was placed at the
-- nearby South Creek trailhead instead of the Scatter Creek route start.
--
-- Primary coordinate source: OpenStreetMap node 12550193743, tagged
-- highway=trailhead and name=Scatter Creek Trailhead (retrieved 2026-08-25).
-- Cross-check: USFS Recreation Opportunities site 59417 places the same
-- trailhead at 48.434373, -120.520423, 96 m from the OSM point. The corrected
-- OSM point is 25 m from the imported Abernathy Peak route start, within the
-- 100 m match radius for trailheads.

BEGIN;

DO $$
DECLARE
  current_location geography;
  current_features destination_feature[];
BEGIN
  SELECT location, features
    INTO current_location, current_features
    FROM destinations
   WHERE id = 'YYhaaSnzdNUdl8ZWWzDF';

  IF current_location IS NULL THEN
    IF current_database() NOT LIKE '%\_test' ESCAPE '\' THEN
      RAISE EXCEPTION 'Scatter Creek trailhead destination YYhaaSnzdNUdl8ZWWzDF is missing';
    END IF;
    RETURN;
  END IF;

  IF NOT ('trailhead'::destination_feature = ANY(current_features)) THEN
    RAISE EXCEPTION 'destination YYhaaSnzdNUdl8ZWWzDF is no longer a trailhead';
  END IF;

  IF NOT (
    ST_DWithin(
      current_location,
      ST_SetSRID(ST_MakePoint(-120.53214, 48.439716), 4326)::geography,
      5
    )
    OR ST_DWithin(
      current_location,
      ST_SetSRID(ST_MakePoint(-120.5198575, 48.4351460), 4326)::geography,
      1
    )
  ) THEN
    RAISE EXCEPTION 'refusing to replace an unknown Scatter Creek trailhead location';
  END IF;
END $$;

UPDATE destinations
   SET location = ST_SetSRID(
         ST_MakePoint(
           -120.5198575,
           48.4351460,
           ST_Z(location::geometry)
         ),
         4326
       )::geography,
       external_ids = COALESCE(external_ids, '{}'::jsonb)
         || jsonb_build_object('osm', '12550193743'),
       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'coordinate_source', 'openstreetmap',
         'coordinate_source_url', 'https://www.openstreetmap.org/node/12550193743',
         'coordinate_cross_check_source', 'usfs_recreation_opportunities',
         'coordinate_cross_check_id', '59417',
         'coordinate_cross_check_url', 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0',
         'coordinate_reviewed_at', '2026-08-25'
       ),
       updated_at = now()
 WHERE id = 'YYhaaSnzdNUdl8ZWWzDF';

DO $$
DECLARE
  corrected_location geography;
  corrected_external_ids jsonb;
BEGIN
  SELECT location, external_ids
    INTO corrected_location, corrected_external_ids
    FROM destinations
   WHERE id = 'YYhaaSnzdNUdl8ZWWzDF';

  IF corrected_location IS NULL THEN
    RETURN;
  END IF;

  IF NOT ST_DWithin(
    corrected_location,
    ST_SetSRID(ST_MakePoint(-120.5198575, 48.4351460), 4326)::geography,
    1
  ) THEN
    RAISE EXCEPTION 'Scatter Creek trailhead coordinate correction did not apply';
  END IF;

  IF corrected_external_ids->>'osm' IS DISTINCT FROM '12550193743' THEN
    RAISE EXCEPTION 'Scatter Creek trailhead is missing its reviewed OSM node';
  END IF;

  IF NOT ST_DWithin(
    corrected_location,
    ST_SetSRID(ST_MakePoint(-120.519953, 48.434929), 4326)::geography,
    destination_match_radius(ARRAY['trailhead']::destination_feature[])
  ) THEN
    RAISE EXCEPTION 'Scatter Creek trailhead remains outside the Abernathy route match radius';
  END IF;
END $$;

COMMIT;
