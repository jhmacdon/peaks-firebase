-- Derive one credited route cover from the route's linked destinations.
--
-- No photo data is copied onto routes. A destination photo stops serving as a
-- route cover as soon as its image, credit, or credit link becomes blank, and
-- destination photo edits flow through on the next read.
--
-- Apply manually as postgres (CI does not run production migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks \
--     -f cloud-sql/migrations/20260830_route_cover_photos.sql
--
-- Fixed infrastructure cost: $0/month. This is a plain view over existing
-- tables and does not add a service, scheduler, or stored copy.

BEGIN;

CREATE OR REPLACE VIEW route_cover_photos AS
SELECT DISTINCT ON (rd.route_id)
    rd.route_id,
    d.id AS destination_id,
    d.name AS destination_name,
    btrim(d.hero_image) AS image_url,
    btrim(d.hero_image_attribution) AS attribution,
    btrim(d.hero_image_attribution_url) AS attribution_url,
    d.hero_image_focal_x AS focal_x,
    d.hero_image_focal_y AS focal_y
FROM route_destinations rd
JOIN destinations d ON d.id = rd.destination_id
WHERE NULLIF(btrim(d.hero_image), '') IS NOT NULL
  AND NULLIF(btrim(d.hero_image_attribution), '') IS NOT NULL
  AND NULLIF(btrim(d.hero_image_attribution_url), '') IS NOT NULL
ORDER BY
    rd.route_id,
    ('summit'::destination_feature = ANY(d.features)) DESC,
    rd.ordinal DESC,
    d.prominence DESC NULLS LAST,
    d.elevation DESC NULLS LAST,
    d.name ASC NULLS LAST,
    d.id ASC;

GRANT SELECT ON route_cover_photos TO "peaks-api";

COMMIT;
