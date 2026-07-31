-- Add the Trail 1330 route start for Red Mountain near Cle Elum.
--
-- AllTrails, Peakbagger, SummitPost, and OSM support the east-side trail,
-- Red Mountain Road, and summit bootpath as the standard summer line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '64DA46511CE2A37496A8',
      'Red Mountain Trail #1330 Route Start',
      792.0,
      47.4039240,
      -121.1117620,
      'US',
      'WA',
      jsonb_build_object('osm_way', '510853858'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/510853858',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/washington/red-mountain-trail--3',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2973139',
        'route_reference_url', 'https://www.summitpost.org/red-mountain-wa/294162',
        'access_note', 'The approach road can close seasonally, and the small pullout holds few cars. Check current forest-road, parking, fire, and closure information before travel; a lower start adds road walking.',
        'hazard_note', 'This steep and faint route needs strong navigation. Expect brush, fallen trees, loose soil and rock, and exposed ridge terrain. Snow can hide the tread and add avalanche, fall, and self-arrest hazards. Do not rely on the track alone.',
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
