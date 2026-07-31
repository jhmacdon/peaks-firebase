-- Add the mapped southbound trail start at Arousse for Jebel M'Goun.
--
-- OSM, a successful summit track, SummitPost, and a current local guide
-- agree on the Arousse/Ait Bouguemez approach and the long southern ridge.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '7140073B00C6B9DFB290',
      'Arousse South Trailhead',
      1920.0,
      31.6115961,
      -6.4869283,
      'MA',
      NULL,
      jsonb_build_object('osm_node', '2331061798'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/2331061798',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/m-goun/150886',
        'current_guide_url', 'https://www.amazing-toubkal-trek.com/trekking-jebel-mgoun/',
        'protected_area_url', 'https://www.unesco.org/en/iggp/mgoun-unesco-global-geopark',
        'access_note', 'The mapped summit route starts on the southbound path at the edge of Arousse, reached through Ait Bouguemez. The usual trip is a remote multi-day trek through the M''Goun massif, commonly using local lodging, a refuge, or camp. A current local guide calls May through October the usual trekking season and strongly recommends hiring a local guide. Confirm road state, lodging or camp arrangements, water, local guide requirements, weather, and any local closure before travel. Respect village land, geopark rules, and current instructions on site.',
        'hazard_note', 'This is a very long, remote high-altitude route with more than 2,000 m of total ascent on a full return trip. Expect heat and strong sun low down, cold and high wind on the exposed summit ridge, loose rock, steep scree, snow or ice outside the main season, weak phone service, scarce water, and difficult rescue. Carry enough food and treated water, warm and waterproof layers, sun protection, navigation, a headlamp, first aid, and a large turnaround margin. Acclimatize, start early, use winter gear when conditions require it, and turn around for storms, poor visibility, unsafe snow, illness, or closure.',
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
