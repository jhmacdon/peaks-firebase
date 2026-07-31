-- Add Sliezsky Dom for the Gerlachovský štít normal-route loop.
--
-- A guided summit track, TANAP rules, SummitPost, local guides, and OSM
-- agree on Velická próba for ascent and Batizovská próba for descent.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B56797F14E6217570842',
      'Sliezsky Dom Trailhead',
      1670.0,
      49.1560323,
      20.1565843,
      'SK',
      NULL,
      jsonb_build_object('osm_node', '13042640565'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/13042640565',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2698409',
        'route_reference_url', 'https://www.alltrails.com/trail/slovakia/presovsky-kraj/gerlachovsky-stit',
        'secondary_route_reference_url', 'https://www.summitpost.org/gerlachovsky-stit/150749',
        'official_access_url', 'https://www.tanap.sk/horolezectvo-2/',
        'parking_url', 'https://www.sliezskydom.sk/en/parking',
        'access_note', 'The normal-route loop starts at Sliezsky Dom. Parking at the hotel is limited to guests, costs a fee, and requires advance confirmation. The hotel can arrange guest transport from its Tatranská Polianka car park; other visitors must reach Sliezsky Dom by an allowed trail or other lawful transport. Most of the summit route is outside marked hiking trails and has OSM foot=permit access. TANAP requires advance online climbing registration, suitable climbing gear, route knowledge, identification, a valid national climbing-association card, and, for lower-difficulty climbing, proof of basic training. Check the current TANAP climbing periods, seasonal trail closures, weather, rescue notices, hotel access, and any guide rule before travel. Do not enter any closed descent trail.',
        'hazard_note', 'This is an exposed technical alpine climb, not a marked hike. The normal outing climbs Velická próba and descends Batizovská próba. It includes steep unmarked terrain, consequential scrambling, chains, iron steps or ladders, loose and wet rock, route-finding traps, rockfall, snow or ice, sudden storms, and serious fall exposure. Carry and know how to use a helmet, harness, rope and suitable alpine gear; winter or icy conditions require the matching snow and ice equipment and skills. Hire a certified local guide unless every member has current exposed alpine-climbing, navigation, rope, and rescue skills. Turn around for poor visibility, wet or icy rock, storms, crowd delays, closure, or any unsafe condition.',
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
