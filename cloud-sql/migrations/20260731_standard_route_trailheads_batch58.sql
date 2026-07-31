-- Add Rifugio Segantini for Cima Presanella's southeast normal route.
--
-- AllTrails, Peakbagger, SummitPost, and OSM agree on the Monte Nero line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '177BFA89F62675D89243',
      'Rifugio Segantini',
      2373.0,
      46.20936,
      10.710569,
      'IT',
      NULL,
      jsonb_build_object('osm_way', '432949754'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/432949754',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1981137',
        'route_reference_url', 'https://www.alltrails.com/trail/italy/trentino/rifugio-segantini-bocca-d-amola-cima-presanella',
        'summitpost_url', 'https://www.summitpost.org/presanella-se-normal-route-across-monte-nero-from-ref-segantini/963426',
        'access_note', 'This summit track starts at Rifugio Segantini; the approach to the refuge is not part of it. Confirm the current road, parking, approach trail, hut booking, park, and guide rules before planning.',
        'hazard_note', 'The southeast normal route is a serious alpine climb with steep snow or ice, glacier or snowfield travel, exposed rock, cable-assisted sections, rockfall, falls, storms, altitude, and route-finding risk. Teams need rope, crampon, ice-axe, snow, ice, and alpine rock skills and must choose a safe line for current conditions.',
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
