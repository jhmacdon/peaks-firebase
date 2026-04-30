-- 20260429_split_attempt_group.sql
-- Disambiguate "previous attempts of the same peak" (server-side, populated
-- on every session import by processSession) from "smart-link multi-day
-- chain" (client-driven, opt-in under SmartLinkFlag). Both currently share
-- session_groups + tracking_sessions.group_id, so a 4-year history of
-- repeated Mt Baker climbs collapses into the smart-link merged-proxy log
-- row as if it were one continuous adventure.
--
-- After this migration:
--   * session_attempt_groups holds previous-attempts groupings
--     (server-side, destination-overlap matched in processSession).
--   * session_groups holds smart-link multi-day chains
--     (client-driven, manually-linked or auto-linked under SmartLinkFlag).
--   * tracking_sessions.attempt_group_id  → session_attempt_groups(id)
--   * tracking_sessions.group_id          → session_groups(id)  (now strictly multi-day)
--
-- Caveat: assumes no smart-link groups exist yet in production. The iOS
-- feature flag (rc_smart_link_sessions) was off at the time of this
-- migration, so all existing session_groups rows were created by
-- processSession's matchPreviousAttempts. If smart-link manual link was
-- exercised in production before this runs, those groups will be moved
-- into session_attempt_groups and would need to be re-created by the user.
--
-- Deploy ordering:
--   1. Apply this migration.
--   2. Deploy the matching processing.ts change (uses attempt_group_id and
--      session_attempt_groups). If the old code runs against the migrated
--      schema, matchPreviousAttempts will write to group_id again and
--      re-pollute. Stop or pause the api service during the migration
--      window, or apply the migration immediately followed by deploy.

BEGIN;

-- 1. New table for previous-attempts groupings.
CREATE TABLE IF NOT EXISTS session_attempt_groups (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_attempt_groups_user_id
    ON session_attempt_groups (user_id);

CREATE TRIGGER trg_session_attempt_groups_updated
    BEFORE UPDATE ON session_attempt_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. New column + index on tracking_sessions for the previous-attempts FK.
ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS attempt_group_id TEXT
        REFERENCES session_attempt_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_attempt_group
    ON tracking_sessions (attempt_group_id) WHERE attempt_group_id IS NOT NULL;

-- 3. Move every existing session_groups row into session_attempt_groups.
--    (See caveat above — assumes none of them are real smart-link groups.)
INSERT INTO session_attempt_groups (id, user_id, created_at, updated_at)
SELECT id, user_id, created_at, updated_at FROM session_groups
ON CONFLICT (id) DO NOTHING;

-- 4. Move tracking_sessions.group_id values into attempt_group_id.
UPDATE tracking_sessions
SET attempt_group_id = group_id
WHERE group_id IS NOT NULL AND attempt_group_id IS NULL;

-- 5. Clear tracking_sessions.group_id; smart-link will repopulate it
--    going forward when the iOS feature flag flips on.
UPDATE tracking_sessions SET group_id = NULL WHERE group_id IS NOT NULL;

-- 6. session_groups is now smart-link's exclusive territory, currently
--    empty until the first manual or auto-link writes to it.
DELETE FROM session_groups;

COMMIT;
