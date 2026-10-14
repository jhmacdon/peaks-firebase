-- Validate the abbreviation CHECK constraints added NOT VALID by
-- 20261014_expand_name_abbreviations.sql. VALIDATE takes SHARE UPDATE
-- EXCLUSIVE, so reads and writes continue during the scans (~7 s each cold on
-- prod). It fails if any abbreviated catalog name remains.
--
-- Cost: $0/month.

ALTER TABLE destinations VALIDATE CONSTRAINT destinations_catalog_name_unabbreviated;
ALTER TABLE areas VALIDATE CONSTRAINT areas_name_unabbreviated;
ALTER TABLE routes VALIDATE CONSTRAINT routes_catalog_name_unabbreviated;
