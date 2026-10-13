-- Read-only review. A nearby row alone never proves trailhead identity.
-- Review all source-ID, proposed-ID, name, and nearby matches before inserting.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
WITH proposals (osm_id, proposed_id, source_name, lat, lng) AS (
  VALUES
    ('13122759855', 'C21AD354B7FEA99C277F', 'Skyline Trailhead', 46.7864184, -121.7364531),
    ('2431576647', '6D0E779FF39C5B648D6B', 'Tipsoo Lake Trailhead', 46.8698645, -121.5193890)
),
-- Keep unrelated index strategies in separate branches. Exact source-ID checks
-- remain global, including the older osm_node key and numeric JSON IDs.
source_matches AS MATERIALIZED (
  SELECT '13122759855'::text AS osm_id, d.id, 'source_id'::text AS match_kind
  FROM destinations d WHERE
    d.external_ids @> '{"osm":"13122759855"}'::jsonb
    OR d.external_ids @> '{"osm_node":"13122759855"}'::jsonb
    OR d.external_ids @> '{"osm":13122759855}'::jsonb
    OR d.external_ids @> '{"osm_node":13122759855}'::jsonb
  UNION ALL
  SELECT '2431576647', d.id, 'source_id'
  FROM destinations d WHERE
    d.external_ids @> '{"osm":"2431576647"}'::jsonb
    OR d.external_ids @> '{"osm_node":"2431576647"}'::jsonb
    OR d.external_ids @> '{"osm":2431576647}'::jsonb
    OR d.external_ids @> '{"osm_node":2431576647}'::jsonb
),
id_matches AS MATERIALIZED (
  SELECT p.osm_id, d.id, 'proposed_id'::text AS match_kind
  FROM proposals p JOIN destinations d ON d.id = p.proposed_id
),
name_candidates AS MATERIALIZED (
  SELECT d.id, d.name, d.location
  FROM destinations d
  WHERE to_tsvector('simple', COALESCE(NULLIF(d.search_name, ''), lower(d.name)))
    @@ to_tsquery('simple', 'skyline:* | tipsoo:*')
),
name_matches AS MATERIALIZED (
  SELECT p.osm_id, d.id, 'regional_name'::text AS match_kind
  FROM name_candidates d CROSS JOIN proposals p
  WHERE ST_Covers(ST_MakeEnvelope(-124.9, 45.5, -116.8, 49.1, 4326), d.location::geometry)
    AND ((p.osm_id = '13122759855' AND lower(d.name) LIKE '%skyline%')
      OR (p.osm_id = '2431576647' AND lower(d.name) LIKE '%tipsoo%'))
),
nearby_matches AS MATERIALIZED (
  SELECT '13122759855'::text AS osm_id, d.id, 'nearby_trailhead'::text AS match_kind
  FROM destinations d
  WHERE ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(-121.7364531, 46.7864184), 4326)::geography, 250)
    AND 'trailhead' = ANY(d.features)
  UNION ALL
  SELECT '2431576647', d.id, 'nearby_trailhead'
  FROM destinations d
  WHERE ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(-121.5193890, 46.8698645), 4326)::geography, 250)
    AND 'trailhead' = ANY(d.features)
),
matches AS MATERIALIZED (
  SELECT osm_id, id, array_agg(DISTINCT match_kind ORDER BY match_kind) AS match_kinds
  FROM (
    SELECT * FROM source_matches UNION ALL SELECT * FROM id_matches
    UNION ALL SELECT * FROM name_matches UNION ALL SELECT * FROM nearby_matches
  ) found
  GROUP BY osm_id, id
)
SELECT p.source_name, p.osm_id, d.id, d.name, d.features,
       d.external_ids, d.country_code, d.state_code, m.match_kinds,
       ST_Y(d.location::geometry) AS lat,
       ST_X(d.location::geometry) AS lng,
       ST_Distance(d.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography) AS source_distance_m,
       d.id = p.proposed_id AS proposed_id_match,
       'source_id' = ANY(m.match_kinds) AS source_id_match,
       lower(d.name) = lower(p.source_name) AS exact_name_match
FROM matches m JOIN proposals p ON p.osm_id = m.osm_id
JOIN destinations d ON d.id = m.id
ORDER BY p.source_name, source_id_match DESC NULLS LAST, exact_name_match DESC, source_distance_m, d.id;
ROLLBACK;
