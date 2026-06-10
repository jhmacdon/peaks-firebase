-- Track when a session's processing claim was taken so a stale claim can be
-- recovered. Sessions wedge at processing_state='processing' forever when a
-- processSession run dies between the claim and 'completed'/'failed': the
-- concurrency guard in processSession AND markSessionPendingIfReady both refuse
-- to touch a row already marked 'processing'. With a claim timestamp, a claim
-- older than the max possible run time is treated as dead and re-claimable.
ALTER TABLE tracking_sessions
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
