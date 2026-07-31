-- Add the eastern start of Mount Stanley's Central Circuit approach.
--
-- The OSM Central Circuit relation and recent Peakbagger trip notes agree on
-- the Nyakalengija approach. The point below is the first route node.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'C2E119BEE6AF1DE83769',
      'Rwenzori Central Circuit Trailhead',
      1646.0,
      0.3569785,
      30.0254721,
      'UG',
      NULL,
      jsonb_build_object('osm', '739608246'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/739608246',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_relation_url', 'https://www.openstreetmap.org/relation/8386254',
        'route_reference_url', 'https://www.summitpost.org/margherita-peak-via-margherita-glacier/212962',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2424236',
        'route_park_url', 'https://ugandawildlife.org/national-parks/rwenzori-mountains/',
        'route_safety_url', 'https://ugandawildlife.org/news/hiking-margherita-peak-resumes/',
        'access_note', 'Arrange park entry, guides, porters, huts, and ranger support with Uganda Wildlife Authority or an approved local operator before travel.',
        'hazard_note', 'The summit route crosses the Margherita Glacier and steep fixed-rope rock. Crevasses, ice, rockfall, exposure, altitude illness, storms, and failing fixed gear can be fatal. Carry glacier and climbing gear and follow current UWA route instructions.',
        'route_change_note', 'UWA reopened the summit route in August 2024 after adding a bridge across the glacier crevasse and more climbing ropes. Check for newer closures or route changes.',
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
