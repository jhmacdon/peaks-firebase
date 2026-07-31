-- Add the official Pakihiroa Station car park for Te Ara ki Hikurangi.
--
-- DOC, the current OSM hiking relation, and AllTrails agree on this start and
-- the farm-track, hut, scree, and summit route.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '19923BB8275BD9BBC83B',
      'Te Ara ki Hikurangi Car Park',
      255.0,
      -37.8551967,
      178.0865705,
      'NZ',
      NULL,
      jsonb_build_object('osm_way', '1545558399'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/1545558399',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://www.doc.govt.nz/parks-and-recreation/places-to-go/east-coast/places/raukumara-conservation-park/things-to-do/mount-hikurangi-te-ara-ki-hikurangi/',
        'route_reference_url', 'https://www.alltrails.com/trail/new-zealand/gisborne/mount-hikurangi-track',
        'access_note', 'Te Ara ki Hikurangi starts at the formal car park before the bridge onto Pakihiroa Station. There is no public vehicle access past the car park. The route crosses private working farmland and may close for farming or cultural reasons. DOC lists annual closures from 14 September through 16 October for lambing and from noon on 31 December through noon on 1 January for the Hikurangi Maunga Dawn Event. Check the live DOC alert before travel, leave gates as found, keep clear of stock, and do not enter during a closure. Camping is not allowed. Dogs, guns, and mountain bikes are not allowed on Pakihiroa Station. Book Hikurangi Hut through Te Rūnanganui o Ngāti Porou if staying overnight.',
        'hazard_note', 'DOC rates this as a 7-hour one-way expert route for fit trampers with strong backcountry navigation and survival skills. Yellow markers lead to the hut, then poles mark most of the mountain route, but the final 400 m steep scree slope is unmarked and not maintained; keep left as DOC directs. Expect unstable rock and rockfall, exposed scrambling, mud, overgrown tussock, route loss, rain, fog, strong wind, snow, ice, extreme cold, and fast weather changes. Travel in daylight and do not attempt the upper route when wet, windy, icy, or in poor visibility. Carry warm waterproof layers, food, water, navigation, communication, a headlamp, first aid, and a large turnaround margin.',
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
