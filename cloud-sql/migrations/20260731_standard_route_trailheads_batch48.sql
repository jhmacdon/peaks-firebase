-- Add the lower FR 5730-113 route start for Mount Phelps.
--
-- AllTrails, Peakbagger, SummitPost, The Mountaineers, and OSM support the
-- Blackhawk Mine, pocket-basin, and summit-ridge standard route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '3B4048A3FF9EA9CAA5F2',
      'FR 5730-113 Lower Route Start',
      767.0,
      47.6802350,
      -121.5382810,
      'US',
      'WA',
      jsonb_build_object('osm_way', '6464740'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/6464740',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_alltrails_url', 'https://www.alltrails.com/trail/us/washington/mount-phelps-mcclain-peaks',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2876371',
        'route_reference_url', 'https://www.summitpost.org/mount-phelps/571511',
        'mountaineers_reference_url', 'https://www.mountaineers.org/activities/routes-places/mount-phelps',
        'access_note', 'The long forest-road approach is rough and its drivable end changes with gates, washouts, fallen trees, snow, and repairs. Check current Forest Service access and closure information and be ready to start lower.',
        'hazard_note', 'This is a steep, faint scramble with brush, fallen timber, loose clearcuts, exposed rock, and serious route-finding. The basin and gullies can avalanche, and snow can create moats and steep fall hazards. Carry navigation tools and do not rely on the track alone.',
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
