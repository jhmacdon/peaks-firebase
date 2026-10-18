-- Look up one route's cover photo through the route's own index.
--
-- route_cover_photos chose one photo per route with DISTINCT ON over every
-- route_destinations row. Postgres cannot push a join condition into a
-- DISTINCT ON view, so `LEFT JOIN route_cover_photos cover ON cover.route_id
-- = r.id` rebuilt the whole view (a scan of all 83k destinations and 23k
-- route links, about 1 s) for every outer row. Production, 2026-10-09: the
-- session sync feed builds route JSON per session, so a page of 83 sessions
-- took over 60 s, hit the 30 s statement timeout, and failed on every app
-- launch. The requests it held starved search of connections.
--
-- route_cover_photo(route_id) holds the ranking and reads one route's links
-- through route_destinations_pkey. The view keeps its name, columns and
-- rows, and now calls the function once per route, so a join on route_id
-- costs one index lookup. Every caller in the API and web app is unchanged.
-- Checked against the old view on production data: the same 433 rows, and
-- the sync page dropped from 100 s to 0.7 s with identical output.
--
-- SECURITY DEFINER keeps the view's old behaviour: callers read the
-- underlying tables with the owner's rights, as they did through the view.
--
-- Cost: none.

BEGIN;

CREATE OR REPLACE FUNCTION route_cover_photo(target_route_id text)
RETURNS TABLE (
    destination_id   text,
    destination_name text,
    image_url        text,
    attribution      text,
    attribution_url  text,
    focal_x          smallint,
    focal_y          smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id,
         d.name,
         btrim(d.hero_image),
         btrim(d.hero_image_attribution),
         btrim(d.hero_image_attribution_url),
         d.hero_image_focal_x,
         d.hero_image_focal_y
  FROM route_destinations rd
  JOIN destinations d ON d.id = rd.destination_id
  WHERE rd.route_id = target_route_id
    AND NULLIF(btrim(d.hero_image), '') IS NOT NULL
    AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
    AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL
  ORDER BY ('summit'::destination_feature = ANY (d.features)) DESC,
           rd.ordinal DESC,
           d.prominence DESC NULLS LAST,
           d.elevation DESC NULLS LAST,
           d.name,
           d.id
  LIMIT 1
$$;

CREATE OR REPLACE VIEW route_cover_photos AS
SELECT r.id AS route_id,
       cover.destination_id,
       cover.destination_name,
       cover.image_url,
       cover.attribution,
       cover.attribution_url,
       cover.focal_x,
       cover.focal_y
FROM routes r
CROSS JOIN LATERAL route_cover_photo(r.id) AS cover;

COMMIT;
