-- A climbers route is a mountaineering route's unbuilt ground: Disappointment
-- Cleaver, Cathedral Gap. Not a trail, not a scramble (hands), not a climb
-- (technical). The import no longer derives scramble or climb from OSM
-- sac_scale; sourced terrain review sets them.
--
-- NOT VALID then VALIDATE keeps the exclusive lock to a catalog update; the
-- scan runs under a lighter lock.
ALTER TABLE segments DROP CONSTRAINT IF EXISTS segments_kind_check;
ALTER TABLE segments ADD CONSTRAINT segments_kind_check
  CHECK (kind IN ('trail','road','snowfield','glacier','climbers_route','scramble','climb','xc')) NOT VALID;
ALTER TABLE segments VALIDATE CONSTRAINT segments_kind_check;
