-- Bump a session's sync timestamp only when the row changed.
--
-- update_tracking_session_timestamps set updated_at and server_updated_at on
-- every UPDATE, including one that rewrote the same values. The app resends
-- sessions it already synced (2026-10-09: 70-150 PUTs per launch), so each
-- launch marked those sessions changed, and the next /api/sessions/changes
-- downloaded them again with their heart-rate series: 83 sessions, 14.5 MB,
-- 14 s, holding database connections while the app's search waited.
--
-- An UPDATE that leaves every other column as it was now keeps both
-- timestamps. Rows compare as jsonb so geography and json-typed columns
-- compare exactly. An UPDATE that sets server_updated_at itself
-- (touch_related_tracking_session, after a session_destinations change)
-- still bumps both, as before.
--
-- Cost: none. One jsonb comparison per session UPDATE.

BEGIN;

CREATE OR REPLACE FUNCTION update_tracking_session_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.server_updated_at IS NOT DISTINCT FROM OLD.server_updated_at
       AND (to_jsonb(NEW) - ARRAY['updated_at', 'server_updated_at'])
         = (to_jsonb(OLD) - ARRAY['updated_at', 'server_updated_at']) THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = now();
    NEW.server_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
