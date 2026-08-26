BEGIN;

ALTER TABLE destination_photo_candidates
    ADD COLUMN IF NOT EXISTS reviewer_comment TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_comment_by TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_comment_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewer_comment_resolved_by TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_comment_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_destination_photo_candidates_open_comments
    ON destination_photo_candidates (reviewer_comment_updated_at DESC, id)
    WHERE reviewer_comment IS NOT NULL
      AND reviewer_comment_resolved_at IS NULL;

COMMIT;
