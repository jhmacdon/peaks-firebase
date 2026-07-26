-- Retain geometry source, license, attribution, retrieval time, and exact OSM
-- way references on both routes and their source segments. NULL remains valid
-- for legacy geometry whose origin was not recorded.
--
-- Canonical JSONB shape:
-- {
--   "source_kind": "openstreetmap",
--   "source_url": "https://api.openstreetmap.org/api/0.6",
--   "license_name": "Open Data Commons Open Database License (ODbL) 1.0",
--   "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
--   "attribution": "© OpenStreetMap contributors",
--   "retrieved_at": "2026-07-25T00:00:00Z",
--   "osm_way_ids": [123],
--   "osm_way_urls": ["https://www.openstreetmap.org/way/123"],
--   "contains_osm_geometry": true
-- }
--
-- Non-OSM geometry uses empty OSM arrays and contains_osm_geometry false.

BEGIN;

CREATE OR REPLACE FUNCTION is_valid_route_provenance(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object'
      OR NOT value ?& ARRAY[
        'source_kind', 'source_url', 'license_name', 'license_url', 'attribution',
        'retrieved_at', 'osm_way_ids', 'osm_way_urls', 'contains_osm_geometry'
      ]
      OR jsonb_typeof(value->'source_kind') <> 'string'
      OR btrim(value->>'source_kind') !~ '^[a-z0-9][a-z0-9_-]*$'
      OR jsonb_typeof(value->'source_url') <> 'string'
      OR value->>'source_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof(value->'license_name') <> 'string'
      OR btrim(value->>'license_name') = ''
      OR jsonb_typeof(value->'license_url') <> 'string'
      OR value->>'license_url' !~ '^https?://[^[:space:]]+$'
      OR jsonb_typeof(value->'attribution') <> 'string'
      OR btrim(value->>'attribution') = ''
      OR jsonb_typeof(value->'retrieved_at') <> 'string'
      OR value->>'retrieved_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR jsonb_typeof(value->'contains_osm_geometry') <> 'boolean'
      OR jsonb_typeof(value->'osm_way_ids') <> 'array'
      OR jsonb_typeof(value->'osm_way_urls') <> 'array'
    THEN false
    ELSE
      (SELECT count(*) FROM jsonb_object_keys(value)) = 9
      AND jsonb_array_length(value->'osm_way_ids') = jsonb_array_length(value->'osm_way_urls')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value->'osm_way_ids') WITH ORDINALITY AS way_id(value, ordinal)
        JOIN jsonb_array_elements(value->'osm_way_urls') WITH ORDINALITY AS way_url(value, ordinal)
          USING (ordinal)
        WHERE jsonb_typeof(way_id.value) <> 'number'
           OR (way_id.value #>> '{}') !~ '^[1-9][0-9]*$'
           OR jsonb_typeof(way_url.value) <> 'string'
           OR (way_url.value #>> '{}') <>
              ('https://www.openstreetmap.org/way/' || (way_id.value #>> '{}'))
      )
      AND (
        (value->>'contains_osm_geometry')::boolean
          = (jsonb_array_length(value->'osm_way_ids') > 0)
      )
      AND (
        NOT (value->>'contains_osm_geometry')::boolean
        OR (
          value->>'source_kind' = 'openstreetmap'
          AND value->>'license_name' = 'Open Data Commons Open Database License (ODbL) 1.0'
          AND value->>'license_url' = 'https://opendatacommons.org/licenses/odbl/1-0/'
          AND value->>'attribution' = '© OpenStreetMap contributors'
        )
      )
  END;
$$;

ALTER TABLE segments
  ADD COLUMN IF NOT EXISTS provenance JSONB;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS provenance JSONB;

ALTER TABLE segments
  DROP CONSTRAINT IF EXISTS segments_provenance_valid,
  ADD CONSTRAINT segments_provenance_valid
    CHECK (provenance IS NULL OR is_valid_route_provenance(provenance));

ALTER TABLE routes
  DROP CONSTRAINT IF EXISTS routes_provenance_valid,
  ADD CONSTRAINT routes_provenance_valid
    CHECK (provenance IS NULL OR is_valid_route_provenance(provenance));

COMMENT ON COLUMN segments.provenance IS
  'Canonical geometry source, license, attribution, retrieval time, and OSM way references.';
COMMENT ON COLUMN routes.provenance IS
  'Canonical geometry source, license, attribution, retrieval time, and OSM way references.';

COMMIT;
