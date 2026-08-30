import { Router, Request, Response } from "express";
import { asyncRoute } from "../lib/async-route";
import { PoolClient } from "pg";
import { getUid } from "../auth";
import db from "../db";
import { processPlan } from "../processing";
import { parseStatusIds } from "./sessions";
import { buildAirQualityResponse, snapToCell, HrrrRow } from "../air-quality";
import { fetchCams, CamsFetcher } from "../open-meteo";
import { isOptionalFiniteNumber } from "../lib/finite-number";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";

const router = Router();

// Minimal structural type so the status handler can take an injected pool in
// tests without depending on the concrete pg Pool.
interface StatusQueryable {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

interface PlanRouteRecord {
  id: string;
  geometry: { type: "LineString"; coordinates: number[][] };
  name?: string;
  polyline6?: string;
  destinations?: string[];
  geohashes?: string[];
  distance?: number;
  gain?: number;
  gain_loss?: number;
  elevation_string?: string;
  completion?: "none" | "straight" | "reverse";
}

export class InaccessiblePlanRouteError extends Error {
  constructor() {
    super("One or more routes are unavailable");
    this.name = "InaccessiblePlanRouteError";
  }
}

/** Runtime validation for the browser/mobile supplied route id list. */
export function normalizePlanRouteIds(
  value: unknown
): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 1_500) {
      return null;
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export async function assertPlanRoutesAccessible(
  client: Pick<PoolClient, "query">,
  uid: string,
  routeIds: string[]
): Promise<void> {
  if (routeIds.length === 0) return;
  const result = await client.query<{ id: string }>(
    `SELECT r.id
     FROM routes r
     WHERE r.id = ANY($1::text[])
       AND (r.owner = 'peaks' OR r.owner = $2)
     FOR SHARE`,
    [routeIds, uid]
  );
  const accessible = new Set(result.rows.map((row) => row.id));
  if (accessible.size !== routeIds.length
      || routeIds.some((id) => !accessible.has(id))) {
    throw new InaccessiblePlanRouteError();
  }
}

// Validate a client-supplied GeoJSON geometry is a usable plan path: a
// LineString with >= 2 coordinate pairs of finite numbers. Returns true when
// absent (geometry is optional) so callers pass it straight through. Guards the
// DB call from a 500 on malformed/wrong-type input (return 400 instead) and
// from a non-LineString reaching ST_GeomFromGeoJSON.
export function isValidPlanGeometry(g: unknown): boolean {
  if (g === undefined || g === null) return true;
  if (typeof g !== "object") return false;
  const geo = g as { type?: unknown; coordinates?: unknown };
  if (geo.type !== "LineString") return false;
  if (!Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return false;
  return geo.coordinates.every(
    (c) =>
      Array.isArray(c)
      && c.length >= 2
      && Number.isFinite(c[0])
      && Number.isFinite(c[1])
      && (c.length < 3 || Number.isFinite(c[2]))
  );
}

export function isValidRouteGeometry3D(g: unknown): boolean {
  if (!isValidPlanGeometry(g) || g === undefined || g === null) return false;
  const geo = g as { coordinates: unknown[] };
  return geo.coordinates.every(
    (coordinate) => Array.isArray(coordinate) && coordinate.length >= 3
      && Number.isFinite(coordinate[2])
  );
}

export function parsePlanRouteRecords(
  value: unknown,
  routeIdsValue: unknown
): PlanRouteRecord[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !Array.isArray(routeIdsValue)) return null;
  const routeIds = new Set(
    routeIdsValue.filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const records: PlanRouteRecord[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !routeIds.has(record.id)) return null;
    if (!isValidRouteGeometry3D(record.geometry)) return null;

    for (const key of ["name", "polyline6", "elevation_string"] as const) {
      if (record[key] !== undefined && typeof record[key] !== "string") return null;
    }
    for (const key of ["distance", "gain", "gain_loss"] as const) {
      if (record[key] !== undefined
          && (typeof record[key] !== "number" || !Number.isFinite(record[key]))) {
        return null;
      }
    }
    for (const key of ["destinations", "geohashes"] as const) {
      if (record[key] !== undefined
          && (!Array.isArray(record[key])
            || !record[key].every((entry) => typeof entry === "string"))) {
        return null;
      }
    }
    if (record.completion !== undefined
        && !["none", "straight", "reverse"].includes(record.completion as string)) {
      return null;
    }

    records.push(record as unknown as PlanRouteRecord);
  }
  return records;
}

async function upsertPlanRouteRecords(
  client: PoolClient,
  uid: string,
  records: PlanRouteRecord[]
): Promise<void> {
  for (const route of records) {
    await client.query(
      `INSERT INTO routes (
         id, name, path, polyline6, geohashes, owner,
         distance, gain, gain_loss, elevation_string, completion, status
       ) VALUES (
         $1, $2,
         ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography,
         $4, $5, $6, $7, $8, $9, $10, $11::completion_mode, 'active'
       )
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         path = EXCLUDED.path,
         polyline6 = COALESCE(EXCLUDED.polyline6, routes.polyline6),
         geohashes = EXCLUDED.geohashes,
         distance = EXCLUDED.distance,
         gain = EXCLUDED.gain,
         gain_loss = EXCLUDED.gain_loss,
         elevation_string = EXCLUDED.elevation_string,
         completion = EXCLUDED.completion,
         updated_at = now()
       WHERE routes.owner = EXCLUDED.owner`,
      [
        route.id,
        route.name ?? null,
        JSON.stringify(route.geometry),
        route.polyline6 ?? null,
        route.geohashes ?? [],
        uid,
        route.distance ?? null,
        route.gain ?? null,
        route.gain_loss ?? null,
        route.elevation_string ?? null,
        route.completion ?? "none",
      ]
    );

    await client.query(
      `DELETE FROM route_destinations rd
       USING routes r
       WHERE rd.route_id = $1 AND r.id = rd.route_id AND r.owner = $2`,
      [route.id, uid]
    );
    const destinationIds = route.destinations ?? [];
    for (let ordinal = 0; ordinal < destinationIds.length; ordinal++) {
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         SELECT $1, $2, $3
         WHERE EXISTS (SELECT 1 FROM routes WHERE id = $1 AND owner = $4)
           AND EXISTS (SELECT 1 FROM destinations WHERE id = $2)
         ON CONFLICT (route_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
        [route.id, destinationIds[ordinal], ordinal, uid]
      );
    }
  }
}

async function replacePlanRoutes(
  client: PoolClient,
  planId: string,
  uid: string,
  routeIds: string[]
): Promise<void> {
  await assertPlanRoutesAccessible(client, uid, routeIds);
  await client.query(`DELETE FROM plan_routes WHERE plan_id = $1`, [planId]);
  for (let ordinal = 0; ordinal < routeIds.length; ordinal++) {
    const linked = await client.query(
      `INSERT INTO plan_routes (plan_id, route_id, ordinal)
       SELECT $1, r.id, $3
       FROM routes r
       WHERE r.id = $2 AND (r.owner = 'peaks' OR r.owner = $4)
       ON CONFLICT (plan_id, route_id) DO UPDATE SET ordinal = EXCLUDED.ordinal
       RETURNING route_id`,
      [planId, routeIds[ordinal], ordinal, uid]
    );
    if (linked.rows.length !== 1) throw new InaccessiblePlanRouteError();
  }
}

// GET /api/plans/processing-status?ids=a,b — batch poll for plan processing
// state. Returns ONLY scalar processing fields (owned by the caller) in a single
// query — same poll-storm-safe contract as the sessions endpoint. Registered
// before GET /:id so "processing-status" isn't swallowed as an :id.
export async function handlePlanProcessingStatus(
  req: Request,
  res: Response,
  pool: StatusQueryable = db
): Promise<void> {
  const uid = getUid(req);
  const ids = parseStatusIds(req.query.ids);
  if (ids.length === 0) {
    res.status(400).json({ error: "ids query parameter required" });
    return;
  }
  const result = await pool.query(
    `SELECT id, processing_state, processing_error, processed_at, updated_at AS server_updated_at
     FROM plans
     WHERE user_id = $1 AND id = ANY($2)`,
    [uid, ids]
  );
  res.json(result.rows);
}

router.get("/processing-status", asyncRoute((req, res: Response) => handlePlanProcessingStatus(req, res)));

// GET /api/plans — current user's plans (owned + party member)
router.get("/", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const requestedLimit = parseInt(req.query.limit as string);
  const requestedOffset = parseInt(req.query.offset as string);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 250)
    : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

  const result = await db.query(
    `SELECT DISTINCT p.id, p.user_id, p.name, p.description, p.date, p.is_public,
            COALESCE((
              SELECT array_agg(pd.destination_id ORDER BY pd.ordinal)
              FROM plan_destinations pd WHERE pd.plan_id = p.id
            ), '{}') AS destination_ids,
            COALESCE((
              SELECT array_agg(pr.route_id ORDER BY pr.ordinal)
              FROM plan_routes pr WHERE pr.plan_id = p.id
            ), '{}') AS route_ids,
            COALESCE((
              SELECT array_agg(pp2.user_id ORDER BY pp2.joined_at)
              FROM plan_party pp2 WHERE pp2.plan_id = p.id
            ), '{}') AS party_ids,
            (SELECT COUNT(*) FROM plan_destinations WHERE plan_id = p.id) AS destination_count,
            (SELECT COUNT(*) FROM plan_routes WHERE plan_id = p.id) AS route_count,
            (SELECT COUNT(*) FROM plan_party WHERE plan_id = p.id) AS party_count,
            p.processing_state, p.processing_error, p.processed_at,
            p.created_at, p.updated_at
     FROM plans p
     LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $1
     WHERE p.user_id = $1 OR pp.user_id = $1
     ORDER BY p.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json(result.rows);
}));

// GET /api/plans/:id
router.get("/:id", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const result = await db.query(
    `SELECT p.id, p.user_id, p.name, p.description, p.date, p.is_public,
            COALESCE((
              SELECT array_agg(pd.destination_id ORDER BY pd.ordinal)
              FROM plan_destinations pd WHERE pd.plan_id = p.id
            ), '{}') AS destination_ids,
            COALESCE((
              SELECT array_agg(pr.route_id ORDER BY pr.ordinal)
              FROM plan_routes pr WHERE pr.plan_id = p.id
            ), '{}') AS route_ids,
            COALESCE((
              SELECT array_agg(pp2.user_id ORDER BY pp2.joined_at)
              FROM plan_party pp2 WHERE pp2.plan_id = p.id
            ), '{}') AS party_ids,
            p.processing_state, p.processing_error, p.processed_at,
            p.created_at, p.updated_at
     FROM plans p
     LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
     WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json(result.rows[0]);
}));

