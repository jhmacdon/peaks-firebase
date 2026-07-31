-- Add the lower FS 6422 route start for Cleveland Mountain.
--
-- SummitPost, WTA, The Mountaineers, Peakbagger, and OSM support the
-- Temple Mountain Road and north-ridge standard route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '949C3C8A353D7C1D0932',
      'FS 6422 / Temple Mountain Road Route Start',
      274.0,
      47.7139320,
      -121.4142380,
      'US',
      'WA',
      jsonb_build_object('osm_way', '1422762654'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1422762654',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3179137',
        'route_reference_url', 'https://www.summitpost.org/cleveland-mountain/517649',
        'wta_reference_url', 'https://www.wta.org/go-hiking/hikes/cleveland-mountain',
        'mountaineers_reference_url', 'https://www.mountaineers.org/activities/routes-places/cleveland-mountain',
        'access_note', 'Park near the lower end of FS 6422 unless current legal access and road conditions support a higher start. The rough, narrow road has washouts and few turnarounds. Check current forest-road, parking, pass, fire, and closure information before travel.',
        'hazard_note', 'This remote scramble needs route-finding and climbing skill. The north ridge has exposed Class 2-3 terrain, and the upper mountain has steep avalanche slopes, cliffs, brush, loose ground, and tree or rock moats. Snow, ice, wet rock, smoke, or poor visibility can make the route much more dangerous.',
        'catalog_audit', 'standard-route-goal-2026-07-31'
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
