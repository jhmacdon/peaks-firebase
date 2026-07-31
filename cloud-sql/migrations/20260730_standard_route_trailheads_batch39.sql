-- Add the upper Timber Creek start for North Schell Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the North Fork Timber
-- Creek drainage and north-ridge route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '8CBE40665E824C17A6E6',
      'Timber Creek Trailhead',
      2758.0,
      39.4006349,
      -114.6302878,
      'US',
      'NV',
      jsonb_build_object('osm', '10960085960'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/10960085960',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/timber-creek/163460',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/nevada/timber-creek-north-fork-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1925834',
        'access_note', 'Timber Creek Road is unpaved and rough past the campground, and the road is blocked near the upper start. Check current Humboldt-Toiyabe National Forest road, trail, fire, fee, and closure rules.',
        'hazard_note', 'The trail becomes faint and the upper route climbs open slopes and an exposed ridge. Stream flow, snow, lightning, heat, wind, wildfire smoke, and route-finding errors can make it hazardous.',
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