export function buildPlanDestinationsQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            pd.ordinal
     FROM destinations d
     JOIN plan_destinations pd ON pd.destination_id = d.id
     WHERE pd.plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY pd.ordinal`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/destinations — owner or party member only
router.get("/:id/destinations", asyncRoute(async (req, res: Response) => {
  const query = buildPlanDestinationsQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
}));

// GET /api/plans/:id/reached-destinations — auto-matched destinations along the
// plan path, ordered. Powers the clockless plan timeline (route import + plan
// detail). Distinct from /:id/destinations (user-chosen goals).
router.get("/:id/reached-destinations", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            prd.ordinal
     FROM destinations d
     JOIN plan_reached_destinations prd ON prd.destination_id = d.id
     WHERE prd.plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY prd.ordinal`,
    [id, uid]
  );
  res.json(result.rows);
}));

export function buildPlanRoutesQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT r.id, r.name, r.polyline6, r.geohashes, r.owner,
            r.distance, r.gain, r.gain_loss, r.elevation_string,
            r.completion, r.shape, r.provenance,
            (r.owner = 'peaks') AS is_catalog,
            pr.ordinal,
            ${routeCoverSelectSql()}
     FROM routes r
     JOIN plan_routes pr ON pr.route_id = r.id
     ${routeCoverJoinSql()}
     WHERE pr.plan_id = $1
       AND r.status IN ('active', 'superseded')
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1
           AND (r.owner = 'peaks' OR r.owner = p.user_id)
           AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY pr.ordinal`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/routes — owner or party member only
router.get("/:id/routes", asyncRoute(async (req, res: Response) => {
  const query = buildPlanRoutesQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
}));

export function buildPlanPartyQuery(
  id: string,
  uid: string
): { text: string; values: unknown[] } {
  return {
    text: `SELECT user_id, joined_at FROM plan_party
     WHERE plan_id = $1
       AND EXISTS (
         SELECT 1 FROM plans p
         LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
         WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)
       )
     ORDER BY joined_at`,
    values: [id, uid],
  };
}

// GET /api/plans/:id/party — owner or party member only
router.get("/:id/party", asyncRoute(async (req, res: Response) => {
  const query = buildPlanPartyQuery(req.params.id, getUid(req));
  const result = await db.query(query.text, query.values);
  res.json(result.rows);
}));

// GET /api/plans/:id/air-quality — merged HRRR-Smoke (0–48 h, CONUS) +
// Open-Meteo/CAMS (7 days, global) forecast at the plan's location, with the
// plan's own day flagged. Same owner-or-party access rule as GET /:id.
// Upstream trouble degrades to { available: false } — the plan page must
// never break because a smoke feed hiccuped.
// Design: docs/superpowers/specs/2026-08-06-plan-air-quality-design.md
export async function handlePlanAirQuality(
  req: Request,
  res: Response,
  pool: StatusQueryable = db,
  cams: CamsFetcher = fetchCams,
  nowSec: () => number = () => Math.floor(Date.now() / 1000)
): Promise<void> {
  const uid = getUid(req);
  const { id } = req.params;
  try {
    const planResult = await pool.query(
      `SELECT p.date
       FROM plans p
       LEFT JOIN plan_party pp ON pp.plan_id = p.id AND pp.user_id = $2
       WHERE p.id = $1 AND (p.user_id = $2 OR pp.user_id = $2)`,
      [id, uid]
    );
    if (planResult.rows.length === 0) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    const planDate = (planResult.rows[0] as { date: Date | null }).date;

    const destResult = await pool.query(
      `SELECT lat, lng FROM (
         SELECT ST_Y(d.location::geometry) AS lat,
                ST_X(d.location::geometry) AS lng,
                pd.ordinal
         FROM plan_destinations pd
         JOIN destinations d ON d.id = pd.destination_id
         WHERE pd.plan_id = $1 AND d.location IS NOT NULL
         ORDER BY pd.ordinal, pd.destination_id
         LIMIT 1
       ) first_destination`,
      [id]
    );
    let point =
      destResult.rows.length > 0
        ? (destResult.rows[0] as { lat: number | null; lng: number | null })
        : null;
    if (!point) {
      const pathResult = await pool.query(
        `SELECT ST_Y(pt) AS lat, ST_X(pt) AS lng
         FROM (SELECT ST_PointOnSurface(path::geometry) AS pt
               FROM plans WHERE id = $1 AND path IS NOT NULL) s`,
        [id]
      );
      point =
        pathResult.rows.length > 0
          ? (pathResult.rows[0] as { lat: number | null; lng: number | null })
          : null;
    }
    if (!point || point.lat === null || point.lng === null) {
      res.json({ available: false, reason: "no_location" });
      return;
    }

    const cell = snapToCell(point.lat, point.lng);
    const smokeResult = await pool.query(
      `SELECT valid_at, run_at, smoke_ug_m3
       FROM smoke_forecasts
       WHERE cell_key = $1 AND valid_at >= now() - interval '1 hour'
       ORDER BY valid_at`,
      [cell.cellKey]
    );
    const hrrrRows: HrrrRow[] = (
      smokeResult.rows as { valid_at: Date; run_at: Date; smoke_ug_m3: number }[]
    ).map((r) => ({
      validAtSec: Math.floor(new Date(r.valid_at).getTime() / 1000),
      smokeUgM3: r.smoke_ug_m3,
      runAtIso: new Date(r.run_at).toISOString(),
    }));

    const camsData = await cams(cell.lat, cell.lng);
    res.json(
      buildAirQualityResponse({
        point: { lat: point.lat, lng: point.lng },
        hrrrRows,
        cams: camsData,
        planDateSec: planDate
          ? Math.floor(new Date(planDate).getTime() / 1000)
          : null,
        nowSec: nowSec(),
      })
    );
  } catch (err) {
    console.error("[air-quality] lookup failed:", err);
    res.status(500).json({ error: "air quality lookup failed" });
  }
}

router.get("/:id/air-quality", asyncRoute((req, res: Response) => handlePlanAirQuality(req, res)));

/** Change sharing without replacing any other saved-route fields. */
export async function handlePlanVisibility(
  req: Request,
  res: Response,
  pool: StatusQueryable = db
): Promise<void> {
  const uid = getUid(req);
  const { id } = req.params;
  const isPublic = req.body?.is_public;
  if (typeof isPublic !== "boolean") {
    res.status(400).json({ error: "is_public must be a boolean" });
    return;
  }

  const result = await pool.query(
    `UPDATE plans
     SET is_public = $3, updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, is_public`,
    [id, uid, isPublic]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json(result.rows[0]);
}

router.patch(
  "/:id/visibility",
  asyncRoute((req, res: Response) => handlePlanVisibility(req, res))
);

// POST /api/plans — create a new plan
router.post("/", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const {
    id, name, description, date, destinations, routes: routeIdsValue,
    route_records: routeRecordsValue, geometry, distance, gain,
    is_public: isPublic,
  } = req.body;
  const routeIds = normalizePlanRouteIds(routeIdsValue);
  const routeRecords = parsePlanRouteRecords(routeRecordsValue, routeIds);

  if (!id || !name) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  if (!isValidPlanGeometry(geometry)) {
    res.status(400).json({ error: "geometry must be a GeoJSON LineString with >= 2 points" });
    return;
  }
  if (!isOptionalFiniteNumber(distance) || !isOptionalFiniteNumber(gain)) {
    res.status(400).json({ error: "distance and gain must be finite numbers or null" });
    return;
  }
  if (!isOptionalBoolean(isPublic)) {
    res.status(400).json({ error: "is_public must be a boolean" });
    return;
  }
  if (routeIds === null) {
    res.status(400).json({ error: "routes must contain valid route ids" });
    return;
  }
  if (routeRecords === null) {
    res.status(400).json({ error: "route_records must contain valid routes listed in routes" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // The plan path drives destination matching. route_records moves any
    // user/imported route into Cloud SQL before plan_routes links it.
    const planWrite = await client.query(
      `INSERT INTO plans (id, user_id, name, description, date, is_public, path, distance, gain,
                          processing_state, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7::text IS NOT NULL THEN ST_Force2D(ST_GeomFromGeoJSON($7))::geography ELSE NULL END,
               $8, $9,
               CASE WHEN $7::text IS NOT NULL THEN 'pending' ELSE 'idle' END,
               now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         date = EXCLUDED.date,
         is_public = EXCLUDED.is_public,
         path = COALESCE(EXCLUDED.path, plans.path),
         distance = COALESCE(EXCLUDED.distance, plans.distance),
         gain = COALESCE(EXCLUDED.gain, plans.gain),
         processing_state = CASE WHEN EXCLUDED.path IS NOT NULL THEN 'pending' ELSE plans.processing_state END,
         updated_at = now()
       WHERE plans.user_id = EXCLUDED.user_id
       RETURNING id, is_public`,
      [id, uid, name, description || null, date || null, isPublic === true,
       geometry ? JSON.stringify(geometry) : null, distance ?? null, gain ?? null]
    );
    if (planWrite.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Route ID unavailable" });
      return;
    }

    if (destinations) {
      await client.query(
        `DELETE FROM plan_destinations WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < destinations.length; i++) {
        await client.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, destinations[i], i]
        );
      }
    }

    await upsertPlanRouteRecords(client, uid, routeRecords);

    if (routeIds !== undefined) {
      await replacePlanRoutes(client, id, uid, routeIds);
    }

    await client.query("COMMIT");

    // Kick processing inline (best-effort) when geometry was supplied. iOS polls
    // /processing-status to observe pending→completed; a failure here flips the
    // plan to 'failed' inside processPlan and is surfaced the same way.
    if (geometry) {
      processPlan(id, uid).catch((err) =>
        console.error(`Inline plan process failed for ${id}:`, err)
      );
    }

    res.status(201).json({ id, is_public: isPublic === true });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof InaccessiblePlanRouteError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("Error creating plan:", err);
    res.status(500).json({ error: "Failed to create plan" });
  } finally {
    client.release();
  }
}));

