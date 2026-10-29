-- Stored word lists and lengths for route and place search.
--
-- Mixed search scores names that hold every query word, capped for a common
-- word to the 1,000 shortest, most popular, and nearest catalog names (see
-- SEARCH_CANDIDATE_CAP in api/src/routes/search.ts). Computing those lists
-- read every match first: "trail" matches 105k of 164k route terms, which
-- took 2-3 s on a throttled db-f1-micro. These columns and partial indexes
-- let each list walk its own order and stop after 1,000 rows.
--
-- Adding a stored generated column rewrites the table under an exclusive
-- lock; at today's sizes that takes well under a minute, and search waits
-- for it rather than failing. The indexes then build concurrently.
--
-- Apply manually as postgres before deploying the API (CI does not run
-- migrations). The CONCURRENTLY statements cannot run in a transaction, so
-- run the file without --single-transaction:
--   psql -h 127.0.0.1 -U postgres -d peaks -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_search_stored_vectors.sql
-- Then, after the new API is serving, apply 20261028_search_drop_old_indexes.sql.

SET lock_timeout = '10s';

BEGIN;

ALTER TABLE route_search_terms
  ADD COLUMN IF NOT EXISTS term_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, term)) STORED,
  ADD COLUMN IF NOT EXISTS term_length integer
    GENERATED ALWAYS AS (length(term)) STORED;

ALTER TABLE destination_search_rows
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(NULLIF(search_name, ''), lower(name)))) STORED,
  ADD COLUMN IF NOT EXISTS search_length integer
    GENERATED ALWAYS AS (length(search_name)) STORED;

COMMIT;

RESET lock_timeout;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_search_terms_vector
  ON route_search_terms USING gin (term_vector);
-- User-owned rows are never capped and are few (about 300); their own index
-- keeps that list from reading every catalog match of a common word.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_search_terms_user_vector
  ON route_search_terms USING gin (term_vector) WHERE owner <> 'peaks';
-- The shortest and most-popular lists filter on the word list while walking
-- and return the scoring columns, so these indexes include every column a
-- list reads and answer without visiting the table. "trail" places skip 80k
-- names that hold no match: 0.5 s with table visits against 20 ms without.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_search_terms_shortest
  ON route_search_terms (term_length, term, route_id)
  INCLUDE (term_vector, public, popularity, anchor, weight, public_weight) WHERE owner = 'peaks';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_search_terms_popular
  ON route_search_terms (popularity DESC, term_length, term, route_id)
  INCLUDE (term_vector, public, anchor, weight, public_weight) WHERE owner = 'peaks';
-- A common route word ("trail", 64% of terms) finds its nearest 1,000 within
-- a few thousand rows of this walk. No place word matches more than ~30k
-- places, and sorting those beat walking a place distance index, so places
-- have none.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_search_terms_anchor
  ON route_search_terms USING gist (anchor) WHERE owner = 'peaks';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destination_search_rows_vector
  ON destination_search_rows USING gin (search_vector);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destination_search_rows_user_vector
  ON destination_search_rows USING gin (search_vector) WHERE owner <> 'peaks';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destination_search_rows_shortest
  ON destination_search_rows (search_length, search_name, id)
  INCLUDE (search_vector, features, name, session_count_offset, location) WHERE owner = 'peaks';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destination_search_rows_popular
  ON destination_search_rows (session_count_offset DESC, search_length, search_name, id)
  INCLUDE (search_vector, features, name, location) WHERE owner = 'peaks';

-- Index-only scans need the visibility map; VACUUM sets it now rather than
-- waiting for autovacuum.
VACUUM (ANALYZE) route_search_terms;
VACUUM (ANALYZE) destination_search_rows;
