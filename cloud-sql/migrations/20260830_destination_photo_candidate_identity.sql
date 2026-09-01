BEGIN;

LOCK TABLE destination_photo_candidates IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE destination_photo_candidates
  ADD COLUMN IF NOT EXISTS media_sha1 TEXT,
  ADD COLUMN IF NOT EXISTS candidate_origin TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE destination_photo_candidates
  DROP CONSTRAINT IF EXISTS destination_photo_candidates_media_sha1_format,
  ADD CONSTRAINT destination_photo_candidates_media_sha1_format
  CHECK (media_sha1 IS NULL OR media_sha1 ~ '^[0-9a-f]{40}$');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'destination_photo_candidates_origin_allowed'
       AND conrelid = 'destination_photo_candidates'::regclass
  ) THEN
    ALTER TABLE destination_photo_candidates
      ADD CONSTRAINT destination_photo_candidates_origin_allowed
      CHECK (candidate_origin IN ('manual', 'manifest_import', 'listed_photo_backfill'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_destination_photo_candidates_listed_backfill_pending
  ON destination_photo_candidates (destination_id)
  WHERE status = 'pending'
    AND candidate_origin = 'listed_photo_backfill';

CREATE UNIQUE INDEX IF NOT EXISTS uq_destination_photo_candidates_media_sha1
  ON destination_photo_candidates (destination_id, media_sha1)
  WHERE media_sha1 IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_listed_photo_backfill_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending'
       AND OLD.destination_id = NEW.destination_id
       AND OLD.candidate_origin = NEW.candidate_origin THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM 1
    FROM destinations
   WHERE id = NEW.destination_id
   FOR UPDATE;

  IF NEW.candidate_origin = 'listed_photo_backfill'
     AND EXISTS (
       SELECT 1
         FROM destination_photo_candidates existing
        WHERE existing.destination_id = NEW.destination_id
          AND existing.status = 'pending'
          AND existing.id <> NEW.id
     ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS destination_photo_candidates_pending_guard
  ON destination_photo_candidates;

CREATE TRIGGER destination_photo_candidates_pending_guard
BEFORE INSERT OR UPDATE OF status, destination_id, candidate_origin
ON destination_photo_candidates
FOR EACH ROW
EXECUTE FUNCTION guard_listed_photo_backfill_pending();

COMMENT ON COLUMN destination_photo_candidates.media_sha1 IS
  'MediaWiki imageinfo SHA-1 in its 40-character hexadecimal form. Used to keep review final across file aliases and host variants.';

COMMENT ON COLUMN destination_photo_candidates.candidate_origin IS
  'Writer class. Manual and manifest imports may offer alternatives; the listed-photo backfill may queue at most one pending proposal.';

COMMIT;
