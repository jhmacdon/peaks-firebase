-- Add the East Fork start for Bashful Peak's standard west-ridge route.
--
-- Peakbagger, SummitPost, AK Mountain, and OSM agree on this line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '136548F626ECB807F628',
      'East Fork Trailhead',
      321.0,
      61.314959,
      -148.971925,
      'US',
      'AK',
      jsonb_build_object('osm_way', '1084310248'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1084310248',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3262827',
        'route_reference_url', 'https://www.summitpost.org/bashful-peak/1041264',
        'local_reference_url', 'https://www.akmountain.com/2013/08/01/bashful-peak-west-ridge/',
        'access_note', 'This track starts at the East Fork trail after the long Eklutna Lake approach, which parties often reach by bicycle. Confirm current Chugach State Park, road, trail, camping, fee, and bicycle rules before planning.',
        'hazard_note', 'Bashful Peak is a long, remote and exposed climb with brush, moraine, steep grass, loose scree, rockfall, rotten gullies, scrambling, snow or ice, cliffs, and limited rescue. The upper west ridge and Chickenshit Gully can require a rope and rappel skills. Teams must choose a safe line and gear for current conditions.',
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
