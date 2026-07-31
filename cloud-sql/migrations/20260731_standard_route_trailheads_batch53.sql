-- Add Tram Ton Pass for Fansipan's standard summit trail.
--
-- AllTrails, Peakbagger, SummitPost, and OSM agree on the Tram Ton line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'D4B4A310CC2A021EDFB0',
      'Tram Ton Pass Trailhead',
      1950.0,
      22.352987,
      103.774827,
      'VN',
      NULL,
      jsonb_build_object('osm_way', '235934528'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/235934528',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2130843',
        'route_reference_url', 'https://www.alltrails.com/trail/vietnam/lao-cai/mount-fanispan-trail',
        'summitpost_url', 'https://www.summitpost.org/fansipan/153761',
        'access_note', 'Hoàng Liên National Park controls the Tram Ton route. Current route information says hikers need a licensed guide, an official permit, and an entrance fee. Confirm the latest guide, permit, park, transport, and cable-car rules before planning.',
        'hazard_note', 'This is a long, steep ascent with repeated extra gain, rock scrambling, ladders, steps, exposed drops, and slick mud or rock in wet weather. Fog and heavy rain can hide the route. Carry suitable rain gear and use care on the descent.',
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
