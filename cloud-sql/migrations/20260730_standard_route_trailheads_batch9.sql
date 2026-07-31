-- Add the trailhead for Mount Ararat's standard south route.
--
-- Türkiye's Foreign Ministry names the Doğubeyazıt / Topçatan Village–Eli
-- route for Big Ararat. A 2024 Peakbagger ascent supplies the road-end start
-- used by the current south route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '45A42543142CAD2DA995',
      'Mount Ararat South Route Trailhead',
      2184.0,
      39.65511,
      44.22352,
      'TR',
      NULL,
      jsonb_build_object('peakbagger_ascent', '2573901'),
      jsonb_build_object(
        'source', 'peakbagger',
        'source_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2573901',
        'route_rules_url', 'https://www.mfa.gov.tr/this-is-the-protocol-concerning-mountaineering-activities-of-foreign-national-citizens-for-tourism-and-sports-purposes-at-the-mo.en.mfa',
        'route_reference_url', 'https://www.summitpost.org/mount-ararat-a-r-da/339572',
        'catalog_audit', 'standard-route-goal-2026-07-30'
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
