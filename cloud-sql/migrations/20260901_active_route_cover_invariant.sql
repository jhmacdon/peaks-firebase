-- Keep every active Peaks-owned route tied to at least one fully credited
-- destination cover.
--
-- These checks are deferred. An importer may add a new cover before it drops
-- the old one, or demote a route and clear its cover in one transaction.
-- Existing active routes are not scanned or changed by this migration. Run the
-- zero-gap audit before applying it so later edits do not expose old gaps.
--
-- Fixed infrastructure cost: $0/month. These triggers run only when route or
-- destination cover records change.

BEGIN;

CREATE OR REPLACE FUNCTION assert_active_peaks_route_has_cover(
  candidate_route_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_route RECORD;
BEGIN
  -- Cover edits on different destinations can race. Lock their shared route
  -- before reading the final state so the later commit sees the earlier one.
  SELECT route.owner, route.status
  INTO current_route
  FROM public.routes route
  WHERE route.id = candidate_route_id
  FOR UPDATE;

  -- A queued check is harmless if its route was deleted, demoted, or moved to
  -- another owner before commit.
  IF NOT FOUND
     OR current_route.owner <> 'peaks'
     OR current_route.status <> 'active' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.route_destinations linked
    JOIN public.destinations destination
      ON destination.id = linked.destination_id
    WHERE linked.route_id = candidate_route_id
      AND NULLIF(btrim(destination.hero_image), '') IS NOT NULL
      AND NULLIF(btrim(destination.hero_image_attribution), '') IS NOT NULL
      AND NULLIF(btrim(destination.hero_image_attribution_url), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'active Peaks route % requires a fully credited derived cover',
      candidate_route_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_active_peaks_route_cover()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_active_peaks_route_has_cover(NEW.id);
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION enforce_active_peaks_route_link_cover()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.assert_active_peaks_route_has_cover(OLD.route_id);
  END IF;

  IF TG_OP <> 'DELETE'
     AND (TG_OP <> 'UPDATE' OR NEW.route_id IS DISTINCT FROM OLD.route_id) THEN
    PERFORM public.assert_active_peaks_route_has_cover(NEW.route_id);
  END IF;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION enforce_active_peaks_destination_cover()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  linked_route_id TEXT;
BEGIN
  FOR linked_route_id IN
    SELECT DISTINCT linked.route_id
    FROM public.route_destinations linked
    WHERE linked.destination_id = NEW.id
  LOOP
    PERFORM public.assert_active_peaks_route_has_cover(linked_route_id);
  END LOOP;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_peaks_route_cover_activation ON routes;
DROP FUNCTION IF EXISTS enforce_peaks_route_cover_activation();

DROP TRIGGER IF EXISTS trg_enforce_active_peaks_route_cover ON routes;
CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_route_cover
AFTER INSERT OR UPDATE ON routes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.owner = 'peaks' AND NEW.status = 'active')
EXECUTE FUNCTION enforce_active_peaks_route_cover();

DROP TRIGGER IF EXISTS trg_enforce_active_peaks_route_link_cover
  ON route_destinations;
CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_route_link_cover
AFTER INSERT OR UPDATE OR DELETE ON route_destinations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_active_peaks_route_link_cover();

DROP TRIGGER IF EXISTS trg_enforce_active_peaks_destination_cover
  ON destinations;
CREATE CONSTRAINT TRIGGER trg_enforce_active_peaks_destination_cover
AFTER UPDATE OF
  hero_image,
  hero_image_attribution,
  hero_image_attribution_url
ON destinations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_active_peaks_destination_cover();

COMMIT;
