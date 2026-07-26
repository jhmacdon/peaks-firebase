-- Short place copy with source credit, plus a curated massif polygon.
--
-- description*: a few sentences of encyclopedic copy for a summit, shown on the
-- iOS destination page above the place-facts shelf. Licensing is not optional:
-- description_source_name / _url / _license travel with the text, and the client
-- renders a credit line linking back to the source. Backfilled from Wikipedia by
-- cloud-sql/migrate/src/backfill-destination-descriptions.ts.
--
-- massif_boundary: a hand-curated ring around the whole mountain's ground —
-- roughly the bounding river valleys, not the summit cone. It answers "did this
-- climb happen ON this mountain" for flank objectives (Camp Muir counts for
-- Rainier; Crystal Peak does not). Deliberately SEPARATE from destinations.boundary,
-- which is the small footprint shape for area destinations (lakes, campgrounds)
-- and is consumed by the session auto-link trigger — widening that column to a
-- massif would auto-link every passer-by as having "reached" the summit.
--
-- Polygon (not MultiPolygon) matches destinations.boundary and is enough for a
-- single connected massif. Nullable everywhere: almost every row stays NULL and
-- the client hides absent copy.

BEGIN;

ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS description                 TEXT,
  ADD COLUMN IF NOT EXISTS description_source_name     TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url      TEXT,
  ADD COLUMN IF NOT EXISTS description_source_license  TEXT,
  ADD COLUMN IF NOT EXISTS massif_boundary             geography(Polygon, 4326);

CREATE INDEX IF NOT EXISTS idx_destinations_massif_boundary
  ON destinations USING GIST (massif_boundary) WHERE massif_boundary IS NOT NULL;

COMMIT;
