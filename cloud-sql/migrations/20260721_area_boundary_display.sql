-- Materialized display boundary for protected areas.
--
-- The area detail endpoint used to simplify the full-resolution PAD-US
-- boundary on every request. For large coastal parks (Olympic NP:
-- 21,865 vertices across 274 polygons) the per-request work plus the
-- geography-based session intersection pushed the query past the statement
-- timeout and the endpoint returned 503.
--
-- `boundary_display` stores a topology-preserving simplification computed
-- once, using the same adaptive tolerance the endpoint used live: bbox
-- extent / 1500, clamped to [0.00005, 0.02] degrees. The API serves
-- COALESCE(boundary_display, live simplify) so rows imported before their
-- backfill still render.
--
-- Run as postgres (owner). The trigger below keeps the column current for
-- every future boundary write (importer upserts included); the UPDATE
-- backfills existing rows.

ALTER TABLE areas ADD COLUMN IF NOT EXISTS boundary_display geometry(MultiPolygon, 4326);

COMMENT ON COLUMN areas.boundary_display IS
  'Simplified copy of boundary for map display (adaptive tolerance ~bbox/1500). boundary remains the authoritative geometry for containment/linking.';

CREATE OR REPLACE FUNCTION areas_refresh_boundary_display() RETURNS trigger AS $$
BEGIN
  NEW.boundary_display := ST_Multi(ST_CollectionExtract(ST_MakeValid(
    ST_SimplifyPreserveTopology(
      NEW.boundary,
      GREATEST(
        0.00005,
        LEAST(
          0.02,
          GREATEST(
            NEW.bbox_max_lat - NEW.bbox_min_lat,
            NEW.bbox_max_lng - NEW.bbox_min_lng
          ) / 1500.0
        )
      )
    )
  ), 3));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_areas_boundary_display ON areas;
CREATE TRIGGER trg_areas_boundary_display
BEFORE INSERT OR UPDATE OF boundary ON areas
FOR EACH ROW
WHEN (NEW.boundary IS NOT NULL)
EXECUTE FUNCTION areas_refresh_boundary_display();

UPDATE areas
SET boundary_display = ST_Multi(ST_CollectionExtract(ST_MakeValid(
      ST_SimplifyPreserveTopology(
        boundary,
        GREATEST(
          0.00005,
          LEAST(
            0.02,
            GREATEST(
              bbox_max_lat - bbox_min_lat,
              bbox_max_lng - bbox_min_lng
            ) / 1500.0
          )
        )
      )
    ), 3))
WHERE boundary IS NOT NULL
  AND boundary_display IS NULL;
