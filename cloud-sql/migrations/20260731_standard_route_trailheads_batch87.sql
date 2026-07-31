-- Add the Kaduengang start for the standard Gunung Karang summit route.
--
-- OSM, Gunung Bagging, and recent private Peakbagger comparison tracks agree
-- on this route. The private tracks are comparison evidence only.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E5EBB1DD24C26D0B254E',
      'Pintu Sumur 7 / Kaduengang Registration',
      842.0,
      -6.2616700,
      106.0718300,
      'ID',
      'BT',
      jsonb_build_object('osm_way', '1301446561'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1301446561',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.gunungbagging.com/karang/',
        'secondary_route_reference_url', 'https://stevensong.com/international/indonesia/gunung-karang/',
        'private_comparison_page_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3015819',
        'access_note', 'Start at Pintu Sumur 7 and the small registration office above Kaduengang. The last village road is narrow, steep, and rough. A recent October 2025 climb report records a simple registration form, a local route fee, and a separate parking fee; prices and rules can change. Park at the office because the route above becomes a narrow stone path. Ask before entering, follow the current village rules, and respect farms, shelters, pilgrims, graves, prayer sites, and the sacred summit area.',
        'hazard_note', 'The Kaduengang route is about 5.2 miles round trip with roughly 3,070 feet of gain. It climbs steep farm paths and a wet forest trail with deep mud, slippery roots, short class 2 scrambling, and drops beside the path. Heat and humidity can be severe even in the dry season. Near the top, the route crosses a false summit, loses elevation, and continues about 500 metres through dense forest to the true summit. Start early, carry enough water, rain gear, navigation, and a headlamp, and leave a wide margin for the slippery descent.',
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
