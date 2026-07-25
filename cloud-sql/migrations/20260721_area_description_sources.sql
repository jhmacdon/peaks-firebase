BEGIN;

ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS description_source_name TEXT,
  ADD COLUMN IF NOT EXISTS description_source_url TEXT,
  ADD COLUMN IF NOT EXISTS description_source_license TEXT;

COMMENT ON COLUMN areas.description_source_name IS
  'Display name for the public text source, when used.';
COMMENT ON COLUMN areas.description_source_url IS
  'Source page used to adapt the area description.';
COMMENT ON COLUMN areas.description_source_license IS
  'License that covers the source text.';

COMMIT;
