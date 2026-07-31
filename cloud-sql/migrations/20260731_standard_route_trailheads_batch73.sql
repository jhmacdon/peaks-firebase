-- Add Pos 1 for Gunung Raung's true-summit route from Kalibaru.
--
-- Two summit tracks, AllTrails, Gunung Bagging, a current trip report, and
-- OSM agree on the Kalibaru trail and this common motorcycle-accessed start.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '194DF2D864865A0B8DFE',
      'Gunung Raung Pos 1 Trailhead',
      904.0,
      -8.203760,
      114.001350,
      'ID',
      'JI',
      jsonb_build_object('osm_way', '815504438'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/815504438',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2694400',
        'route_reference_url', 'https://www.alltrails.com/trail/indonesia/east-java/gunung-raung',
        'secondary_route_reference_url', 'https://www.gunungbagging.com/raung/',
        'access_reference_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3015189',
        'access_note', 'The true-summit route starts at Pos 1 above Kalibaru after registration in Wonorejo and rough motorcycle access. Gunung Bagging lists a per-hiker registration fee; confirm the current amount and arrange it through an expert local guide. A recent ascent also reports a required health check and ranger briefing. Confirm current volcanic, route, registration, and closure status before travel.',
        'hazard_note', 'This remote three-day route has no dependable water and reaches one of Indonesia''s most exposed summit traverses. Carry all water or arrange a water porter. Above Camp 7 expect narrow ridges with sheer drops, loose scree, rockfall, near-vertical rope sections, an abseil, strong wind, darkness, and active-volcano hazards. Use an expert local guide, helmet, harness, rope, and suitable climbing gear. Do not attempt the true summit in rain, high wind, poor visibility, or during volcanic restrictions.',
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
