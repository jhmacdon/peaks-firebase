-- Use the sourced English display name while preserving the Korean local name.
--
-- OSM node 3819433157 names the peak 대둔산 and supplies the English tag
-- "Daedunsan Peak". Wikidata Q5208179 uses the English label "Daedunsan" and
-- Korean label 대둔산.

UPDATE destinations
SET name = 'Daedunsan',
    search_name = 'daedunsan daedunsan peak 대둔산',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'names',
      COALESCE(metadata->'names', '{}'::jsonb) || jsonb_build_object(
        'english', 'Daedunsan',
        'local', jsonb_build_array('대둔산'),
        'osm_english', 'Daedunsan Peak',
        'osm_default', '대둔산'
      )
    ),
    updated_at = now()
WHERE id = '847AC55208D99F4DAAD1'
  AND country_code = 'KR'
  AND external_ids->>'osm' = '3819433157'
  AND external_ids->>'wikidata' = 'Q5208179';
