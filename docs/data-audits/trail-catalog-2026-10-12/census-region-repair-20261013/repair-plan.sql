-- Reviewed four-destination administrative metadata repair; no route changes.
-- Verify evidence first: python3 verify-evidence.py > /dev/null
-- Defaults to ROLLBACK. The operator may set -v apply_region_repair=true only
-- after review and a successful rollback preflight. No trigger is disabled.
\set ON_ERROR_STOP on
\if :{?apply_region_repair}
\else
  \set apply_region_repair false
\endif
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
DO $repair$
DECLARE
  proposals JSONB := $proposal$[
  {
    "id": "Ndsk2Ad2F6r9sXR8cK0m",
    "name": "Climbers Bivouac Trailhead",
    "lat": 46.146241,
    "lng": -122.183655,
    "external_ids": {},
    "features": [
      "trailhead"
    ],
    "region_source": {
      "source_name": "U.S. Census Bureau TIGERweb States",
      "source_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?geometry=%7B%22x%22%3A-122.183655%2C%22y%22%3A46.146241%2C%22spatialReference%22%3A%7B%22wkid%22%3A4326%7D%7D&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GEOID%2CSTATE%2CNAME%2CSTUSAB&returnGeometry=false&f=json",
      "source_layer_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0",
      "source_vintage": "2026-01-01",
      "retrieved_at": "2026-10-13T06:37:23.172764+00:00",
      "point_response_sha256": "dc74f523ed66d2bb1459cddc2df6c03c3e94880c7c8c863ca3123f67cf4cf8d8",
      "boundary_sha256": "7161f9e4892e8bdb1c0e86808e93438a4ba0ea4af5bb8317d139b7edcb76fc91",
      "state_geoid": "53",
      "method": "unique Census state polygon intersection at unchanged catalog XY; saved polygon interior cross-check",
      "coordinate": {
        "lat": 46.146241,
        "lng": -122.183655
      },
      "approx_boundary_distance_m": 52749.132,
      "near_boundary_reject_threshold_m": 5000,
      "attribution": "Source: U.S. Census Bureau"
    }
  },
  {
    "id": "6PxfQ1g48SrbplzGd6UH",
    "name": "Mount Saint Helens",
    "lat": 46.1914178,
    "lng": -122.195606,
    "external_ids": {
      "peakbagger": "2353",
      "listsofjohn": "16737"
    },
    "features": [
      "volcano",
      "summit"
    ],
    "region_source": {
      "source_name": "U.S. Census Bureau TIGERweb States",
      "source_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?geometry=%7B%22x%22%3A-122.195606%2C%22y%22%3A46.1914178%2C%22spatialReference%22%3A%7B%22wkid%22%3A4326%7D%7D&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GEOID%2CSTATE%2CNAME%2CSTUSAB&returnGeometry=false&f=json",
      "source_layer_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0",
      "source_vintage": "2026-01-01",
      "retrieved_at": "2026-10-13T06:37:23.261851+00:00",
      "point_response_sha256": "dc74f523ed66d2bb1459cddc2df6c03c3e94880c7c8c863ca3123f67cf4cf8d8",
      "boundary_sha256": "7161f9e4892e8bdb1c0e86808e93438a4ba0ea4af5bb8317d139b7edcb76fc91",
      "state_geoid": "53",
      "method": "unique Census state polygon intersection at unchanged catalog XY; saved polygon interior cross-check",
      "coordinate": {
        "lat": 46.1914178,
        "lng": -122.195606
      },
      "approx_boundary_distance_m": 54058.983,
      "near_boundary_reject_threshold_m": 5000,
      "attribution": "Source: U.S. Census Bureau"
    }
  },
  {
    "id": "YtzjvQqup3gqmAYnz0l4",
    "name": "Cascade Pass Trailhead",
    "lat": 48.47542,
    "lng": -121.075696,
    "external_ids": {},
    "features": [
      "trailhead"
    ],
    "region_source": {
      "source_name": "U.S. Census Bureau TIGERweb States",
      "source_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?geometry=%7B%22x%22%3A-121.075696%2C%22y%22%3A48.47542%2C%22spatialReference%22%3A%7B%22wkid%22%3A4326%7D%7D&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GEOID%2CSTATE%2CNAME%2CSTUSAB&returnGeometry=false&f=json",
      "source_layer_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0",
      "source_vintage": "2026-01-01",
      "retrieved_at": "2026-10-13T06:37:23.249113+00:00",
      "point_response_sha256": "dc74f523ed66d2bb1459cddc2df6c03c3e94880c7c8c863ca3123f67cf4cf8d8",
      "boundary_sha256": "7161f9e4892e8bdb1c0e86808e93438a4ba0ea4af5bb8317d139b7edcb76fc91",
      "state_geoid": "53",
      "method": "unique Census state polygon intersection at unchanged catalog XY; saved polygon interior cross-check",
      "coordinate": {
        "lat": 48.47542,
        "lng": -121.075696
      },
      "approx_boundary_distance_m": 58354.986,
      "near_boundary_reject_threshold_m": 5000,
      "attribution": "Source: U.S. Census Bureau"
    }
  },
  {
    "id": "APWWTYFkwvuUFc3TP1m9",
    "name": "Sahale Peak",
    "lat": 48.491113,
    "lng": -121.038632,
    "external_ids": {},
    "features": [
      "summit"
    ],
    "region_source": {
      "source_name": "U.S. Census Bureau TIGERweb States",
      "source_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?geometry=%7B%22x%22%3A-121.038632%2C%22y%22%3A48.491113%2C%22spatialReference%22%3A%7B%22wkid%22%3A4326%7D%7D&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GEOID%2CSTATE%2CNAME%2CSTUSAB&returnGeometry=false&f=json",
      "source_layer_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0",
      "source_vintage": "2026-01-01",
      "retrieved_at": "2026-10-13T06:37:23.249194+00:00",
      "point_response_sha256": "dc74f523ed66d2bb1459cddc2df6c03c3e94880c7c8c863ca3123f67cf4cf8d8",
      "boundary_sha256": "7161f9e4892e8bdb1c0e86808e93438a4ba0ea4af5bb8317d139b7edcb76fc91",
      "state_geoid": "53",
      "method": "unique Census state polygon intersection at unchanged catalog XY; saved polygon interior cross-check",
      "coordinate": {
        "lat": 48.491113,
        "lng": -121.038632
      },
      "approx_boundary_distance_m": 56612.819,
      "near_boundary_reject_threshold_m": 5000,
      "attribution": "Source: U.S. Census Bureau"
    }
  }
]$proposal$::jsonb;
  proposal RECORD;
  current_place RECORD;
  changed_count INTEGER := 0;
  replay_count INTEGER := 0;
  affected INTEGER;
