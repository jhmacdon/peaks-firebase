-- Add the south-route start for Gunn Peak.
--
-- Current successful tracks, WTA, SummitPost, and OSM agree on the short
-- Barclay Creek Road spur and steep south approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'D9B134B6E38774F02C8A',
      'Gunn Peak South Route Trailhead',
      685.0,
      47.794006,
      -121.462494,
      'US',
      'WA',
      jsonb_build_object('osm_way', '6135586'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/6135586',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3263293',
        'route_reference_url', 'https://www.wta.org/go-hiking/hikes/gunn-peak',
        'secondary_route_reference_url', 'https://www.summitpost.org/gunn-peak/151026',
        'access_note', 'Park on Forest Road 6024 near the narrow spur entrance or at Barclay Lake Trailhead; do not block the spur. WTA and SummitPost list a Northwest Forest Pass or America the Beautiful Pass. Wilderness rules apply, and this sensitive area requires packing out all waste. Confirm current road, fire, and wilderness conditions.',
        'hazard_note', 'This is a Class 3–4 climbing route, not a maintained hiking trail. It has creek and waterfall crossings, very steep forest, loose gullies and rock, hard route-finding, rockfall, exposed scrambling, and a narrow north-face ledge. Snow, ice, or wet rock can make the upper route unsafe. Rescue missions have been common.',
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
