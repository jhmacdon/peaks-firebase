-- Add the reviewed Skyline and northern Tipsoo Lake trail entrances.
-- Source and identity evidence: docs/data-audits/trail-catalog-wa-2026-10-13/.
-- Matches the existing 20260730 standard-route trailhead record pattern.
-- Cost: two destination rows and the existing rematch triggers; ~$0/month fixed.
-- Does not move or rename an existing place or activate a route.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('trail_catalog_wa_trailhead_import',0));
CREATE TEMP TABLE trail_catalog_wa_trailhead_input ON COMMIT DROP AS
SELECT value AS item FROM jsonb_array_elements($fixture$[
  {
    "id": "C21AD354B7FEA99C277F",
    "name": "Skyline Trailhead",
    "elevation": 1654.41796875,
    "location": {
      "type": "Point",
      "coordinates": [
        -121.7364531,
        46.7864184,
        1654.41796875
      ],
      "srid": 4326
    },
    "external_ids": {
      "osm": "13122759855"
    },
    "metadata": {
      "source": "openstreetmap",
      "source_url": "https://www.openstreetmap.org/node/13122759855",
      "source_way_url": "https://www.openstreetmap.org/way/439627173",
      "source_license": "ODbL 1.0",
      "source_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
      "source_attribution": "© OpenStreetMap contributors",
      "source_snapshot": {
        "path": "sources/osm-skyline-map.json",
        "sha256": "e8c4a3781026c438c4a2d8101e0dea87a7745e8a6ad0bfc4149cfa8f31b50a82",
        "url": "https://api.openstreetmap.org/api/0.6/map.json?bbox=-121.741,46.781,-121.729,46.793",
        "retrievedAt": "2026-10-13T05:06:19.523647+00:00"
      },
      "route_source_url": "https://www.nps.gov/mora/planyourvisit/skyline-trail.htm",
      "catalog_audit": "trail-catalog-wa-2026-10-13",
      "elevation_source": "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      "elevation_source_url": "https://registry.opendata.aws/terrain-tiles/",
      "elevation_license_url": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      "elevation_attribution": "* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and\n  funded under National Science Foundation awards 1043681, 1559691, and 1542736;\n* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;\n* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)\n  Österreich;\n* Canada terrain data contains information licensed under the Open Government\n  Licence – Canada;\n* Europe terrain data produced using Copernicus data and information funded by the\n  European Union - EU-DEM layers;\n* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration\n* Mexico terrain data source: INEGI, Continental relief, 2016;\n* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New\n  Zealand and the New Zealand Government (All rights reserved);\n* Norway terrain data © Kartverket;\n* United Kingdom terrain data © Environment Agency copyright and/or database right\n  2015. All rights reserved;\n* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data\n  courtesy of the U.S. Geological Survey.",
      "elevation_retrieved_at": "2026-10-13T05:53:41.405Z",
      "elevation_profile": "terrain",
      "region_source_url": "https://www.nps.gov/mora/planyourvisit/skyline-trail.htm",
      "region_basis": "Named trailhead in Mount Rainier National Park, Washington, United States; reviewed from the official NPS route page."
    }
  },
  {
    "id": "6D0E779FF39C5B648D6B",
    "name": "Tipsoo Lake Trailhead",
    "elevation": 1616.5078125,
    "location": {
      "type": "Point",
      "coordinates": [
        -121.519389,
        46.8698645,
        1616.5078125
      ],
      "srid": 4326
    },
    "external_ids": {
      "osm": "2431576647"
    },
    "metadata": {
      "source": "openstreetmap",
      "source_url": "https://www.openstreetmap.org/node/2431576647",
      "source_way_url": "https://www.openstreetmap.org/way/235057030",
      "source_license": "ODbL 1.0",
      "source_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
      "source_attribution": "© OpenStreetMap contributors",
      "source_snapshot": {
        "path": "sources/osm-relation-5194432-full.json",
        "sha256": "2d74b2d8f972a8ea2750b309d38709881a2b475ea7a024c6aabc7dea1942f2bf",
        "url": "https://api.openstreetmap.org/api/0.6/relation/5194432/full.json",
        "retrievedAt": "2026-10-13T05:07:07.682567+00:00"
      },
      "route_source_url": "https://www.nps.gov/mora/planyourvisit/natches-peak-loop.htm",
      "catalog_audit": "trail-catalog-wa-2026-10-13",
      "elevation_source": "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
      "elevation_source_url": "https://registry.opendata.aws/terrain-tiles/",
      "elevation_license_url": "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
      "elevation_attribution": "* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and\n  funded under National Science Foundation awards 1043681, 1559691, and 1542736;\n* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;\n* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)\n  Österreich;\n* Canada terrain data contains information licensed under the Open Government\n  Licence – Canada;\n* Europe terrain data produced using Copernicus data and information funded by the\n  European Union - EU-DEM layers;\n* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration\n* Mexico terrain data source: INEGI, Continental relief, 2016;\n* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New\n  Zealand and the New Zealand Government (All rights reserved);\n* Norway terrain data © Kartverket;\n* United Kingdom terrain data © Environment Agency copyright and/or database right\n  2015. All rights reserved;\n* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data\n  courtesy of the U.S. Geological Survey.",
      "elevation_retrieved_at": "2026-10-13T05:53:41.405Z",
      "elevation_profile": "terrain",
      "region_source_url": "https://www.nps.gov/mora/planyourvisit/natches-peak-loop.htm",
      "region_basis": "Named trailhead in Mount Rainier National Park, Washington, United States; reviewed from the official NPS route page."
    }
  }
]$fixture$::jsonb);

