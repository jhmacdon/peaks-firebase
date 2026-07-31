-- Add Olgunlar for Kaçkar Dağı's standard south-side route.
--
-- Two recent summit tracks, AllTrails, a detailed independent route report,
-- and OSM agree on the road-end start by Kaçkar Pansiyon.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B784FCE13C6832C3F0D1',
      'Olgunlar (Kaçkar Pansiyon)',
      2115.0,
      40.859516,
      41.241392,
      'TR',
      NULL,
      jsonb_build_object('osm_way', '29184828'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/29184828',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2930629',
        'route_reference_url', 'https://www.alltrails.com/trail/turkey/artvin/kackar-dagi',
        'secondary_route_reference_url', 'https://www.prominent-mountains.no/mountains/3000mtn/kackar.html',
        'official_access_url', 'https://www.ktb.gov.tr/EN-99804/rize---kackar-mountain-national-park.html',
        'access_note', 'The standard south-side route starts at the end of the road in Olgunlar by Kaçkar Pansiyon. Reach Olgunlar from Yusufeli and confirm current road, national-park, camping, fee, and local access rules before travel. Most parties camp at Dilberdüzü or near Deniz Gölü; a one-day climb is long.',
        'hazard_note', 'This is a remote high-mountain route with more than 1,800 metres of gain. Above Deniz Gölü the path becomes broken and cairned across talus, scree, and rock. A short exposed traverse is hazardous when wet, snowy, or icy, and recent climbers report ring bolts near the waterfall traverse. Carry navigation, a helmet, water treatment, warm and wet-weather gear, and an overnight margin. Turn around for poor visibility, ice, storms, unsafe stream levels, or slow progress.',
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
