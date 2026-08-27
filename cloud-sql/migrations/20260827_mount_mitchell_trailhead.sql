-- Add the trailhead for Mount Mitchell's standard ascent from Black Mountain
-- Campground. Temporary closures belong in trip-planning notices and do not
-- remove this established route from the catalog.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code, external_ids, metadata
) AS (
  VALUES
    (
      '4FEFBCFAF38F5447BC35',
      'Mount Mitchell Trailhead at Black Mountain Campground',
      913.515686035,
      35.7510434,
      -82.2200556,
      'US',
      'NC',
      jsonb_build_object('osm_node', '8253361773'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/8253361773',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'elevation_source', 'USGS 3DEP',
        'elevation_source_url', 'https://epqs.nationalmap.gov/v1/json?x=-82.2200556&y=35.7510434&units=Meters&wkid=4326&includeDate=false',
        'official_access_url', 'https://www.ncparks.gov/state-parks/mount-mitchell-state-park',
        'route_reference_url', 'https://www.fs.usda.gov/media/241197',
        'access_note', 'The standard Mount Mitchell Trail ascent starts at Black Mountain Campground. Keep current road, campground, weather, and trail notices as planning advisories rather than removing the established route from the catalog.',
        'catalog_audit', 'lower-48-ultras-2026-08-27'
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
