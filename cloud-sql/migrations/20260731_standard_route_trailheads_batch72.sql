-- Add Karangan for Gunung Rantemario's standard Latimojong route.
--
-- A successful summit track, AllTrails, SummitPost, Gunung Bagging, and OSM
-- agree on the Karangan start and the marked Latimojong climbing trail.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '69B9CAB4B0E857098276',
      'Karangan Trailhead',
      1493.0,
      -3.417170,
      119.989685,
      'ID',
      'SN',
      jsonb_build_object('osm_way', '1422453091'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1422453091',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2229599',
        'route_reference_url', 'https://www.alltrails.com/trail/indonesia/south-sulawesi/mount-latimojong',
        'secondary_route_reference_url', 'https://www.summitpost.org/gunung-rantemario-mount-latimojong/154658',
        'official_access_url', 'https://www.gunungbagging.com/rantemario/',
        'access_note', 'The classic route starts in Karangan. Gunung Bagging reports that a permit is not required at present, but local rules can change; confirm them before travel and carry a copy of your passport or other requested identification. Road access is long and rough. Arrange local transport and strongly consider a local guide or porter.',
        'hazard_note', 'This remote tropical mountain route is often done over several days. Expect heat, severe humidity, heavy rain, mud, slippery roots and rock, stream crossings, steep fixed-rope sections, poor visibility, cold camps, and limited rescue. Carry food, water treatment, shelter, rain gear, warm layers, a headlamp, navigation tools, and an emergency margin. Turn around if rain, stream levels, route finding, or team pace makes the climb unsafe.',
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
