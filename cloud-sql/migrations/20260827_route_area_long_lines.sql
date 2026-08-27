-- Keep exact route-area links fast for long routes. Comparing each protected
-- area part with one continent-scale linestring repeats work across every
-- candidate boundary. Splitting the line lets the same indexed and exact
-- intersection test run against small pieces.
--
-- Run-rate impact: $0/month. This changes one existing write-time query and
-- adds no service, worker, timer, or stored copy.

BEGIN;

CREATE OR REPLACE FUNCTION link_route_to_areas(
  target_route_id TEXT,
  replace_existing BOOLEAN DEFAULT true
)
RETURNS INTEGER AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF replace_existing THEN
    DELETE FROM route_areas
    WHERE route_id = target_route_id
      AND source = 'postgis';
  END IF;

  INSERT INTO route_areas (route_id, area_id, relation, source)
  SELECT r.id, a.id,
         CASE WHEN ST_Covers(a.boundary, r.geom) THEN 'contained_by'
              ELSE 'intersects' END,
         'postgis'
  FROM (
    SELECT id, ST_Force2D(path::geometry) AS geom
    FROM routes
    WHERE id = target_route_id
      AND path IS NOT NULL
  ) r
  JOIN LATERAL (
    SELECT DISTINCT part.area_id
    FROM ST_Subdivide(r.geom, 512) AS route_part(geom)
    JOIN area_boundary_parts part
      ON part.boundary_part && route_part.geom
     AND ST_Intersects(part.boundary_part, route_part.geom)
  ) matched_area ON true
  JOIN areas a ON a.id = matched_area.area_id
  ON CONFLICT (route_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
