-- Add the locked Barcroft Gate start for White Mountain Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, and OSM agree on the class 1 approach
-- that follows White Mountain Road from the Barcroft gate.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '6C17577409774491B963',
      'Barcroft Gate Trailhead',
      3566.0,
      37.557865,
      -118.235596,
      'US',
      'CA',
      jsonb_build_object('osm', '434805156'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/434805156',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/white-mountain-peak/150221',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/california/white-mountain-peak',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1422909',
        'access_note', 'White Mountain Road is rough and can require a high-clearance vehicle. The Barcroft gate is normally closed to motor vehicles. Check current Forest Service and University of California access, road, and closure rules before travel.',
        'hazard_note', 'This very high route has full exposure and little water. Altitude illness, lightning, snow, ice, strong wind, and sudden weather can make the climb hazardous.',
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
