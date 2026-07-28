-- Make protected-area relinks visible to clients polling /sessions/changes.
--
-- This trigger has no always-on cost. It updates a session timestamp only when
-- a session-area row changes, so the estimated incremental run-rate is $0/month.

BEGIN;

DROP TRIGGER IF EXISTS trg_session_areas_touch_session ON session_areas;
CREATE TRIGGER trg_session_areas_touch_session
AFTER INSERT OR UPDATE OR DELETE ON session_areas
FOR EACH ROW EXECUTE FUNCTION touch_related_tracking_session();

COMMIT;
