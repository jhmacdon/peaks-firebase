-- Add the South Loop start for Charleston Peak.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the Charleston Peak
-- Trail South Loop from the Cathedral Rock trailhead area.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '49607B13CE71459BAB7E',
      'Charleston Peak South Loop Trailhead',
      2329.0,
      36.255894,
      -115.645021,
      'US',
      'NV',
      jsonb_build_object('osm', '363844339'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/363844339',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/south-loop-trail/156402',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/nevada/charleston-peak-south-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1216553',
        'access_note', 'The route starts in the Cathedral Rock and Mount Charleston trailhead area. Check current Spring Mountains road, parking, fire, and trail closure rules before travel.',
        'hazard_note', 'This is a long high-altitude route with large elevation gain and exposed upper ridges. Heat, scarce water, snow, ice, lightning, loose rock, and strong wind can make the climb hazardous.',
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
