-- Keep protected-area links in sync whenever a route is created or its path
-- changes. Route imports previously relied on a separate batch link step, so a
-- route could remain unclassified until that batch ran again.

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
    FROM area_boundary_parts part
    WHERE part.boundary_part && r.geom
      AND ST_Intersects(part.boundary_part, r.geom)
  ) matched_area ON true
  JOIN areas a ON a.id = matched_area.area_id
  ON CONFLICT (route_id, area_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_route_area_links_on_path_write()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM link_route_to_areas(NEW.id, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_route_link_areas ON routes;
CREATE TRIGGER trg_route_link_areas
AFTER INSERT OR UPDATE OF path ON routes
FOR EACH ROW
EXECUTE FUNCTION refresh_route_area_links_on_path_write();

-- Repair routes that never received a generated area link. Recomputing every
-- route is needlessly costly against the largest protected-area polygons.
WITH routes_missing_area_links AS MATERIALIZED (
  SELECT r.id
  FROM routes r
  WHERE r.path IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM route_areas ra
      WHERE ra.route_id = r.id
        AND ra.source = 'postgis'
    )
)
SELECT COALESCE(sum(link_route_to_areas(id, true)), 0) AS repaired_links
FROM routes_missing_area_links;

COMMIT;
