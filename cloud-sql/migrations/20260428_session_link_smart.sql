-- 20260428_session_link_smart.sql
-- Smart-link multi-day recordings: distinguish auto vs. manual groups,
-- and remember per-session unlink decisions so auto-link rules respect them.

ALTER TABLE session_groups
    ADD COLUMN IF NOT EXISTS manually_linked boolean NOT NULL DEFAULT false;

ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS link_opt_out boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_link_opt_out
    ON tracking_sessions (user_id) WHERE link_opt_out = true;
