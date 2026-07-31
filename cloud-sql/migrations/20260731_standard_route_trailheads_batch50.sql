-- Add Vinson Base Camp for Vinson Massif's standard Branscomb Glacier route.
--
-- Peakbagger, SummitPost, Alpine Ascents, Adventure Consultants, and OSM
-- agree on the Base Camp, Low Camp, High Camp, and summit line.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'AC104C1E48DAA30F8B7B',
      'Vinson Base Camp',
      2100.0,
      -78.5340554,
      -86.0010625,
      'AQ',
      NULL,
      jsonb_build_object('osm_way', '1151629790'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1151629790',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=1302108',
        'route_reference_url', 'https://www.summitpost.org/mount-vinson/830860',
        'operator_reference_url', 'https://www.alpineascents.com/climbs/mount-vinson/itinerary/',
        'guide_reference_url', 'https://adventureconsultants.com/expeditions/seven-summits/vinson',
        'access_note', 'Vinson Base Camp normally requires expedition logistics and a ski-aircraft transfer from Union Glacier. Confirm current Antarctic travel, environmental, medical, operator, and flight rules before planning.',
        'hazard_note', 'The standard route is a remote high-altitude glacier expedition, not a trail hike. It crosses crevassed ice, uses fixed ropes on steep snow, and faces severe cold, wind, storms, altitude illness, falls, and limited rescue. Teams need expert glacier, rope, rescue, winter-camping, and expedition skills and must choose a safe line for current conditions.',
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
