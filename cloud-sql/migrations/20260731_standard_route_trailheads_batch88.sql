-- Add the Ulu Kinta dam-road start for the standard Gunung Korbu route.
--
-- OSM, AllTrails, Gunung Bagging, and the federal forestry permit list agree
-- on this approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'F156AFDDC5D52FC0100E',
      'Gunung Korbu Trailhead (via Ulu Kinta Dam)',
      291.0,
      4.6495966,
      101.2409684,
      'MY',
      NULL,
      jsonb_build_object('osm_node', '5274883896'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/5274883896',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.forestry.gov.my/en/2016-06-07-02-31-39/2016-06-07-02-35-17/amenity-forests-state-park-forests',
        'official_permit_url', 'https://ecotourism.perakforestry.gov.my/',
        'route_reference_url', 'https://www.alltrails.com/trail/malaysia/perak/gunung-korbu',
        'secondary_route_reference_url', 'https://www.gunungbagging.com/korbu/',
        'access_note', 'The route starts at the end of the private Ulu Kinta dam road. Obtain the Perak Permanent Reserved Forest entry permit, dam-road permit, and any required registered Forestry Mountain Guide well before the trip. The federal forestry page lists Gunung Korbu under PHD Kinta / Manjung and links to the Perak reservation system; it describes a guide ratio of one guide to seven climbers. A local route guide advises allowing at least two weeks for both permits and lists dam-gate hours of 6am to 7pm. Confirm all rules, gate hours, guide details, and transport before travel. Do not enter without approval.',
        'hazard_note', 'This is a remote multi-day jungle route of about 15 kilometres each way. It has many river crossings, leeches, heavy rain, mud, route-finding in darkness, long summit days, and steep ladder, rock, and fixed-rope sections above Last Water Point. The usual plan camps at Kem Seroja and can require 13 to 18 hours on summit day. Flooded streams, storms, heat, exhaustion, or a late schedule can make retreat dangerous. Travel with the required guide, carry camping and emergency gear, and treat Kem Seroja, Kem Kijang, and Last Water Point as the main water sources.',
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
