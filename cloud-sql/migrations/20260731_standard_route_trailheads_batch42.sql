-- Add the Whitfield Hall road start for Jamaica's Blue Mountain Peak Trail.
--
-- AllTrails, SummitPost, Peakbagger, JCDT, and OSM agree on the common
-- south-side route from the Whitfield Hall road area.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '8E6B8DD8AF59D25E6C4A',
      'Whitfield Hall Trailhead',
      1241.0,
      18.046450,
      -76.615005,
      'JM',
      NULL,
      jsonb_build_object('osm_way', '305289428'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/305289428',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/blue-mountain-peak-trail/481696',
        'route_alltrails_url', 'https://www.alltrails.com/trail/jamaica/saint-thomas/blue-mountain-peak--2',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3063202',
        'official_access_url', 'https://www.jcdt.org.jm/park-management/park-management',
        'access_note', 'The peak trail lies in Blue and John Crow Mountains National Park. Check current JCDT hours, fees, guide or shuttle rules, road conditions, and closures before travel. The mountain road may require a capable vehicle; park without blocking residents or traffic.',
        'hazard_note', 'This is a long, steep tropical mountain hike. Rain, mud, poor visibility, heat, darkness on sunrise starts, thunderstorms, wind, landslides, storm damage, and limited help can make it hazardous.',
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
