BEGIN;

ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS server_updated_at TIMESTAMPTZ;

ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS processing_state TEXT;

ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS processing_error TEXT;

UPDATE tracking_sessions
SET server_updated_at = COALESCE(server_updated_at, updated_at, created_at, now())
WHERE server_updated_at IS NULL;

UPDATE tracking_sessions s
SET processing_state = CASE
    WHEN s.processed_at IS NOT NULL THEN 'completed'
    WHEN s.ended = true AND EXISTS (
        SELECT 1
        FROM tracking_points tp
        WHERE tp.session_id = s.id
    ) THEN 'pending'
    ELSE 'idle'
END
WHERE s.processing_state IS NULL;

ALTER TABLE tracking_sessions
    ALTER COLUMN server_updated_at SET DEFAULT now();

ALTER TABLE tracking_sessions
    ALTER COLUMN server_updated_at SET NOT NULL;

ALTER TABLE tracking_sessions
    ALTER COLUMN processing_state SET DEFAULT 'idle';

ALTER TABLE tracking_sessions
    ALTER COLUMN processing_state SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tracking_sessions_processing_state_check'
    ) THEN
        ALTER TABLE tracking_sessions
        ADD CONSTRAINT tracking_sessions_processing_state_check
        CHECK (processing_state IN ('idle', 'pending', 'processing', 'completed', 'failed'));
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS session_tombstones (
    session_id        TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    deleted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_sync
    ON tracking_sessions (user_id, server_updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_processing
    ON tracking_sessions (user_id, processing_state, server_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_tombstones_sync
    ON session_tombstones (user_id, server_updated_at ASC, session_id ASC);

CREATE OR REPLACE FUNCTION update_tracking_session_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    NEW.server_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tracking_sessions_updated ON tracking_sessions;
CREATE TRIGGER trg_tracking_sessions_updated
BEFORE UPDATE ON tracking_sessions
FOR EACH ROW EXECUTE FUNCTION update_tracking_session_timestamps();

CREATE OR REPLACE FUNCTION touch_related_tracking_session()
RETURNS TRIGGER AS $$
DECLARE
    target_session_id TEXT;
BEGIN
    target_session_id := COALESCE(NEW.session_id, OLD.session_id);

    UPDATE tracking_sessions
    SET server_updated_at = now()
    WHERE id = target_session_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_destinations_touch_session ON session_destinations;
CREATE TRIGGER trg_session_destinations_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_destinations
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

DROP TRIGGER IF EXISTS trg_session_routes_touch_session ON session_routes;
CREATE TRIGGER trg_session_routes_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_routes
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

DROP TRIGGER IF EXISTS trg_session_markers_touch_session ON session_markers;
CREATE TRIGGER trg_session_markers_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_markers
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

COMMIT;
