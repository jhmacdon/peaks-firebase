BEGIN;

ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN areas.description IS
  'Short user-facing summary built from catalog facts and linked peaks.';

COMMIT;
