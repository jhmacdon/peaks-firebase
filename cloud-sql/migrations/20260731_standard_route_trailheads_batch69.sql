-- Add Gunung Mulu National Park headquarters for the official summit trek.
--
-- The park, current Peakbagger evidence, AllTrails, SummitPost, and OSM agree
-- on the Park HQ start and Camp 3/Camp 4 summit route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E14AC375D3BAA8196F20',
      'Gunung Mulu National Park Headquarters',
      31.0,
      4.042283,
      114.812525,
      'MY',
      NULL,
      jsonb_build_object('osm_way', '119207287'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/119207287',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3141619',
        'route_reference_url', 'https://www.alltrails.com/trail/malaysia/sarawak/gunung-mulu',
        'secondary_route_reference_url', 'https://www.summitpost.org/gunung-mulu/1021374',
        'official_access_url', 'https://mulupark.com/the-summit/',
        'access_note', 'The park requires advance booking for its guided four-day summit trek. The listed price includes a guide and camp fee, with a three-person minimum and a maximum group of six including guides and porters. The climb is not open to children under 16. Confirm current price and availability with the park, and pack out all rubbish.',
        'hazard_note', 'This is an extreme multi-day jungle climb with stream fords, Class 3 and exposed scrambling, severe humidity, heavy rain, mud, roots, slippery rock, cold summit weather, and long days. Carry food, emergency rations, sleeping gear, rain gear, warm layers, a headlamp, and sturdy boots. Follow the park guide and be ready for weather-driven schedule changes.',
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
       AND ST_DWithin(d.location, p.location, 250)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
