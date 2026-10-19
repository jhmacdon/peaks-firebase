-- Destination search reads a narrow copy of each place's search fields instead
-- of rechecking trigram matches against destinations rows. Those rows average
-- 2.8 KB (boundaries, copy, amenities), so on 2026-10-18 "colchuck lake"
-- rechecked 9,000 candidates by reading 7,448 pages (about 60 MB) and took
-- 1.8 s on an idle db-f1-micro, several times that once throttled.
--
-- A row trigger copies the fields from NEW on every write. It reads no other
-- table, so it adds no locks, and it never touches routes.
--
-- Run as postgres. Cost: ~$0/month; about 15 MB of table and indexes on the
-- existing instance, no new service.

BEGIN;

CREATE TABLE IF NOT EXISTS destination_search_rows (
  id                   TEXT PRIMARY KEY,
  name                 TEXT,
  search_name          TEXT NOT NULL,
  owner                TEXT NOT NULL,
  features             destination_feature[] NOT NULL,
  session_count_offset INTEGER NOT NULL,
  location             geography(PointZ, 4326)
);
ALTER TABLE destination_search_rows OWNER TO postgres;
GRANT SELECT ON destination_search_rows TO "peaks-api";

CREATE INDEX IF NOT EXISTS idx_destination_search_rows_trgm
  ON destination_search_rows USING gin (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_destination_search_rows_fts
  ON destination_search_rows USING gin (to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name))));

CREATE OR REPLACE FUNCTION destination_search_rows_on_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.destination_search_rows WHERE id = OLD.id;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.id <> NEW.id THEN
    DELETE FROM public.destination_search_rows WHERE id = OLD.id;
  END IF;
  INSERT INTO public.destination_search_rows
    (id, name, search_name, owner, features, session_count_offset, location)
  VALUES (NEW.id, NEW.name, NEW.search_name, NEW.owner, NEW.features, NEW.session_count_offset, NEW.location)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, search_name = EXCLUDED.search_name, owner = EXCLUDED.owner,
    features = EXCLUDED.features, session_count_offset = EXCLUDED.session_count_offset,
    location = EXCLUDED.location;
  RETURN NULL;
END;
$$;
ALTER FUNCTION destination_search_rows_on_write() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION destination_search_rows_on_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_destinations_search_rows_insert ON destinations;
CREATE TRIGGER trg_destinations_search_rows_insert
  AFTER INSERT ON destinations
  FOR EACH ROW EXECUTE FUNCTION destination_search_rows_on_write();

-- UPDATE OF fires on the statement's SET list. No BEFORE trigger on
-- destinations writes a copied field (checked 2026-10-18), so every change
-- arrives through one of these columns.
DROP TRIGGER IF EXISTS trg_destinations_search_rows_update ON destinations;
CREATE TRIGGER trg_destinations_search_rows_update
  AFTER UPDATE OF id, name, search_name, owner, features, session_count_offset, location ON destinations
  FOR EACH ROW
  WHEN (OLD.id IS DISTINCT FROM NEW.id
     OR OLD.name IS DISTINCT FROM NEW.name
     OR OLD.search_name IS DISTINCT FROM NEW.search_name
     OR OLD.owner IS DISTINCT FROM NEW.owner
     OR OLD.features IS DISTINCT FROM NEW.features
     OR OLD.session_count_offset IS DISTINCT FROM NEW.session_count_offset
     OR ST_AsEWKB(OLD.location::geometry) IS DISTINCT FROM ST_AsEWKB(NEW.location::geometry))
  EXECUTE FUNCTION destination_search_rows_on_write();

DROP TRIGGER IF EXISTS trg_destinations_search_rows_delete ON destinations;
CREATE TRIGGER trg_destinations_search_rows_delete
  AFTER DELETE ON destinations
  FOR EACH ROW EXECUTE FUNCTION destination_search_rows_on_write();

INSERT INTO destination_search_rows (id, name, search_name, owner, features, session_count_offset, location)
SELECT id, name, search_name, owner, features, session_count_offset, location FROM destinations
ON CONFLICT (id) DO NOTHING;

COMMIT;

ANALYZE destination_search_rows;
