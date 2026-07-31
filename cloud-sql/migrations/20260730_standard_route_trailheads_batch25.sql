-- Add the Hidden Forest start for Hayford Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the route from
-- Hidden Forest Parking through Deadman Canyon and past the cabin.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '6BA4F01A240515DAFC48',
      'Hidden Forest Parking',
      1790.0,
      36.6289280,
      -115.2880510,
      'US',
      'NV',
      jsonb_build_object('osm', '44887281'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/44887281',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/hayford-peak/153921',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/nevada/hayford-peak--2',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1045914',
        'access_note', 'Check current Desert National Wildlife Refuge access and road conditions before travel. The long dirt approach can require high clearance after storms.',
        'hazard_note', 'The route is long, remote, rocky, and exposed to desert heat. Water at the Hidden Forest spring is not guaranteed; carry enough for the full trip.',
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
