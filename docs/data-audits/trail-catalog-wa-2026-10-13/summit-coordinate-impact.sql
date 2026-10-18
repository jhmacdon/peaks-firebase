-- Read only: all current Peaks routes that reference any proposed summit move.
-- No source geometry or route geometry is returned, and no rows are changed.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
WITH proposed (destination_id, osm_id, lat, lng) AS (
  VALUES
    ('nSf6z4vL0zjdG2sXibBM', '356546426', 47.5068935, -121.7390220),
    ('xHaYBgzoxgfAZNLTfWid', '356545680', 47.4986861, -121.7560032),
    ('5hVnUW4tmqj3A6YbU0oB', '285408190', 47.4624091, -121.6392795),
    ('htqW9lCp974x1tEWD8t7', '348178753', 46.9581410, -121.8773099),
    ('iAD3EhqmkKVKXBjJjprj', '348999742', 48.0579162, -121.7977487)
), places AS MATERIALIZED (
  SELECT p.*, d.name, d.elevation, d.external_ids, d.updated_at,
         d.location AS old_location,
         ST_SetSRID(ST_MakePoint(p.lng,p.lat,d.elevation),4326)::geography AS proposed_location
  FROM proposed p JOIN destinations d ON d.id=p.destination_id
), all_refs AS MATERIALIZED (
  SELECT p.destination_id, rd.route_id, 'route_destinations'::text AS reference_kind
  FROM places p JOIN route_destinations rd ON rd.destination_id=p.destination_id
  UNION ALL
  SELECT p.destination_id, r.id, 'objective_destination_id'
  FROM places p JOIN routes r ON r.objective_destination_id=p.destination_id
  UNION ALL
  SELECT p.destination_id, r.id, 'trailhead_destination_id'
  FROM places p JOIN routes r ON r.trailhead_destination_id=p.destination_id
), refs AS MATERIALIZED (
  SELECT destination_id, route_id, array_agg(DISTINCT reference_kind ORDER BY reference_kind) AS reference_kinds
  FROM all_refs GROUP BY destination_id, route_id
), current_catalog_routes AS MATERIALIZED (
  SELECT ref.destination_id, ref.reference_kinds, r.id, r.name, r.status, r.shape,
         r.kind, r.objective_destination_id, r.path, r.updated_at
  FROM refs ref JOIN routes r ON r.id=ref.route_id
  WHERE r.owner='peaks' AND r.status IN ('active','pending')
), contacts AS MATERIALIZED (
  SELECT r.destination_id, r.id AS route_id, r.name, r.status, r.shape, r.kind,
         r.reference_kinds, r.updated_at,
         r.objective_destination_id=p.destination_id AS is_objective,
         ST_Distance(r.path,p.old_location) AS old_path_gap_m,
         ST_Distance(r.path,p.proposed_location) AS new_path_gap_m,
         ST_Distance(ST_EndPoint(r.path::geometry)::geography,p.old_location) AS old_end_gap_m,
         ST_Distance(ST_EndPoint(r.path::geometry)::geography,p.proposed_location) AS new_end_gap_m,
         ST_DWithin(r.path,p.old_location,5) AS old_path_contact,
         ST_DWithin(r.path,p.proposed_location,5) AS new_path_contact
  FROM current_catalog_routes r JOIN places p ON p.destination_id=r.destination_id
)
SELECT p.destination_id, p.name, p.osm_id,
       p.external_ids->>'osm'=p.osm_id AS same_osm_identity,
       p.external_ids, p.elevation, p.updated_at,
       ST_Y(p.old_location::geometry) AS old_lat, ST_X(p.old_location::geometry) AS old_lng,
       p.lat AS proposed_lat, p.lng AS proposed_lng,
       ST_Distance(p.old_location,p.proposed_location) AS coordinate_move_m,
       COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.status,c.route_id) FROM contacts c WHERE c.destination_id=p.destination_id),'[]'::jsonb) AS affected_current_catalog_routes,
       (SELECT count(*) FROM refs ref JOIN routes r ON r.id=ref.route_id WHERE ref.destination_id=p.destination_id AND r.owner<>'peaks' AND r.status IN ('active','pending')) AS other_owner_current_route_count,
       (SELECT count(*) FROM refs ref JOIN routes r ON r.id=ref.route_id WHERE ref.destination_id=p.destination_id AND r.owner='peaks' AND r.status NOT IN ('active','pending')) AS retired_catalog_route_count
FROM places p ORDER BY p.name;
ROLLBACK;