// PUT /api/plans/:id — update plan metadata
router.put("/:id", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const {
    name, description, date, destinations, routes: routeIdsValue,
    route_records: routeRecordsValue, geometry, distance, gain,
    is_public: isPublic,
  } = req.body;
  const routeIds = normalizePlanRouteIds(routeIdsValue);
  const routeRecords = parsePlanRouteRecords(routeRecordsValue, routeIds);
  const hasDate = Object.prototype.hasOwnProperty.call(req.body, "date");
  const hasIsPublic = Object.prototype.hasOwnProperty.call(req.body, "is_public");

  if (!isValidPlanGeometry(geometry)) {
    res.status(400).json({ error: "geometry must be a GeoJSON LineString with >= 2 points" });
    return;
  }
  if (!isOptionalFiniteNumber(distance) || !isOptionalFiniteNumber(gain)) {
    res.status(400).json({ error: "distance and gain must be finite numbers or null" });
    return;
  }
  if (!isOptionalBoolean(isPublic)) {
    res.status(400).json({ error: "is_public must be a boolean" });
    return;
  }
  if (routeIds === null) {
    res.status(400).json({ error: "routes must contain valid route ids" });
    return;
  }
  if (routeRecords === null) {
    res.status(400).json({ error: "route_records must contain valid routes listed in routes" });
    return;
  }

  // Verify ownership
  const plan = await db.query(
    `SELECT id FROM plans WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Geometry (when supplied) replaces plans.path and re-flags 'pending' so the
    // plan re-processes; processPlan is kicked after COMMIT.
    const updateResult = await client.query(
      `UPDATE plans SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         date = CASE WHEN $4 THEN $5::timestamptz ELSE date END,
         path = CASE WHEN $6::text IS NOT NULL THEN ST_Force2D(ST_GeomFromGeoJSON($6))::geography ELSE path END,
         distance = COALESCE($7, distance),
         gain = COALESCE($8, gain),
         is_public = CASE WHEN $9 THEN $10::boolean ELSE is_public END,
         processing_state = CASE WHEN $6::text IS NOT NULL THEN 'pending' ELSE processing_state END,
         updated_at = now()
       WHERE id = $1 AND user_id = $11
       RETURNING id, is_public`,
      [id, name ?? null, description ?? null, hasDate, date ?? null,
       geometry ? JSON.stringify(geometry) : null, distance ?? null, gain ?? null,
       hasIsPublic, isPublic ?? false, uid]
    );
    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Route not found" });
      return;
    }

    if (destinations) {
      await client.query(
        `DELETE FROM plan_destinations WHERE plan_id = $1`,
        [id]
      );
      for (let i = 0; i < destinations.length; i++) {
        await client.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, destinations[i], i]
        );
      }
    }

    await upsertPlanRouteRecords(client, uid, routeRecords);

    if (routeIds !== undefined) {
      await replacePlanRoutes(client, id, uid, routeIds);
    }

    await client.query("COMMIT");

    if (geometry) {
      processPlan(id, uid).catch((err) =>
        console.error(`Inline plan process failed for ${id}:`, err)
      );
    }

    res.json(updateResult.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof InaccessiblePlanRouteError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("Error updating plan:", err);
    res.status(500).json({ error: "Failed to update plan" });
  } finally {
    client.release();
  }
}));

// DELETE /api/plans/:id
router.delete("/:id", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;

  const result = await db.query(
    `DELETE FROM plans WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, uid]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json({ deleted: true, id });
}));

