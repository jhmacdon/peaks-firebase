// Pure helpers for the trip-plan detail page (`(authenticated)/plans/[id]`).
// Free of React, DB and Firestore calls so the bundle-shaping rules (ordering,
// filtering to what actually has data) are unit-tested
// (src/lib/plan-detail.test.ts) instead of re-invented inside the page or the
// server action.
//
// formatFeetValue/formatMilesValue are the same bare-numeral formatters the
// destination, route, area and activity toplines print — one rounding rule
// for the whole site, not a second copy for plans.
import { formatFeetValue, formatMilesValue } from "./destination-detail";
import type { ToplineStat } from "../components/ui/topline";

/** The subset of a catalog destination row the plan page reads. Structural
 * rather than the full `DestinationDetail` shape so the helpers stay
 * testable without a DB row. */
export interface PlanDestinationRow {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  lat: number | null;
  lng: number | null;
}

export interface PlanReachedDestinationRow extends PlanDestinationRow {
  ordinal: number;
}

/** The subset of a catalog route row the plan page reads. */
export interface PlanRouteRow {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
  status: string;
}

/** The plan's own processed fields — populated only once `processPlan` has
 * run against client-supplied geometry (iOS GPX import today; the web
 * create/edit flow never supplies a path). Most plans in production never
 * reach `processing_state = 'completed'`, so every caller must treat every
 * field here as possibly absent rather than assuming it's just slow to
 * arrive. */
export interface PlanProcessing {
  distance: number | null;
  gain: number | null;
  processingState: string;
  /** The plan's own matched track, when one exists — distinct from (and, when
   * present, usually a superset of) the routes' individual polylines; see
   * schema.sql's comment on `plans.path`. */
  path: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}

/** Resolve `promise`, falling back to `fallback` (and reporting to
 * `onError`) if it rejects, rather than letting the rejection propagate.
 * `getPlanBundle` uses this on each of its four independent Cloud SQL
 * queries so a failure in one of the rarer ones (the processing row, the
 * reached-destinations join) degrades that one section to empty instead of
 * taking down the whole bundle — including the reliable Firestore-backed
 * core (identity, ownership, the destination/route lists) that has nothing
 * to do with the query that failed. The `getPlan` Firestore fetch itself
 * deliberately does NOT go through this: an auth/identity failure should
 * still fail the whole load. */
export async function withFallback<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    onError?.(error);
    return fallback;
  }
}

/** Re-order SQL rows (an `id = ANY($1)` query does not preserve input order)
 * back into the order the plan itself saved, and silently drop any id that
 * didn't resolve to a live catalog row (a deleted destination/route) rather
 * than inventing a placeholder for it. */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
      seen.add(id);
    }
  }
  return ordered;
}

/** The topline distance/gain pair — only when the plan has actually been
 * processed. Returns [] (not a dashed placeholder) when nothing is there
 * yet, so the caller drops the whole row rather than printing zeros for the
 * ~99% of plans that were built entirely from the web. */
export function buildPlanTopline(
  processing: Pick<PlanProcessing, "distance" | "gain"> | null
): ToplineStat[] {
  if (!processing) return [];
  const distance = formatMilesValue(processing.distance);
  const gain = formatFeetValue(processing.gain);
  // The (ToplineStat | null)[] annotation matters: with only two branches of
  // identical shape, TS infers the array literal's element type from the
  // literals themselves rather than widening to ToplineStat, which then
  // makes the .filter() type predicate below fail to narrow away null.
  const stats: (ToplineStat | null)[] = [
    distance ? { key: "distance", value: distance, unit: "mi", label: "Distance" } : null,
    gain ? { key: "gain", value: gain, unit: "ft", label: "Elevation gain" } : null,
  ];
  return stats.filter((stat): stat is ToplineStat => stat !== null);
}

export interface PlanMapMarker {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
}

/** Destinations with coordinates, deduplicated by id — a plan's chosen
 * destinations and its auto-matched reached destinations can overlap, and a
 * destination missing its location (never geocoded) has nothing to plot. */
export function buildPlanMapMarkers(
  ...groups: PlanDestinationRow[][]
): PlanMapMarker[] {
  const byId = new Map<string, PlanMapMarker>();
  for (const group of groups) {
    for (const destination of group) {
      if (destination.lat == null || destination.lng == null) continue;
      if (byId.has(destination.id)) continue;
      byId.set(destination.id, {
        id: destination.id,
        name: destination.name,
        lat: destination.lat,
        lng: destination.lng,
      });
    }
  }
  return Array.from(byId.values());
}

export interface PlanMapRoute {
  id: string;
  name: string | null;
  polyline6: string;
}

/** Routes with geometry to draw — a route missing `polyline6` (shouldn't
 * happen for a catalog route, but defensive) has nothing to plot. */
export function buildPlanMapRoutes(routes: PlanRouteRow[]): PlanMapRoute[] {
  return routes
    .filter((route): route is PlanRouteRow & { polyline6: string } => Boolean(route.polyline6))
    .map((route) => ({ id: route.id, name: route.name, polyline6: route.polyline6 }));
}

/** The name/id pairs a picker needs to render its existing selections without
 * a truncated raw id — same "Unnamed" fallback the rest of the site uses for
 * a catalog row with no name. */
export function pickerNames(rows: { id: string; name: string | null }[]): {
  id: string;
  name: string;
}[] {
  return rows.map((row) => ({ id: row.id, name: row.name || "Unnamed" }));
}
