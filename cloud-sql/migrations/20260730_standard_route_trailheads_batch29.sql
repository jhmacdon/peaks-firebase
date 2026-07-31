-- Add the Palm Springs Aerial Tramway start for San Jacinto Peak.
--
-- The popular route follows the named Round Valley and Peak trails from the
-- upper tram station to the summit.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '39873C2AA9554A9C8C57',
      'Palm Springs Aerial Tramway Mountain Station',
      2591.0,
      33.812728,
      -116.638899,
      'US',
      'CA',
      jsonb_build_object('osm', '46910671'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/46910671',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/san-jacinto-peak/150673',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/california/san-jacinto-peak-from-the-tramway',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=657450',
        'access_note', 'The route depends on the paid Palm Springs Aerial Tramway. Check current tram hours, ticket rules, wilderness permits, and park closures before travel, and leave enough time for the last tram down.',
        'hazard_note', 'Snow and ice can cover the trail well into spring. The rocky summit finish, high altitude, heat, strong wind, and fast weather changes can make the route hazardous.',
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