// POST /api/plans/:id/process — trigger server-side plan processing (match
// reached destinations against plans.path). Used for explicit re-process; the
// create/update endpoints already kick processing inline when geometry changes.
router.post("/:id/process", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const plan = await db.query(`SELECT id FROM plans WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  try {
    const result = await processPlan(id, uid);
    res.json(result);
  } catch (err) {
    // A concurrent run (the inline auto-process kicked on create/update, or
    // another poll) already owns the claim — that's a benign race, not a
    // failure. Surface 409 so iOS keeps polling instead of treating it as an
    // error and retrying (which would worsen the race; cf. incident #54).
    if (err instanceof Error && err.message === "already_processing") {
      res.status(409).json({ error: "already_processing" });
      return;
    }
    console.error("Error processing plan:", err);
    res.status(500).json({ error: "Failed to process plan" });
  }
}));

// POST /api/plans/:id/party — add a party member
router.post("/:id/party", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id } = req.params;
  const { user_id: memberId } = req.body;

  if (!memberId) {
    res.status(400).json({ error: "user_id is required" });
    return;
  }

  // Verify ownership
  const plan = await db.query(
    `SELECT id FROM plans WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  await db.query(
    `INSERT INTO plan_party (plan_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, memberId]
  );
  res.status(201).json({ plan_id: id, user_id: memberId });
}));

// DELETE /api/plans/:id/party/:userId — remove a party member
router.delete("/:id/party/:userId", asyncRoute(async (req, res: Response) => {
  const uid = getUid(req);
  const { id, userId: memberId } = req.params;

  // Owner can remove anyone; members can remove themselves
  const plan = await db.query(
    `SELECT user_id FROM plans WHERE id = $1`,
    [id]
  );
  if (plan.rows.length === 0) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  if (plan.rows[0].user_id !== uid && memberId !== uid) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.query(
    `DELETE FROM plan_party WHERE plan_id = $1 AND user_id = $2`,
    [id, memberId]
  );
  res.json({ deleted: true, plan_id: id, user_id: memberId });
}));

export default router;
