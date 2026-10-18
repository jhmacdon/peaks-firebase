-- peaks_search_names called peaks_search_name without a schema. Autovacuum and
-- ANALYZE evaluate index expressions with an empty search_path, so every
-- autoanalyze of routes and segments failed from 2026-10-12 with "function
-- peaks_search_name(text) does not exist". Planner stats stayed frozen at
-- about 555 active routes; after the catalog loads raised that to 6,205, the
-- route search query took 35-60 s and hit the 30 s statement timeout.
--
-- The body still inlines to the same peaks_search_name(array_to_string(...))
-- call, so the indexes on peaks_search_names(aliases) and
-- peaks_search_names(trail_names) keep their values and need no rebuild.
-- Run as postgres, the function owner.
--
-- Cost: ~$0/month. No new service or index.

BEGIN;

CREATE OR REPLACE FUNCTION peaks_search_names(value TEXT[])
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.peaks_search_name(array_to_string(value, ' '));
$$;

COMMIT;

-- Refresh stats now rather than waiting for the next autoanalyze.
ANALYZE routes;
ANALYZE segments;
