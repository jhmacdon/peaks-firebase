-- Persist import enrichment provenance for advanced deduplication.
ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS source_contributions JSONB NOT NULL DEFAULT '[]'::jsonb;

