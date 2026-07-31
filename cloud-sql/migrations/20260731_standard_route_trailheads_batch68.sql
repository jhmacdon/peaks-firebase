-- Add Pont for Gran Paradiso's normal route via Rifugio Vittorio Emanuele II.
--
-- A current standard-route track, AllTrails, SummitPost, the national park,
-- and OSM agree on this Pont start and the Vittorio Emanuele approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      'A17DB58D2952ED0446C3',
      'Pont Valsavarenche Trailhead',
      1963.0,
      45.524498,
      7.201978,
      'IT',
      NULL,
      jsonb_build_object('osm_way', '115073111'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/115073111',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=3248674',
        'route_reference_url', 'https://www.alltrails.com/trail/italy/aosta-valley/gran-paradiso-via-normale-dal-rifugio-vittorio-emanuele',
        'secondary_route_reference_url', 'https://www.summitpost.org/gran-paradiso/150350',
        'official_access_url', 'https://www.pngp.it/en/node/7134',
        'access_note', 'The national park directs visitors to the large parking area at Pont near Hotel Gran Paradiso. The normal route commonly uses Rifugio Vittorio Emanuele II; reserve the hut when needed and confirm current road, parking, park, and hut rules before the climb.',
        'hazard_note', 'Above the hut this is a glaciated alpine climb, not a hiking trail. Crevasses, weak snow bridges, the bergschrund, avalanche terrain, rockfall, altitude, fast weather, an exposed Class 3 summit ridge, and a short fixed ladder require mountaineering skill. Use a rope, glacier gear, crampons, and an ice axe as conditions demand; hire a guide if the team lacks that skill.',
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
