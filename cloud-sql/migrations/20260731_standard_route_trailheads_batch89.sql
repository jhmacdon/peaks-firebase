-- Add Kebun Sayur for the standard Lojing route to Gunung Yong Belar.
--
-- OSM, AllTrails, Gunung Bagging, and the federal forestry permit list agree
-- on this route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '40E54E63C7A9DC3B1C4E',
      'Kebun Sayur',
      1579.0,
      4.6227927,
      101.3999194,
      'MY',
      NULL,
      jsonb_build_object('osm_node', '10187707417'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/10187707417',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.forestry.gov.my/en/2016-06-07-02-31-39/2016-06-07-02-35-17/amenity-forests-state-park-forests',
        'official_permit_url', 'https://forestry.pahang.gov.my/e-ecopark/',
        'route_reference_url', 'https://www.alltrails.com/trail/malaysia/kelantan/gunung-yong-belar',
        'secondary_route_reference_url', 'https://www.gunungbagging.com/yong-belar/',
        'access_note', 'The standard Lojing route starts at Kebun Sayur, inside a private vegetable farm. Most hikers park or meet at Lojing Mosque and arrange an authorised four-wheel-drive transfer through the locked farm gate. Confirm the ride, return pickup, farm access, and current price before travel. Obtain the Pahang forestry permit in advance through e-ECOPARK. The federal forestry page lists Gunung Yong Belar under PHD Cameron Highlands. Confirm whether a registered Forestry Mountain Guide is required for the trip date; a guide is strongly advised. Do not cross the private gate or enter the forest without approval.',
        'hazard_note', 'The Kebun Sayur route is about 8.9 miles round trip with roughly 3,700 feet of total gain despite the high start. It follows an undulating ridge with repeated false summits, deep mud, slick roots and rock, steep hand-over-hand sections, and a long return with more climbing. Cold rain, fog, poor visibility, and hypothermia are serious risks. Water is found near Kem Tudung Periuk and Kem Kasut but should be treated and may be unreliable; carry enough for the full day. Start early, carry warm waterproof layers, navigation, a headlamp, and emergency shelter, and keep the four-wheel-drive pickup plan conservative.',
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
