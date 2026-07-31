-- Add Trail Lake Trailhead for Gannett Peak's eastern standard route.
--
-- A current successful summit track, AllTrails, SummitPost, the Forest
-- Service, and OSM agree on the Glacier Trail start at the road end.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'E9A02E2B7C07149458E9',
      'Trail Lake Trailhead',
      2315.0,
      43.425767,
      -109.574025,
      'US',
      'WY',
      jsonb_build_object('osm_node', '2029153766'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/2029153766',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3257090',
        'route_reference_url', 'https://www.alltrails.com/trail/us/wyoming/gannett-peak-wyoming-highpoint',
        'secondary_route_reference_url', 'https://www.summitpost.org/gannett-peak/150362',
        'official_access_url', 'https://www.fs.usda.gov/r02/shoshone/recreation/fitzpatrick-wilderness',
        'access_note', 'The eastern standard route starts at Trail Lake Trailhead at the end of Trail Lake Road, Forest Road 411, south of Dubois. It enters Fitzpatrick Wilderness on Glacier Trail. Check current Shoshone National Forest alerts, road conditions, wilderness rules, fire restrictions, group limits, and trail-register instructions before travel. Potable water is not available at the trailhead; treat all backcountry water.',
        'hazard_note', 'This is a remote multi-day mountaineering route of about 50 miles round trip. Expect stream fords, mud, poor weather, route finding, large talus, snow, steep ice, glacier travel, crevasses, a bergschrund, rockfall, and exposed class 3 scrambling on the Gooseneck route. Parties need glacier and self-rescue skills plus a rope, harness, helmet, ice axe, crampons, headlamp, navigation, shelter, and an early summit start. Conditions change by the hour; turn around if snow bridges, weather, stream levels, visibility, or team pace are unsafe.',
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
