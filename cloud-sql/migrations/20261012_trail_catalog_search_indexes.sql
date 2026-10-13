-- Catalog search indexes. Run each statement outside any transaction.
-- Apply metadata/jobs DDL and the bounded names refresh before this file.
-- Cost: existing Cloud SQL storage and build I/O only; fixed increase ~$0/month.
-- IF NOT EXISTS preserves a completed build. If a build fails, inspect its
-- pg_index.indisvalid before retrying; remove only that invalid index first.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_state_slug
  ON routes (COALESCE(state_code, ''), slug) WHERE slug IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_search_name_trgm ON routes USING gin (search_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_search_name_prefix ON routes (search_name text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_aliases_trgm ON routes USING gin (peaks_search_names(aliases) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_aliases_prefix ON routes (peaks_search_names(aliases) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_aliases_fts ON routes USING gin
  (to_tsvector('simple', peaks_search_names(aliases))) WHERE status = 'active';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_trail_names_trgm ON segments USING gin (peaks_search_names(trail_names) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_trail_names_prefix ON segments (peaks_search_names(trail_names) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_segments_trail_names_fts ON segments USING gin
  (to_tsvector('simple', peaks_search_names(trail_names)));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_objective_destination ON routes (objective_destination_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_routes_trailhead_destination ON routes (trailhead_destination_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_segments_segment_route ON route_segments (segment_id, route_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_list_routes_route_list ON list_routes (route_id, list_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_catalog_name_trgm ON lists USING gin (peaks_search_name(name) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lists_catalog_name_prefix ON lists (peaks_search_name(name) text_pattern_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trail_catalog_refresh_expired_lease
  ON trail_catalog_refresh_jobs (lease_expires_at) WHERE state = 'working';
