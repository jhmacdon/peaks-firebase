-- Add Kahiltna Base Camp for Denali's West Buttress route.
--
-- AllTrails, Peakbagger, SummitPost, NPS, and OSM agree on the West Buttress
-- from Kahiltna Base Camp as Denali's standard route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '2417E1F0DAE3CAD17FF3',
      'Kahiltna Base Camp',
      2195.0,
      62.9681222,
      -151.1713895,
      'US',
      'AK',
      jsonb_build_object('osm_way', '1133167907'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1133167907',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/alaska/mount-denali-west-buttress',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=660560',
        'route_reference_url', 'https://www.summitpost.org/west-buttress/159690',
        'nps_reference_url', 'https://www.nps.gov/dena/planyourvisit/expeditionplanning.htm',
        'nps_registration_url', 'https://www.nps.gov/dena/planyourvisit/mountaineering.htm',
        'access_note', 'Denali and Foraker climbs require advance NPS registration, a special-use permit, fees, and an in-person climber orientation. Kahiltna Base Camp normally requires glacier-air-taxi access. Check current NPS rules, air-service limits, route conditions, and waste requirements before planning.',
        'hazard_note', 'The West Buttress is a multi-week high-altitude expedition, not a trail hike. It crosses heavily crevassed glaciers and steep snow and ice, uses fixed lines and exposed ridge traverses, and faces extreme cold, storms, altitude illness, falls, avalanches, and limited rescue. Teams need expert glacier, rope, rescue, winter-camping, and expedition skills and must route-find for current conditions.',
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
