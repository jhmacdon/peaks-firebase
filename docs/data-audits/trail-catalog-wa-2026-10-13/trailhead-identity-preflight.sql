-- Read-only review. A nearby row alone never proves trailhead identity.
-- Review all source-ID, proposed-ID, name, and nearby matches before inserting.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
WITH proposals (osm_id, proposed_id, source_name, lat, lng) AS (
  VALUES
    ('13122759855', 'C21AD354B7FEA99C277F', 'Skyline Trailhead', 46.7864184, -121.7364531),
    ('2431576647', '6D0E779FF39C5B648D6B', 'Tipsoo Lake Trailhead', 46.8698645, -121.5193890)
)
SELECT p.source_name, p.osm_id, d.id, d.name, d.features,
       d.external_ids, d.country_code, d.state_code,
       ST_Y(d.location::geometry) AS lat,
       ST_X(d.location::geometry) AS lng,
       ST_Distance(d.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography) AS source_distance_m,
       d.id = p.proposed_id AS proposed_id_match,
       d.external_ids @> jsonb_build_object('osm', p.osm_id) AS source_id_match,
       lower(d.name) = lower(p.source_name) AS exact_name_match
FROM proposals p
JOIN destinations d ON
  d.id = p.proposed_id
  OR d.external_ids @> jsonb_build_object('osm', p.osm_id)
  OR lower(d.name) = lower(p.source_name)
  OR (p.osm_id = '13122759855' AND lower(d.name) LIKE '%skyline%')
  OR (p.osm_id = '2431576647' AND lower(d.name) LIKE '%tipsoo%')
  OR ('trailhead' = ANY(d.features) AND ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, 250))
ORDER BY p.source_name, source_id_match DESC NULLS LAST, exact_name_match DESC, source_distance_m, d.id;
ROLLBACK;
