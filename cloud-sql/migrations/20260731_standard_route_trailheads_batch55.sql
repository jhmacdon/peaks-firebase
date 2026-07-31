-- Add Pré de Madame Carle for Barre des Écrins' normal west-ridge route.
--
-- Peakbagger, SummitPost, the local guide bureau, and OSM agree on this line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B60AD3BB339C44E7BB05',
      'Pré de Madame Carle Trailhead',
      1885.0,
      44.917122,
      6.415336,
      'FR',
      NULL,
      jsonb_build_object('osm_way', '838508649'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/838508649',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2235794',
        'route_reference_url', 'https://www.summitpost.org/barre-des-ecrins/150265',
        'guide_reference_url', 'https://guides-ecrins.com/Barre-des-Ecrins-Voie-Normale-4102-m.html?lang=en',
        'access_note', 'The normal route starts at Pré de Madame Carle and crosses Écrins National Park. Confirm the seasonal road, parking, hut booking, park, and any guide or rope-team rules before planning.',
        'hazard_note', 'This is a serious glaciated alpine climb, not a hiking trail. It crosses crevasses and threatened serac areas, steep snow or ice, a bergschrund, and an exposed mixed-rock summit ridge. Rockfall, icefall, falls, storms, altitude, and warming snow add risk. Teams need glacier, rope, crevasse-rescue, snow, ice, and alpine rock skills and must choose a safe line for current conditions.',
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
