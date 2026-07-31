-- Add Località Carota for Col Nudo's standard Pieve d'Alpago route.
--
-- The Alpenverein route and recent Peakbagger tracks agree on this south
-- approach through the forest and the broad upper scree slopes.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'DF80CDAA92247B907408',
      'Località Carota Trailhead',
      1005.0,
      46.179328,
      12.352818,
      'IT',
      NULL,
      jsonb_build_object('osm_way', '28585003'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/28585003',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2350601',
        'route_reference_url', 'https://www.outdooractive.com/en/route/mountain-hike/pieve-d-alpago/col-nudo-2471m/808704791/',
        'route_guide_url', 'https://mybesttimehiking.com/en/153-col-nudo-summit',
        'access_note', 'The route starts from the narrow Località Carota road above Pieve d''Alpago. Park only where allowed and keep homes, farm access, and the road clear. Check current road, parking, forestry, hunting, livestock, and trail notices before planning.',
        'hazard_note', 'This is a long T4 alpine route. The upper scree, karst holes, steep slopes, and exposed ridge need sure footing and good route finding. Fog, thunderstorms, snow, ice, rockfall, sudden cold, and rapid weather changes can make the summit area dangerous. Carry an offline map or GPS and turn back before visibility fails.',
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
