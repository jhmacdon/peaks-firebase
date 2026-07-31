-- Add the Pass Creek road start for Diamond Peak's East Ridge.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the East Ridge route
-- from the upper Pass Creek road system.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'DD26116C08C972637917',
      'Diamond Peak East Ridge Trailhead',
      2320.0,
      44.1490751,
      -113.0328199,
      'US',
      'ID',
      jsonb_build_object('osm', '11969600527'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/11969600527',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/diamond-peak/152083',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/idaho/diamond-peak',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=562664',
        'access_note', 'The upper Pass Creek road is rough and may be controlled by seasonal gates. Check the current Caribou-Targhee National Forest motor-vehicle map and closure rules, leave lawful gates as found, and park without blocking the road.',
        'hazard_note', 'The unmaintained East Ridge has loose rock, steep scree, sustained Class 3 scrambling, exposure, and complex route-finding. Snow, ice, lightning, heat, smoke, and a long self-rescue can make it hazardous.',
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
