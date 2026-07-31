-- Add the exact Besakih start for Gunung Agung's long summit route.
--
-- AllTrails and recent Peakbagger reports agree on the Pura Besakih approach.
-- The coordinate below is the first OpenStreetMap node on the named Besakih
-- trail. Current reports also agree that hikers use a local guide.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '36D61C3CB8C94CB0DEF5',
      'Pura Besakih Trailhead',
      1131.0,
      -8.3727034,
      115.4532269,
      'ID',
      NULL,
      jsonb_build_object('osm', '314905706'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/314905706',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.alltrails.com/trail/indonesia/bali--3/mount-agung',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3123636',
        'route_access_url', 'https://inivie.com/discover-bali/mount-agung-bali',
        'volcano_status_url', 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
        'guide_note', 'Use a licensed local guide and check for volcano or ceremony closures before leaving.',
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
