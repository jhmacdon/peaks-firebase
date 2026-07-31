-- Keep the elevation sample source and profile beside geometry provenance.
-- Both fields are optional for older rows and must appear together.

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
      OR (value ? 'elevation_source') <> (value ? 'elevation_profile')
      OR (
        value ? 'elevation_source'
        AND (
          jsonb_typeof(value->'elevation_source') <> 'string'
          OR btrim(value->>'elevation_source') = ''
          OR jsonb_typeof(value->'elevation_profile') <> 'string'
          OR value->>'elevation_profile' NOT IN ('terrain', 'monotonic_ascent')
        )
      )
    THEN false
    ELSE
      (SELECT count(*) FROM jsonb_object_keys(value)) IN (9, 11)
      AND jsonb_array_length(value->'osm_way_ids')
          = jsonb_array_length(value->'osm_way_urls')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value->'osm_way_ids')
          WITH ORDINALITY AS way_id(value, ordinal)
        JOIN jsonb_array_elements(value->'osm_way_urls')
          WITH ORDINALITY AS way_url(value, ordinal)
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
          AND value->>'license_name' =
              'Open Data Commons Open Database License (ODbL) 1.0'
          AND value->>'license_url' =
              'https://opendatacommons.org/licenses/odbl/1-0/'
          AND value->>'attribution' = '© OpenStreetMap contributors'
        )
      )
  END;
$$;

COMMENT ON FUNCTION is_valid_route_provenance(JSONB) IS
  'Checks canonical route geometry provenance and optional elevation source fields.';

COMMIT;
