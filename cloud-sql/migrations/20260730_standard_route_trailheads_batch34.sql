-- Add the ski-area start for Mount Lemmon's short standard hike.
--
-- SummitPost, Peakbagger, OSM, and the nearby AllTrails routes agree on the
-- public ski-area approach to Mount Lemmon's summit road and meadow paths.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '0A0AE3B2C06A453E88D3',
      'Mount Lemmon Ski Valley Trailhead',
      2542.0,
      32.448690,
      -110.780888,
      'US',
      'AZ',
      jsonb_build_object('osm', '38407422'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/38407422',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/mt-lemmon/151231',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/arizona/aspen-draw',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=371938',
        'access_note', 'The route starts at the Mount Lemmon Ski Valley parking area. Check current Coronado National Forest, ski-area, parking, road, fire, and seasonal closure rules before travel.',
        'hazard_note', 'The route crosses active ski-area and summit-road terrain. Lightning, snow, ice, heat, wildfire smoke, vehicles, and rapid weather changes can make the route hazardous.',
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
