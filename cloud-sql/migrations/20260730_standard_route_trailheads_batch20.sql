-- Add the Pintu Rimba start for Gunung Kerinci's standard summit trail.
--
-- AllTrails, SummitPost, Peakbagger, and the public OSM line agree on the
-- direct climb from Pintu Rimba through the numbered posts and shelters.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C78E40E05CED9B8311F2',
      'Pintu Rimba',
      1800.0,
      -1.7677128,
      101.2663404,
      'ID',
      NULL,
      jsonb_build_object('osm', '6395076373'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/6395076373',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/normal-and-only/156502',
        'route_alltrails_url', 'https://www.alltrails.com/trail/indonesia/jambi/mount-kerinci',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2610315',
        'access_note', 'Check Kerinci Seblat National Park entry, permit, guide, and closure rules before travel.',
        'hazard_note', 'Kerinci is an active volcano. The route is steep, muddy, exposed above treeline, and prone to hard rain and poor visibility. Do not enter a closed summit area.',
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

UPDATE destinations
SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{route_reference_url}',
      to_jsonb('https://www.summitpost.org/normal-and-only/156502'::text),
      true
    ),
    updated_at = now()
WHERE id = 'C78E40E05CED9B8311F2';

COMMIT;
