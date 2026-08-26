-- Saved routes are private by default. Existing rows stay private until their
-- owners choose to share them.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_public BOOLEAN;

UPDATE plans
SET is_public = FALSE
WHERE is_public IS NULL;

ALTER TABLE plans ALTER COLUMN is_public SET DEFAULT FALSE;
ALTER TABLE plans ALTER COLUMN is_public SET NOT NULL;
