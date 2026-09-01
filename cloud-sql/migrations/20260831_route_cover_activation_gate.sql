-- Stop a pending Peaks-owned route from becoming active until its linked
-- destinations can supply one fully credited derived cover.
--
-- The check is deferred so an importer may assemble route links before it
-- activates the route in the same transaction. Existing active routes stay
-- visible to the separate zero-gap audit; this migration does not hide or
-- rewrite them.
--
-- Fixed infrastructure cost: $0/month. This adds one trigger that runs only
-- when a route changes into the active Peaks-owned state.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_peaks_route_cover_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Read the final row at deferred-trigger time. A route may have changed back
  -- to pending or been deleted after the event that queued this check.
  IF NOT EXISTS (
    SELECT 1
    FROM public.routes current_route
    WHERE current_route.id = NEW.id
      AND current_route.owner = 'peaks'
      AND current_route.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.route_destinations linked
    JOIN public.destinations destination
      ON destination.id = linked.destination_id
    WHERE linked.route_id = NEW.id
      AND NULLIF(btrim(destination.hero_image), '') IS NOT NULL
      AND NULLIF(btrim(destination.hero_image_attribution), '') IS NOT NULL
      AND NULLIF(btrim(destination.hero_image_attribution_url), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'active Peaks route % requires a fully credited derived cover',
      NEW.id;
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_peaks_route_cover_activation ON routes;
CREATE CONSTRAINT TRIGGER trg_enforce_peaks_route_cover_activation
AFTER UPDATE ON routes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  NEW.owner = 'peaks'
  AND NEW.status = 'active'
  AND (
    OLD.owner IS DISTINCT FROM 'peaks'
    OR OLD.status IS DISTINCT FROM 'active'
  )
)
EXECUTE FUNCTION enforce_peaks_route_cover_activation();

COMMIT;
