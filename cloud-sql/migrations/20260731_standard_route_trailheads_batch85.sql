-- Add the standard Van d'en Haut start for Haute Cime.
--
-- Auberge de Salanfe, AllTrails, the current OSM path network, and a private
-- Peakbagger comparison trace agree on this parking area and approach.

BEGIN;

WITH incoming (
  id, name, elevation, lat, lng, country_code, state_code,
  external_ids, metadata
) AS (
  VALUES
    (
      '79A191B26C3EFE510A06',
      'Van d''en Haut Parking',
      1436.0,
      46.1416127,
      6.9863612,
      'CH',
      NULL,
      jsonb_build_object('osm_way', '288460188'),
      jsonb_build_object(
        'source', 'openstreetmap',
        'source_url', 'https://www.openstreetmap.org/way/288460188',
        'source_license', 'ODbL 1.0',
        'source_attribution', '© OpenStreetMap contributors',
        'official_access_url', 'https://salanfe.ch/en/salanfe-moutain-inn/to-reach-the-inn/',
        'official_route_url', 'https://salanfe.ch/en/day-trips/climb-to-the-haute-cime-of-the-dents-du-midi-alt-3257m/',
        'route_reference_url', 'https://www.alltrails.com/trail/switzerland/valais/van-den-haut-a-haute-cime',
        'secondary_route_reference_url', 'https://www.summitpost.org/haute-cime/151080',
        'access_note', 'Auberge de Salanfe directs drivers through Salvan toward Vallon de Van and the Van d''en Haut campground, then across the small wooden bridge and uphill to the parking clearing. The route continues only on foot. The walk to the inn takes about 1.5 to 2 hours. A seasonal bus serves the campground on published summer dates; check current road and transit conditions before travel.',
        'hazard_note', 'This is a long, difficult alpine route with about 13.8 mi round trip and 6,263 ft of gain from Van d''en Haut. The official Salanfe route lists T4 difficulty, a large vertical gain, and a June through October season. Above the lake the path crosses steep, loose rock and scree; the upper 600 m can be about 40 to 60 degrees, and the line can be hard to follow. Snow or ice makes the upper route far harder and may require mountaineering skills and gear. Expect rockfall, exposure, fast weather changes, strong wind, cold, and a long descent. Turn around for wet rock, unstable snow, ice, storms, poor visibility, or if the upper route is unclear.',
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
