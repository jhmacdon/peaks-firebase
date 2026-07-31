-- Add Tucquala Meadows for Granite Mountain's standard Robin Lakes route.
--
-- Current WTA reports, recent Peakbagger tracks, the Forest Service, and OSM
-- agree on the Deception Pass Trail start and Robin Lakes approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'B8B4127B4768F95F7E4B',
      'Tucquala Meadows Trailhead',
      1040.0,
      47.544895,
      -121.098175,
      'US',
      'WA',
      jsonb_build_object('osm_way', '1089355512'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1089355512',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3266287',
        'route_reference_url', 'https://www.wta.org/go-hiking/trip-reports/trip_report-2026-07-13.194736764436',
        'official_access_url', 'https://www.fs.usda.gov/r06/okanogan-wenatchee/recreation/tucquala-meadows-fish-lake-trailhead',
        'access_note', 'The remote trailhead is at the end of Forest Road 4330. The Forest Service lists limited parking, a $5 day-use fee, no potable water, and a free self-issued Alpine Lakes Wilderness permit. Check current fire closures, road condition, fee, and wilderness rules before leaving Cle Elum.',
        'hazard_note', 'This is a long backcountry route with damaged boardwalk, blowdowns, steep scrambling near Tuck Lake, confusing social trails, granite slabs, loose rock, a short exposed descent, and lingering snow. Bugs, wildfire smoke, heat, thunderstorms, cold, and poor visibility add risk. Carry an offline map, water filter, and traction when snow remains.',
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
