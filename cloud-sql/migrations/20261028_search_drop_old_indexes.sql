-- Drop search indexes nothing reads after 20261028_search_stored_vectors.sql.
--
-- Mixed search now matches on the stored term_vector / search_vector columns
-- and no longer falls back to trigram matching, so the expression full-text
-- indexes and the trigram indexes on these two tables go unused. Only
-- api/src/routes/search.ts reads either table.
--
-- Apply manually as postgres only after the API that reads the stored
-- columns is serving all traffic (the previous revision still uses these):
--   psql -h 127.0.0.1 -U postgres -d peaks -v ON_ERROR_STOP=1 -f cloud-sql/migrations/20261028_search_drop_old_indexes.sql

DROP INDEX CONCURRENTLY IF EXISTS idx_route_search_terms_fts;
DROP INDEX CONCURRENTLY IF EXISTS idx_route_search_terms_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_destination_search_rows_fts;
DROP INDEX CONCURRENTLY IF EXISTS idx_destination_search_rows_trgm;
