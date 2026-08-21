-- The web /peaks/[state] pages filter destinations by state_code for their
-- top-12 and catalog-fact queries (web/src/lib/actions/search.ts). Without an
-- index each hourly ISR revalidation pays a ~1.4 s sequential scan over ~83k
-- rows per state (measured on prod 2026-08-20). Partial because most of the
-- catalog carries no state_code; the queries all filter on an equality that
-- implies NOT NULL. A few MB of disk on the existing instance — $0/month.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_destinations_state_code
ON destinations (state_code)
WHERE state_code IS NOT NULL;
