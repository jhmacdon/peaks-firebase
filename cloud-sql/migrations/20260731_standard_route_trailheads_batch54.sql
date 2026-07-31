-- Add Col de Porte for Chamechaude's standard west-side route.
--
-- AllTrails, Peakbagger, and OSM agree on the direct Col de Porte line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '169808D1CD6E1D75D218',
      'Col de Porte Trailhead',
      1320.0,
      45.290657,
      5.767184,
      'FR',
      NULL,
      jsonb_build_object('osm_way', '1350912477'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1350912477',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2955004',
        'route_reference_url', 'https://www.alltrails.com/trail/france/isere/chamechaude-via-col-de-porte',
        'access_note', 'The standard route begins at Col de Porte. Confirm current road, parking, transit, and Chartreuse park rules before planning.',
        'hazard_note', 'The upper route crosses steep limestone and ends with a short cable-assisted scramble. Rockfall, exposed footing, rain, ice, fog, snow, and avalanche terrain can raise the risk. Use skills and gear suited to the season and conditions.',
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
