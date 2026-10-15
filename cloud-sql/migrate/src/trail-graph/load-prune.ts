import { IMPORT_MARKER } from './load-matching';
import type { RoutePlan, Statement } from './load-catalog';
export function prunePlan(plans: RoutePlan[], keepRouteIds: string[]): Statement[] {
  const marker = JSON.stringify({ wa_catalog: { loader: IMPORT_MARKER } });
  const segments = [...new Set(plans.flatMap(p => p.segment_ids))], places = [...new Set(plans.flatMap(p => p.destination_ids ?? []))];
  return [
    { kind: 'begin', sql: 'BEGIN', values: [] },
    { kind: 'lock', sql: "SELECT pg_advisory_xact_lock(hashtextextended('wa_trail_catalog_loader',0))", values: [] },
    { kind: 'prune_routes', sql: `DELETE FROM routes r WHERE id LIKE 'wa-%' AND status='pending'
      AND provenance @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE a.route_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM session_routes sr WHERE sr.route_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM trail_catalog_review_jobs j WHERE j.route_id=r.id)
      AND NOT wa_catalog_has_references('public.routes'::regclass,r.id,ARRAY['public.route_segments'::regclass,'public.route_destinations'::regclass]) RETURNING id`, values: [marker, keepRouteIds] },
    { kind: 'prune_segments', sql: `DELETE FROM segments s WHERE id LIKE 'wa-%' AND provenance @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE s.id=ANY(a.segment_ids))
      AND NOT wa_catalog_has_references('public.segments'::regclass,s.id) RETURNING id`, values: [marker, segments] },
    { kind: 'prune_places', sql: `DELETE FROM destinations d WHERE id LIKE 'wa-%' AND metadata->'provenance' @> $1::jsonb AND NOT(id=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM wa_catalog_activation_receipts a WHERE d.id=ANY(a.destination_ids))
      AND NOT wa_catalog_has_references('public.destinations'::regclass,d.id) RETURNING id`, values: [marker, places] },
    { kind: 'commit', sql: 'COMMIT', values: [] },
  ];
}
