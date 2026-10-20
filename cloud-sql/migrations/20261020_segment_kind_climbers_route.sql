-- A climbers route is the non-glacier ground of a mountaineering route that
-- needs climbing gear: Disappointment Cleaver, Cathedral Gap. Rough ground on
-- a hike stays trail; a scramble needs hands; a climb is technical. The import no longer derives scramble or climb from OSM
-- sac_scale; sourced terrain review sets them.
--
-- NOT VALID then VALIDATE keeps the exclusive lock to a catalog update; the
-- scan runs under a lighter lock.
ALTER TABLE segments DROP CONSTRAINT IF EXISTS segments_kind_check;
ALTER TABLE segments ADD CONSTRAINT segments_kind_check
  CHECK (kind IN ('trail','road','snowfield','glacier','climbers_route','scramble','climb','xc')) NOT VALID;
ALTER TABLE segments VALIDATE CONSTRAINT segments_kind_check;
