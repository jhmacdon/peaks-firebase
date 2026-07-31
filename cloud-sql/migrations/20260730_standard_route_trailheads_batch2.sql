-- Add the official trailheads for the Lassen Peak and Humphreys Peak
-- standard routes.
--
-- The National Park Service names Lassen Peak Trailhead as the start of the
-- five-mile summit trail. Its OpenStreetMap trailhead point is 34 m from the
-- NPS event coordinate. The Forest Service publishes the Humphreys Trail 151
-- trailhead coordinate and names the lower Arizona Snowbowl lot as its start.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '7AC55BF2CB3506D28244',
      'Lassen Peak Trailhead',
      2590.8,
      40.4748645,
      -121.5057073,
      'US',
      'CA',
      jsonb_build_object('osm', '1801313492'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/1801313492',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.nps.gov/thingstodo/hikelassenpeak.htm',
        'route_source_coordinate_url', 'https://www.nps.gov/planyourvisit/event-details.htm?id=15624E68-978D-C4D2-92BA561E8E75AC76',
        'route_source_coordinate_offset_m', 34.1,
        'catalog_audit', 'standard-route-goal-2026-07-30'
      )
    ),
    (
      '6951A7AEFD81D4CAE9AB',
      'Humphreys Trail No. 151 Trailhead',
      2846.8,
      35.3312222,
      -111.7117222,
      'US',
      'AZ',
      jsonb_build_object('usfs_trail', '151'),
      jsonb_build_object(
        'source', 'us-forest-service',
        'source_url', 'https://www.fs.usda.gov/r03/coconino/recreation/trails/humphreys-trail-no-151',
        'source_license', 'Public domain',
        'source_attribution', 'U.S. Forest Service',
        'route_source_url', 'https://www.fs.usda.gov/r03/coconino/recreation/trails/humphreys-trail-no-151',
        'catalog_audit', 'standard-route-goal-2026-07-30'
      )
    )
),
prepared AS (
  SELECT
    id,
    name,
    lower(name) AS search_name,
    elevation,
    ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
    country_code,
    state_code,
    external_ids,
    metadata
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
  p.country_code,
  p.state_code,
  p.external_ids,
  p.metadata,
  now(),
  now()
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM destinations d
  WHERE d.external_ids @> p.external_ids
     OR (
       d.search_name = p.search_name
       AND d.location IS NOT NULL
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