DO $$
DECLARE item JSONB; target geography; existing destinations%ROWTYPE;
  audit_id BIGINT; added INTEGER:=0; changed INTEGER;
BEGIN
  IF (SELECT count(*) FROM trail_catalog_wa_trailhead_input)<>2 THEN
    RAISE EXCEPTION 'Expected exactly two reviewed Washington trailheads';
  END IF;
  INSERT INTO data_source_runs(source,run_kind,status,started_at,rows_in,notes)
    VALUES('trail-catalog-wa-trailheads','import','failed',now(),2,
      'Source-bound Skyline and northern Tipsoo entrances; identity review 2026-10-13')
    RETURNING id INTO audit_id;
  FOR item IN SELECT i.item FROM trail_catalog_wa_trailhead_input i ORDER BY i.item->>'id' LOOP
    target:=ST_SetSRID(ST_MakePoint((item#>>'{location,coordinates,0}')::float8,
      (item#>>'{location,coordinates,1}')::float8,(item->>'elevation')::float8),4326)::geography;
    -- Stop on a competing identity rather than silently dropping a source row.
    IF EXISTS (SELECT 1 FROM destinations d WHERE d.id<>item->>'id' AND (
      d.external_ids @> (item->'external_ids') OR
      (d.features @> ARRAY['trailhead']::destination_feature[]
        AND d.search_name=lower(item->>'name') AND ST_DWithin(d.location,target,300)))) THEN
      RAISE EXCEPTION 'Conflicting catalog trailhead for OSM node %',item#>>'{external_ids,osm}';
    END IF;
    SELECT * INTO existing FROM destinations WHERE id=item->>'id' FOR UPDATE;
    IF FOUND AND NOT COALESCE(existing.name=item->>'name'
      AND existing.external_ids @> (item->'external_ids')
      AND existing.features @> ARRAY['trailhead']::destination_feature[]
      AND existing.owner='peaks' AND existing.country_code='US' AND existing.state_code='WA'
      AND ST_3DDistance(existing.location::geometry,target::geometry)<0.000000001
      AND existing.elevation=(item->>'elevation')::float8
      AND existing.metadata @> (item->'metadata'),false) THEN
      RAISE EXCEPTION 'Reviewed trailhead ID conflicts with current catalog: %',item->>'id';
    END IF;
    INSERT INTO destinations(id,name,search_name,elevation,prominence,location,geohash,type,
      activities,features,owner,country_code,state_code,external_ids,metadata,created_at,updated_at)
    VALUES(item->>'id',item->>'name',lower(item->>'name'),(item->>'elevation')::float8,NULL,target,NULL,'point',
      ARRAY['outdoor-trek']::activity_type[],ARRAY['trailhead']::destination_feature[],'peaks','US','WA',
      item->'external_ids',item->'metadata',now(),now())
    ON CONFLICT(id) DO NOTHING;
    GET DIAGNOSTICS changed=ROW_COUNT; added:=added+changed;
  END LOOP;
  UPDATE data_source_runs SET status='success',finished_at=now(),rows_matched=2,rows_written=added
    WHERE id=audit_id;
  RAISE NOTICE 'Washington trailheads checked: 2; inserted: %; audit: %',added,audit_id;
END $$;
COMMIT;
