-- Add the Ulu Sedim start for the standard Gunung Bintang route.
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
      'D9D5F83C31E201E729CF',
      'Ulu Sedim / Tree Top Walk',
      110.0,
      5.4124648,
      100.7810799,
      'MY',
      NULL,
      jsonb_build_object('osm_node', '6330125687'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/6330125687',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.forestry.gov.my/en/2016-06-07-02-31-39/2016-06-07-02-35-17/amenity-forests-state-park-forests',
        'official_permit_url', 'https://www.forestry.gov.my/en/2016-06-07-02-31-39/2016-06-07-02-35-17/amenity-forests-state-park-forests',
        'route_reference_url', 'https://www.alltrails.com/trail/malaysia/kedah/ulu-sedim-gunung-bintang-trail',
        'secondary_route_reference_url', 'https://www.gunungbagging.com/bintang/',
        'access_note', 'The standard route starts at Ulu Sedim near Tree Top Walk and follows the old cement logging road toward Pintu Rimba. Obtain the forest entry permit from Pejabat Hutan Daerah Kedah Selatan in Kulim and arrange a local guide before travel. The federal forestry page lists Gunung Bintang under PHD Kedah Selatan. Confirm the current permit process, guide rules, gate or ticket-barrier hours, parking, and whether the first four kilometres may be covered by an authorised motorbike. Do not assume the old online permit or past fees still apply.',
        'hazard_note', 'This is about 17.4 miles round trip with roughly 6,400 feet of gain and commonly takes two or three days; a one-day trip is only for very strong parties with an early start. Expect tropical heat, heavy rain, leeches, mud, stream crossings, steep roots, rough ropes, and long stretches far from help. Sun bears, elephants, snakes, wild boar, and large cats live in the reserve; stay with the guide and never approach wildlife. Reliable water is found in streams and at Sungai Kerian waterfall, but higher water near Taman Bunian is poor. Treat all water and carry enough above the waterfall.',
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
