import type {
  PlanDestinationRow,
  PlanReachedDestinationRow,
  PlanRouteRow,
} from "./plan-detail";

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  date: Date | null;
  distance: number | null;
  gain: number | null;
  path: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  createdAt: Date;
  updatedAt: Date;
  isPublic: true;
}

export interface PublicPlanBundle {
  plan: PublicPlan;
  destinations: PlanDestinationRow[];
  routes: PublicPlanRouteRow[];
  reachedDestinations: PlanReachedDestinationRow[];
}

export interface PublicPlanRouteRow extends PlanRouteRow {
  /** Only catalog routes have their own public `/routes/{id}` page. */
  isCatalog: boolean;
}

interface PublicPlanBundleRow {
  id: unknown;
  name: unknown;
  description: unknown;
  date: unknown;
  distance: unknown;
  gain: unknown;
  path: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  created_at: unknown;
  updated_at: unknown;
  destinations: unknown;
  routes: unknown;
  reached_destinations: unknown;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item)
    );
  }
  if (typeof value === "string") {
    try {
      return rows(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function destination(row: Record<string, unknown>): PlanDestinationRow {
  return {
    id: String(row.id),
    name: row.name == null ? null : String(row.name),
    elevation: numberOrNull(row.elevation),
    features: textArray(row.features),
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
  };
}

/** One statement gives every public field the same visibility snapshot. */
export function buildPublicPlanBundleQuery(planId: string): {
  text: string;
  values: unknown[];
} {
  return {
    text: `WITH public_plan AS (
      SELECT p.id, p.name, p.description, p.date, p.distance, p.gain,
             CASE WHEN p.path IS NOT NULL THEN ST_AsGeoJSON(p.path)::json END AS path,
             p.created_at, p.updated_at
      FROM plans p
      WHERE p.id = $1 AND p.is_public = true
        AND NOT EXISTS (
          SELECT 1
          FROM plan_routes invalid_pr
          JOIN routes invalid_route ON invalid_route.id = invalid_pr.route_id
          WHERE invalid_pr.plan_id = p.id
            AND invalid_route.owner IS DISTINCT FROM 'peaks'
            AND invalid_route.owner IS DISTINCT FROM p.user_id
        )
    )
    SELECT pp.*,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', d.id,
               'name', d.name,
               'elevation', d.elevation,
               'features', d.features,
               'lat', ST_Y(d.location::geometry),
               'lng', ST_X(d.location::geometry)
             ) ORDER BY pd.ordinal)
             FROM plan_destinations pd
             JOIN destinations d ON d.id = pd.destination_id
             WHERE pd.plan_id = pp.id
           ), '[]'::json) AS destinations,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', r.id,
               'name', r.name,
               'polyline6', r.polyline6,
               'distance', r.distance,
               'gain', r.gain,
               'status', r.status,
               'isCatalog', r.owner = 'peaks'
             ) ORDER BY pr.ordinal)
             FROM plan_routes pr
             JOIN routes r ON r.id = pr.route_id
             WHERE pr.plan_id = pp.id
               AND r.status IN ('active', 'superseded')
               AND (
                 r.owner = 'peaks'
                 OR EXISTS (
                   SELECT 1 FROM plans route_owner_plan
                   WHERE route_owner_plan.id = pp.id
                     AND route_owner_plan.user_id = r.owner
                 )
               )
           ), '[]'::json) AS routes,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', d.id,
               'name', d.name,
               'elevation', d.elevation,
               'features', d.features,
               'lat', ST_Y(d.location::geometry),
               'lng', ST_X(d.location::geometry),
               'ordinal', prd.ordinal
             ) ORDER BY prd.ordinal)
             FROM plan_reached_destinations prd
             JOIN destinations d ON d.id = prd.destination_id
             WHERE prd.plan_id = pp.id
           ), '[]'::json) AS reached_destinations
    FROM public_plan pp`,
    values: [planId],
  };
}

export function mapPublicPlanBundleRow(
  row: PublicPlanBundleRow
): PublicPlanBundle | null {
  const createdAt = dateOrNull(row.created_at);
  const updatedAt = dateOrNull(row.updated_at);
  if (!createdAt || !updatedAt) return null;

  return {
    plan: {
      id: String(row.id),
      name: row.name == null ? "" : String(row.name),
      description: row.description == null ? "" : String(row.description),
      date: dateOrNull(row.date),
      distance: numberOrNull(row.distance),
      gain: numberOrNull(row.gain),
      path: row.path ?? null,
      createdAt,
      updatedAt,
      isPublic: true,
    },
    destinations: rows(row.destinations).map(destination),
    routes: rows(row.routes).map((route) => ({
      id: String(route.id),
      name: route.name == null ? null : String(route.name),
      polyline6: route.polyline6 == null ? null : String(route.polyline6),
      distance: numberOrNull(route.distance),
      gain: numberOrNull(route.gain),
      status: route.status == null ? "" : String(route.status),
      isCatalog: route.isCatalog === true,
    })),
    reachedDestinations: rows(row.reached_destinations).map((reached) => ({
      ...destination(reached),
      ordinal: Number(reached.ordinal),
    })),
  };
}
