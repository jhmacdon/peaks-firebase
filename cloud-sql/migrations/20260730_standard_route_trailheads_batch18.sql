-- Add the current Nid d'Aigle tram start for Mont Blanc's Normal Route.
--
-- AllTrails and SummitPost describe the Goûter route from Nid d'Aigle.
-- The point below is the current upper tram stop, 13 metres from the first
-- OpenStreetMap path node used by the route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '117D943EB317D936A857',
      'Nid d''Aigle Route Start',
      2372.0,
      45.8563914,
      6.7994305,
      'FR',
      'ARA',
      jsonb_build_object('osm', '13247303723'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/node/13247303723',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'first_route_node_url', 'https://www.openstreetmap.org/node/13247303713',
        'route_source_url', 'https://www.alltrails.com/trail/france/haute-savoie/le-nid-d-aigle-mont-blanc',
        'route_reference_url', 'https://www.summitpost.org/mont-blanc-monte-bianco/150245',
        'route_track_url', 'https://www.peakbagger.com/climber/ascent.aspx?aid=2892061',
        'route_booking_url', 'https://montblanc.ffcam.fr/GB_home.html',
        'route_access_url', 'https://www.tramwaydumontblanc.fr/en/prices-schedules/',
        'permit_note', 'Book every normal-route refuge in advance and list each guest. Camping and bivouac are banned across the classified Mont Blanc site.',
        'access_note', 'Check current Tramway du Mont-Blanc service to Nid d''Aigle before leaving.',
        'hazard_note', 'This is a glaciated alpine climb. The Grand Couloir has fatal rockfall; crevasses, ice, storms, whiteout, altitude illness, and falls are also severe risks. Carry proper alpine and glacier gear and use a qualified guide if needed.',
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