BEGIN
  IF jsonb_array_length(proposals) <> 4 THEN RAISE EXCEPTION 'Expected four reviewed destinations'; END IF;
  -- Lock every target in a fixed order before any row is changed.
  PERFORM d.id FROM destinations d
  JOIN jsonb_to_recordset(proposals) AS p(id TEXT) ON p.id = d.id
  ORDER BY d.id FOR UPDATE OF d;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 4 THEN RAISE EXCEPTION 'A reviewed destination is missing'; END IF;
  FOR proposal IN SELECT * FROM jsonb_to_recordset(proposals)
    AS p(id TEXT,name TEXT,lat DOUBLE PRECISION,lng DOUBLE PRECISION,
         external_ids JSONB,features TEXT[],region_source JSONB) ORDER BY id
  LOOP
    SELECT d.id,d.owner,d.name,ST_X(d.location::geometry) AS lng,
           ST_Y(d.location::geometry) AS lat,d.features::TEXT[] AS features,
           d.external_ids,d.country_code,d.state_code,d.metadata
      INTO STRICT current_place FROM destinations d WHERE d.id = proposal.id;
    IF current_place.owner IS DISTINCT FROM 'peaks'
       OR current_place.name IS DISTINCT FROM proposal.name
       OR current_place.lat IS DISTINCT FROM proposal.lat
       OR current_place.lng IS DISTINCT FROM proposal.lng
       OR current_place.features IS DISTINCT FROM proposal.features
       OR COALESCE(current_place.external_ids,'{}'::jsonb) IS DISTINCT FROM proposal.external_ids
       OR (current_place.metadata IS NOT NULL AND jsonb_typeof(current_place.metadata) <> 'object') THEN
      RAISE EXCEPTION 'Reviewed destination identity/coordinate changed: %',proposal.id;
    END IF;
    IF current_place.country_code = 'US' AND current_place.state_code = 'WA'
       AND current_place.metadata->'administrative_region_source' = proposal.region_source THEN
      replay_count := replay_count + 1;
      CONTINUE;
    END IF;
    IF current_place.country_code IS NOT NULL OR current_place.state_code IS NOT NULL
       OR COALESCE(current_place.metadata,'{}'::jsonb) ? 'administrative_region_source' THEN
      RAISE EXCEPTION 'Region changed or source evidence conflicts: %',proposal.id;
    END IF;
    UPDATE destinations SET country_code = 'US', state_code = 'WA',
      metadata = COALESCE(metadata,'{}'::jsonb) ||
        jsonb_build_object('administrative_region_source',proposal.region_source)
    WHERE id = proposal.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Destination update did not affect exactly one row: %',proposal.id; END IF;
    changed_count := changed_count + 1;
  END LOOP;
  IF changed_count + replay_count <> 4 THEN RAISE EXCEPTION 'Incomplete destination repair'; END IF;
  RAISE NOTICE 'region_repair changed=% replayed=%',changed_count,replay_count;
END;
$repair$;
SELECT id,name,country_code,state_code,
       metadata->'administrative_region_source' AS administrative_region_source
FROM destinations WHERE id IN ('Ndsk2Ad2F6r9sXR8cK0m','6PxfQ1g48SrbplzGd6UH','YtzjvQqup3gqmAYnz0l4','APWWTYFkwvuUFc3TP1m9')
ORDER BY id;
-- A separate reviewed metadata CLI run must test both routes after repair.
-- No route path, source, shape, name, status, gate, or destination join is changed.
\if :apply_region_repair
  COMMIT;
\else
  ROLLBACK;
\endif
