-- Add the Colorado trailheads needed for the 2026-07-27 standard-route batch.
--
-- OpenStreetMap is the coordinate source. The linked 14ers.com pages confirm
-- the trailhead names and their use for the chosen standard routes.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, osm_type, osm_id, route_source_url
) AS (
  VALUES
    ('219D35913C5D0397ED95', 'Baldwin Gulch Trailhead',  2865.0, 38.7100421, -106.2916335, 'way',  '527150251',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sw12'),
    ('94F0C1CE8A14286B9F99', 'Castle Creek Trailhead',   2987.0, 39.0288834, -106.8079893, 'way',  '17121341',    'https://www.14ers.com/php14ers/trailheadsview.php?thparm=er01'),
    ('C410CF1FB652D72E13DF', 'Yankee Boy Basin Trailhead',3459.0,37.9950004, -107.7847170, 'way',  '361348828',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj07'),
    ('EC7F585E18BFDD5CF857', 'South Colony Lakes Trailhead',3368.0,37.9761816,-105.5065336,'way', '233237471',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sc03'),
    ('D64EE25F1294DADD64C9', 'Purgatory Trailhead',      2670.0, 37.6300665, -107.8061880, 'way',  '558860566',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj11'),
    ('A1CDE8E1D27799C8712C', 'Nellie Creek Trailhead',   3475.0, 38.0625857, -107.4220273, 'node', '177168643',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj01'),
    ('EFAB9A40B145B84B5DAF', 'American Basin Trailhead', 3536.0, 37.9200140, -107.5165038, 'way',  '707981506',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj12'),
    ('0F6324C02DFB998487B1', 'Lake Como Road Trailhead', 2347.0, 37.5385298, -105.5760617, 'way',  '17004120',    'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sc01'),
    ('F88500755F4DE6F283C9', 'Rock of Ages Trailhead',   3155.0, 37.8829932, -108.0185987, 'way',  '1484421334',  'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj04'),
    ('20662104C7EE6E9A1136', 'Kilpacker Trailhead',      3048.0, 37.7968704, -108.0386820, 'node', '2572187098',  'https://www.14ers.com/route.php?route=kilp0'),
    ('AD30E99774193FD02457', 'Half Moon Pass Trailhead', 3146.0, 39.5005357, -106.4331971, 'node', '11186993666', 'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sw25'),
    ('BE26C53F8339934849AD', 'Silver Creek Trailhead',   3170.0, 37.9367867, -107.4606919, 'way',  '383626225',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sj13'),
    ('95BE20144379E778FB78', 'Willow Creek Trailhead',   2682.0, 37.9888556, -105.6627379, 'node', '1029135759',  'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sc04'),
    ('691DE568C2AE21EC3F25', 'Huerfano/Lily Lake Trailhead',3277.0,37.6236500,-105.4727987,'way',  '629713627',   'https://www.14ers.com/php14ers/trailheadsview.php?thparm=sc02')
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    jsonb_build_object('osm', osm_id) AS external_ids,
    jsonb_build_object(
      'source', 'openstreetmap',
      'source_url', 'https://www.openstreetmap.org/' || osm_type || '/' || osm_id,
      'source_license', 'ODbL 1.0',
      'source_attribution', '© OpenStreetMap contributors',
      'route_source_url', route_source_url,
      'catalog_audit', 'colorado-standard-routes-2026-07-27'
    ) AS metadata,
    osm_id
  FROM incoming
)
INSERT INTO destinations (
  id,
  name,
  search_name,
  elevation,
  prominence,
  location,
  geohash,
  type,
  activities,
  features,
  owner,
  country_code,
  state_code,
  external_ids,
  metadata,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.name,
  p.search_name,
  p.elevation,
  NULL,
  p.location,
  NULL,
  'point',
  ARRAY['outdoor-trek']::activity_type[],
  ARRAY['trailhead']::destination_feature[],
  'peaks',
  'US',
  'CO',
  p.external_ids,
  p.metadata,
  now(),
  now()
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM destinations d
  WHERE d.external_ids @> jsonb_build_object('osm', p.osm_id)
     OR (
       d.search_name = p.search_name
       AND d.location IS NOT NULL
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
