-- Add the Chalet des Baumes parking for Obiou's normal route.
--
-- Current summit tracks, AllTrails, SummitPost, Isère tourism, and OSM agree
-- on this parking start and the normal route through the Vire de la Cravate.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'A95EDB5947FF6F5A9940',
      'Chalet des Baumes Parking',
      1565.0,
      44.784638,
      5.875409,
      'FR',
      NULL,
      jsonb_build_object('osm_way', '1071070878'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1071070878',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2900590',
        'route_reference_url', 'https://www.alltrails.com/trail/france/isere/grande-tete-de-l-obiou',
        'secondary_route_reference_url', 'https://www.summitpost.org/grande-tete-de-l-obiou/1046864',
        'official_access_url', 'https://www.alpes-isere.com/en/sit/la-grande-tete-de-lobiou-293884/',
        'access_note', 'The route starts at the upper Chalet des Baumes parking area reached by the forest road above Les Payas. Isère tourism lists the route from May 1 through October 31, subject to good weather, and recommends supervision. Confirm current road, parking, seasonal, and local access rules before driving up.',
        'hazard_note', 'This expert route crosses steep, loose, and exposed ground where a fall can be fatal. Expect hands-on scrambling, narrow ledges, severe exposure, loose scree, and frequent rockfall. Wear a helmet, avoid parties above or below one another, stay on the marked line, and climb only in dry, stable weather. Turn around before the exposed upper route if any member lacks the skill or confidence for it.',
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
