-- Add Mount Mitchell's upper summit parking access point.
--
-- North Carolina State Parks identifies the paved Summit Trail from the upper
-- parking area. This short walk is useful access data, but it is not the
-- catalog standard ascent. OpenStreetMap node 2795156655 is the west end of
-- the mapped Mount Mitchell Summit Trail.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code, external_ids, metadata
) AS (
  VALUES
    (
      '70579FE50135EE75DBE7',
      'Mount Mitchell Summit Trailhead',
      2004.9,
      35.7664108,
      -82.2652597,
      'US',
      'NC',
      jsonb_build_object('osm_node', '2795156655'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/2795156655',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'elevation_source', 'USGS 3DEP',
        'elevation_source_url', 'https://epqs.nationalmap.gov/v1/json?x=-82.2652597&y=35.7664108&units=Meters&wkid=4326&includeDate=false',
        'official_access_url', 'https://www.ncparks.gov/state-parks/mount-mitchell-state-park',
        'route_reference_url', 'https://www.ncparks.gov/planning-files/general-management-plan-mount-mitchell-state-park/open',
        'access_note', 'The paved Summit Trail starts by the upper summit parking area. This is a short summit access walk, not the standard mountain ascent from Black Mountain Campground. Check the park page for current road, weather, and trail notices when planning.',
        'catalog_audit', 'lower-48-state-parks-2026-08-26'
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
       AND ST_DWithin(d.location, p.location, 250)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
