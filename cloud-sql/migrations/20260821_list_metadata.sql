-- 20260821_list_metadata.sql
-- Curated-list metadata. year_established is the year the list (or the club
-- that keeps it) was created — a display fact, not a data lineage field.
-- source_name/source_url replace the trailing "Source: <url>" clause that
-- importer descriptions used to carry (web/src/lib/list-content.ts parses the
-- legacy clause; new rows keep description as pure prose).
-- region is a display grouping label ("Colorado", "Northeast US"), not a
-- normalized geography — derive rigorous geography from members' state_code.
BEGIN;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS year_established INT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS region TEXT;
COMMENT ON COLUMN lists.year_established IS 'Year the list or its keeper organization was established; display fact';
COMMENT ON COLUMN lists.source_url IS 'Authoritative source page for membership (e.g. peakbagger list.aspx)';
COMMIT;
