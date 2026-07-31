-- Add the Mahogany Flat start for Telescope Peak's standard route.
--
-- AllTrails, SummitPost, Peakbagger, NPS, and OSM agree on the Telescope Peak
-- Trail from Mahogany Flat Campground.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '42DC0BC353D948678075',
      'Mahogany Flat Campground Trailhead',
      2435.0,
      36.230613,
      -117.068229,
      'US',
      'CA',
      jsonb_build_object('osm', '28716470'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/28716470',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_reference_url', 'https://www.summitpost.org/telescope-peak/150584',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/california/telescope-peak-trail',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1273617',
        'access_note', 'The rough final road to Mahogany Flat often needs a high-clearance four-wheel-drive vehicle and can close after storms or snow. Check current Death Valley road, campground, fee, and park rules before travel.',
        'hazard_note', 'The route has no reliable water and crosses long exposed ridges. Desert heat, high altitude, snow, ice, lightning, and strong wind can make the climb hazardous.',
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
