-- Add the Likhubula start for Sapitwa Peak's standard Skyline route.
--
-- AllTrails, SummitPost, and two Peakbagger tracks agree on the approach
-- from Likhubula through Chisepo Hut to Sapitwa.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'BA20CCAF42B920FCCCF2',
      'Likhubula Forest Office',
      810.0,
      -15.939363,
      35.503430,
      'MW',
      'MU',
      jsonb_build_object('osm', '312938020'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/312938020',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/mount-mulanje/152471',
        'route_alltrails_url', 'https://www.alltrails.com/trail/malawi/mulanje/chisepo-hu-t-sapitwa-peak-guide-required',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2659633',
        'access_note', 'Check current forest entry, guide, permit, hut, and camping rules at Likhubula before travel. AllTrails marks the Chisepo Hut summit leg as guide required.',
        'hazard_note', 'The route is steep and long. The summit leg crosses granite slabs and boulders, includes exposed scrambling and short fixed ropes, and can become hard to follow in mist or rain.',
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
