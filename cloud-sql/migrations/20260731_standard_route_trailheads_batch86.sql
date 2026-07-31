-- Add the Panderman permit-office start for the standard Gunung Buthak route.
--
-- OSM, AllTrails, and three private Peakbagger comparison tracks agree on
-- this start. The private tracks are comparison evidence only.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '9B8B9A00D8A3CF404030',
      'Pos Perizinan Panderman',
      1342.0,
      -7.8893125,
      112.4970562,
      'ID',
      'JI',
      jsonb_build_object('osm_node', '13944250401'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/13944250401',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.instagram.com/buthak_panderman_mountain/',
        'access_news_url', 'https://radarbatu.jawapos.com/wisata-kuliner/2603180012/setelah-ditutup-sebulan-gunung-panderman-dan-buthak-siap-dibuka-28-maret',
        'route_reference_url', 'https://www.alltrails.com/trail/indonesia/east-java/gunung-buthak',
        'secondary_route_reference_url', 'https://www.peakbagger.com/peak.aspx?pid=12996',
        'access_note', 'Start at the Panderman permit office and parking area. Register, pay the current fee, and follow the operator''s check-in and waste rules. Access can close for trail work, ecosystem recovery, fire, or severe weather. A local report dated 18 March 2026 said the route was due to reopen on 28 March after a closure that began on 16 February; check the operator''s current notice before travel. Motorcycle access above the permit office changes and must not be assumed. The OSM parking record was checked on 16 June 2026.',
        'hazard_note', 'The standard Panderman route is about 14 miles round trip with roughly 5,000 feet of gain. It is a long, steep tropical hike through forest and exposed high ground. The first posts and the final summit climb are steep; wet soil and rock become very slippery. Expect mud, heat, heavy rain, lightning, poor visibility, loose footing, smoke, and a long descent. Carry enough water, food, rain gear, navigation, a headlamp, and a wide turnaround margin. Dry-season travel is safer, but closures and local rules still apply.',
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
