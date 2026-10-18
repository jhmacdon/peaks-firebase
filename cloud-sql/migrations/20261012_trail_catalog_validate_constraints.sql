-- Validate new route constraints after bounded names fill and concurrent indexes.
-- No transaction wrapper: validation holds no access-exclusive table lock.
-- Cost: one-time scans on the current Cloud SQL instance; fixed increase ~$0/month.
SET lock_timeout = '5s';
SET statement_timeout = '5min';
ALTER TABLE routes VALIDATE CONSTRAINT routes_kind_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_difficulty_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_est_moving_seconds_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_popularity_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_objective_destination_id_fkey;
ALTER TABLE routes VALIDATE CONSTRAINT routes_trailhead_destination_id_fkey;
