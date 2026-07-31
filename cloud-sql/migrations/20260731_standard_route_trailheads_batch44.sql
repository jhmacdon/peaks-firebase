-- Add Parkplatz Ullachtal for Birnhorn's normal Passauer Hütte route.
--
-- AllTrails, Peakbagger, Steven Song, and OSM agree on this valley start and
-- the Hofersteig approach to Passauer Hütte.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'AF3E95C2D8B74106E219',
      'Parkplatz Ullachtal',
      878.0,
      47.452885,
      12.755754,
      'AT',
      NULL,
      jsonb_build_object('osm', '8883239937'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/8883239937',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/austria/salzburg/birnhorn-und-kuchelnieder-uber-die-passauer-hutte',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2291411',
        'route_reference_url', 'https://stevensong.com/international/austria/birnhorn/',
        'access_note', 'Start at the signed Ullachtal parking area and keep the vehicle gate clear. Check current parking, hut, trail, cable, snow, and closure information before travel; the Passauer Hütte may be closed outside its staffed season.',
        'hazard_note', 'Above Passauer Hütte the normal route has steep exposed scrambling, loose rock, narrow ledges, and fixed cables. A helmet and solid alpine scrambling skill are essential; rain, fog, snow, ice, lightning, and other climbers increase the risk.',
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
