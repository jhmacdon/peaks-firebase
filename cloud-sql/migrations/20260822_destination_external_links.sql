-- Store reviewed public pages for destinations. Provider IDs remain in
-- external_ids for deduplication; the API turns stable IDs into page URLs and
-- merges them with this list at read time.

ALTER TABLE destinations
  ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE destinations
  DROP CONSTRAINT IF EXISTS destinations_external_links_array,
  ADD CONSTRAINT destinations_external_links_array
  CHECK (jsonb_typeof(external_links) = 'array');

COMMENT ON COLUMN destinations.external_links IS
  'Reviewed public pages for this exact place as [{"type":"provider","id":"https://..."}]';
