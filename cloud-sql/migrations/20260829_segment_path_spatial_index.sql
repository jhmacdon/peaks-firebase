-- Segment matching searches for existing segment paths near a pending route.
-- Without a GiST index, ST_DWithin scans and decodes every segment path and can
-- exceed the worker's statement timeout as the shared segment graph grows.
--
-- Cost impact: one compact index on the existing segments table, expected to
-- stay under tens of MB (less than $0.01/month) with no fixed compute cost.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_path
ON segments USING GIST (path);

ANALYZE segments;
