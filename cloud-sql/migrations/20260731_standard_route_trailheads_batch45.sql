-- Add Rifugio Scotter-Palatini for Antelao's normal route.
--
-- AllTrails, Peakbagger, SummitPost, and OSM agree on the Scotter/San Marco
-- approach to Forcella Piccola and the north-ridge normal route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'BBF6ABB37744B902E07B',
      'Rifugio Scotter-Palatini',
      1580.0,
      46.4721332,
      12.2358726,
      'IT',
      NULL,
      jsonb_build_object('osm_way', '202012091'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/202012091',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/italy/veneto/rifugio-capanna-deli-alpini-forcella-piccola-antelao',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3027138',
        'route_reference_url', 'https://www.summitpost.org/antelao-normal-route/206175',
        'guide_reference_url', 'https://guidecortina.com/en/all-the-activities/normal-route/antelao-normal-route/',
        'access_note', 'The hut approach may depend on the chairlift, a rough access road, a taxi, or a longer walk. Check current road, parking, lift, taxi, hut, trail, weather, and closure information before travel; do not rely on old vehicle-access hours.',
        'hazard_note', 'This is an exposed alpine climb, not a normal hike. It has loose rock, poor route visibility, long inclined slabs, unprotected UIAA I-II climbing, and only limited fixed protection. A helmet and strong mountaineering, route-finding, and down-climbing skills are essential; wet rock, snow, ice, fog, wind, lightning, or rockfall can make the route deadly.',
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
       AND ST_DWithin(d.location, p.location, 150)
     )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
