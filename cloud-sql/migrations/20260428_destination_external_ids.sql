-- Add external_ids JSONB to destinations so a single row can carry IDs from
-- multiple external providers (OSM, GNIS, Wikidata, AllTrails, etc.) without
-- one being load-bearing as the primary key. Used by bulk imports for dedup
-- and by future admin tooling to link existing rows to external sources.
ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS external_ids JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS destinations_external_ids_idx
  ON destinations USING gin (external_ids);
