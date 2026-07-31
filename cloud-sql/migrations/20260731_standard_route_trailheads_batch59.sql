-- Add Tang-e Galu for Alam Kuh's south-face Hesarchal normal route.
--
-- SummitPost and current local guide sources identify this as the easiest and
-- most popular route. OSM names both the approach and summit-bound paths.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '0AFD34ECA465755224F1',
      'Tang-e Galu Trailhead',
      2800.0,
      36.3575670,
      51.0086940,
      'IR',
      NULL,
      jsonb_build_object('osm_way', '195542134'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/195542134',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/alam-kooh/150420',
        'local_guide_url', 'https://iranonadventure.com/alam-kuh-the-southern-hesarchal-route-trekking-guide/',
        'access_note', 'Tang-e Galu is reached by a long rough road from Vandarbon and may require a local 4WD. Check current road, protected-area, camping, registration, guide, and foreign-traveler rules with the Roudbarak or Vandarbon mountaineering center before planning.',
        'hazard_note', 'The Hesarchal route is the normal south route but remains a serious high-altitude alpine climb. It crosses remote pathless-looking ground with snow or ice, scrambling, rockfall, avalanche, storm, exposure, stream, route-finding, rescue-delay, and altitude risk. Carry the gear and skills required for current conditions.',
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
