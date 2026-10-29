-- Add per-place outline provenance to existing catalogs. No new columns,
-- geometry edits, rematches, services or fixed cost ($0/month).
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.destination_glacier_facts gf
SET provenance = gf.provenance || jsonb_build_object('outline',jsonb_build_object(
    'schema_version',1,
    'geometry_source',COALESCE(NULLIF(d.metadata->'glacier_catalog'->>'source',''),gf.outline_source_url),
    'source_url',gf.outline_source_url,
    'source_sha256',gf.outline_source_sha256,
    -- The old field held the mapping snapshot, not an imagery observation.
    'observed_at',NULL,
    'snapshot_at',to_char(gf.outline_observed_at,'YYYY-MM-DD'),
    'license',gf.geometry_license,
    'license_url',CASE WHEN gf.geometry_license='ODbL-1.0' THEN 'https://www.openstreetmap.org/copyright' END,
    'credit',gf.geometry_credit,
    'method','Legacy mapping snapshot; imagery observation date unknown'
  )), updated_at=now()
FROM public.destinations d
WHERE d.id=gf.destination_id AND NOT (gf.provenance ? 'outline');

-- Facts-only metadata edits do not fire the UPDATE OF outline triggers.
-- Replay skips rows that already have outline provenance, including newer
-- imports; it never overwrites a reviewed source or observation date.
COMMIT;
