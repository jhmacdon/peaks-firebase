-- Add the Sandfell start for Hvannadalshnúkur's standard Sandfellsleið route.
--
-- Two current summit tracks, AllTrails, SummitPost, and OSM agree on this
-- roadside start and the Sandfellsleið glacier route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '0504EA4C0CB9E07CA37B',
      'Sandfell Trailhead',
      101.0,
      63.944761,
      -16.793203,
      'IS',
      NULL,
      jsonb_build_object('osm_way', '620059053'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/620059053',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3224693',
        'route_reference_url', 'https://www.alltrails.com/trail/iceland/eastern/hvannadalshnjukur',
        'secondary_route_reference_url', 'https://www.summitpost.org/hvannadalshnukur/152942',
        'official_access_url', 'https://www.vatnajokulsthjodgardur.is/en/areas/skaftafell',
        'access_note', 'Sandfellsleið starts beside Route 1 at Sandfell in Vatnajökull National Park. Check current park, road, weather, snow, and glacier conditions before leaving. This is a roped glacier climb; use a qualified guide unless every team member has current glacier travel and crevasse-rescue skill.',
        'hazard_note', 'This long glaciated mountaineering route crosses crevassed and fast-changing ice. Crevasses, weak snow bridges, avalanche terrain, steep snow, ice, whiteout, wind, cold, rockfall, and route drift can be fatal. Carry and know how to use a rope, harness, crampons, ice axe, glacier rescue gear, navigation tools, and full alpine clothing. Turn around when weather, snow, or team pace makes the route unsafe.',
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
