-- Add the exact Humuʻula Trail start for Mauna Kea's standard hiking route.
--
-- The University of Hawaiʻi lists the Humuʻula Trail and Summit Access Road
-- as designated hiking routes. Hikers park and register at the nearby Visitor
-- Information Station, then walk a few hundred feet up the road to this first
-- OpenStreetMap node on the named trail.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '0EAAEAF38B369646D124',
      'Humuʻula Trailhead',
      2810.0,
      19.7621390,
      -155.4564123,
      'US',
      'HI',
      jsonb_build_object('osm', '582324134'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/582324134',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_source_url', 'https://www.alltrails.com/trail/hawaii/hawaii/mauna-kea-humuula-trail',
        'route_reference_url', 'https://www.summitpost.org/mauna-kea-trail/157890',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3130257',
        'route_access_url', 'https://hilo.hawaii.edu/maunakea/visitor-information/permits',
        'parking_note', 'Park and register at the Maunakea Visitor Information Station, then walk a few hundred feet up the Summit Access Road to the signed Humuʻula Trail.',
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
