-- Add Lucknerhaus for Großglockner's classic south-side normal route.
--
-- Two successful summit tracks, AllTrails, SummitPost, local guides, and
-- OSM agree on the Lucknerhaus start and Adlersruhe normal route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '9A6A7F33A62D50654883',
      'Lucknerhaus Trailhead',
      1920.0,
      47.021923,
      12.689365,
      'AT',
      NULL,
      jsonb_build_object('osm_way', '237043344'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/237043344',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3239435',
        'route_reference_url', 'https://www.alltrails.com/trail/austria/tyrol/grossglockner',
        'secondary_route_reference_url', 'https://www.summitpost.org/normal-route-grossglockner/836668',
        'official_access_url', 'https://www.erzherzog-johann-huette.at/',
        'access_note', 'The classic south-side normal route starts in the Lucknerhaus parking area, reached by the seasonal toll road from Kals. It passes Lucknerhütte and Stüdlhütte before crossing to Erzherzog-Johann-Hütte at Adlersruhe. Check the toll road, parking, hut opening and booking, glacier, weather, and guide conditions before travel. A hut booking does not confirm that the summit route is safe or open.',
        'hazard_note', 'This is a technical alpine climb, not a hiking trail. The route crosses glaciers and a bergschrund, then climbs steep snow or ice and exposed rock to Kleinglockner and across the narrow summit notch. Expect crevasses, hard ice, rockfall, loose rock, fixed cables or rods, crowding, sudden storms, and consequential falls. Carry and know how to use a rope, harness, helmet, crampons, ice axe, glacier-rescue gear, and suitable clothing. Hire a certified local guide unless every member has current glacier, short-rope, exposed UIAA II, and rescue skills. Turn around for poor snow bridges, rockfall, wind, storms, crowd delays, or unsafe conditions.',
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
