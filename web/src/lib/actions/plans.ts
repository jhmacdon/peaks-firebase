"use server";

import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";
import { FieldValue } from "firebase-admin/firestore";
import db from "../db";
import {
  orderByIds,
  withFallback,
  type PlanDestinationRow,
  type PlanProcessing,
  type PlanReachedDestinationRow,
  type PlanRouteRow,
} from "../plan-detail";

export interface Plan {
  id: string;
  userId: string;
  name: string;
  description: string;
  destinations: string[];
  routes: string[];
  party: string[];
  date: string | null;
  createdAt: string;
  updatedAt: string;
}

function docToPlan(id: string, data: FirebaseFirestore.DocumentData): Plan {
  return {
    id,
    userId: data.userId ?? "",
    name: data.name ?? "",
    description: data.description ?? "",
    destinations: data.destinations ?? [],
    routes: data.routes ?? [],
    party: data.party ?? [],
    date: data.date ?? null,
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

/**
 * Sync a plan and its join tables to Cloud SQL.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
async function syncPlanToSql(
  planId: string,
  userId: string,
  fields: {
    name: string;
    description?: string;
    date?: string | null;
    destinations?: string[];
    routes?: string[];
  }
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO plans (id, user_id, name, description, date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         date = EXCLUDED.date`,
      [planId, userId, fields.name, fields.description || null, fields.date || null]
    );

    if (fields.destinations) {
      await client.query(`DELETE FROM plan_destinations WHERE plan_id = $1`, [planId]);
      for (let i = 0; i < fields.destinations.length; i++) {
        await client.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [planId, fields.destinations[i], i]
        );
      }
    }

    if (fields.routes) {
      await client.query(`DELETE FROM plan_routes WHERE plan_id = $1`, [planId]);
      for (let i = 0; i < fields.routes.length; i++) {
        await client.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [planId, fields.routes[i], i]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Cloud SQL plan sync failed:", err);
  } finally {
    client.release();
  }
}

/**
 * Get all plans where the user is the owner or a party member.
 */
export async function getUserPlans(token: string): Promise<Plan[]> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");
  const uid = auth.uid;

  // Firestore does not support OR across different fields in one query,
  // so run two queries and merge results.
  const [ownerSnap, partySnap] = await Promise.all([
    adminDb.collection("plans").where("userId", "==", uid).get(),
    adminDb.collection("plans").where("party", "array-contains", uid).get(),
  ]);

  const plansMap = new Map<string, Plan>();

  for (const doc of ownerSnap.docs) {
    plansMap.set(doc.id, docToPlan(doc.id, doc.data()));
  }
  for (const doc of partySnap.docs) {
    if (!plansMap.has(doc.id)) {
      plansMap.set(doc.id, docToPlan(doc.id, doc.data()));
    }
  }

  const plans = Array.from(plansMap.values());
  plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return plans;
}

/**
 * Get a single plan by ID. Verifies the caller is the owner or a party member.
 */
export async function getPlan(
  token: string,
  planId: string
): Promise<Plan | null> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");
  const uid = auth.uid;

  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  if (data.userId !== uid && !(data.party ?? []).includes(uid)) {
    return null;
  }

  return docToPlan(doc.id, data);
}

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays —
 * same fallback used in lib/actions/destinations.ts and public-sessions.ts. */
function parseFeatures(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.startsWith("{")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

interface DestinationQueryRow {
  id: string;
  name: string | null;
  elevation: number | null;
  features: unknown;
  lat: number | null;
  lng: number | null;
}

interface ReachedDestinationQueryRow extends DestinationQueryRow {
  ordinal: number;
}

interface RouteQueryRow {
  id: string;
  name: string | null;
  polyline6: string | null;
  distance: number | null;
  gain: number | null;
  status: string;
}

interface ProcessingQueryRow {
  distance: number | null;
  gain: number | null;
  processing_state: string;
  path: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}

function shapeDestinationRow(row: DestinationQueryRow): PlanDestinationRow {
  return {
    id: String(row.id),
    name: row.name ?? null,
    elevation: row.elevation != null ? Number(row.elevation) : null,
    features: parseFeatures(row.features),
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
  };
}

function shapeRouteRow(row: RouteQueryRow): PlanRouteRow {
  return {
    id: String(row.id),
    name: row.name ?? null,
    polyline6: row.polyline6 ?? null,
    distance: row.distance != null ? Number(row.distance) : null,
    gain: row.gain != null ? Number(row.gain) : null,
    status: row.status,
  };
}

export interface PlanBundle {
  plan: Plan;
  destinations: PlanDestinationRow[];
  routes: PlanRouteRow[];
  reachedDestinations: PlanReachedDestinationRow[];
  processing: PlanProcessing | null;
}

/**
 * Everything the plan detail page needs, in one call: the Firestore plan
 * (source of truth for identity, ownership, and the chosen destination/route
 * id lists) plus one batched Cloud SQL query per data type for their catalog
 * details — replacing the page's previous N getDestination()/getRoute()
 * server-action round trips (one per destination, one per route).
 *
 * The processed fields (`processing`, `reachedDestinations`) come from the
 * Cloud SQL plan-processing pipeline (`processPlan`), which only runs
 * against client-supplied path geometry — today that's iOS's GPX-import
 * flow (see schema.sql's comment on `plans.path`). A plan built or edited
 * purely on the web never supplies a path, so these come back null/empty
 * for the large majority of plans in production (measured: 8 of 1,214,
 * 2026-08-20) — callers must treat them as "not processed," never as "still
 * loading."
 *
 * Destination/route identity and ordering always come from the Firestore
 * plan (reliable — every save writes it synchronously); their catalog
 * details come from Cloud SQL's `destinations`/`routes` tables, which are
 * the live catalog itself, not the fire-and-forget plan-processing mirror.
 *
 * The four Cloud SQL queries below are independent: `getPlan` (Firestore
 * auth + identity) is the only fatal step — each SQL query falls back to
 * an empty result via `withFallback` on its own failure, logged
 * server-side, rather than letting one bad query (most likely the rarer
 * processing/reached-destinations ones) take down the reliable
 * Firestore-backed core along with it.
 */
export async function getPlanBundle(
  token: string,
  planId: string
): Promise<PlanBundle | null> {
  const plan = await getPlan(token, planId);
  if (!plan) return null;

  // Every query is normalized to Promise<Row[]> (via .then((r) => r.rows))
  // BEFORE withFallback, so its fallback value is a plain, uniform T[] (`[]`)
  // rather than a pg QueryResult<T> — QueryResult carries required
  // metadata (command/rowCount/oid/fields) that a literal fallback can't
  // supply, and only some of these four queries had a pre-existing ternary
  // branch that happened to produce a compatible shape.
  const [destinationRows, routeRows, reachedRows, processingRows] = await Promise.all([
    withFallback(
      (plan.destinations.length > 0
        ? db.query<DestinationQueryRow>(
            `SELECT id, name, elevation, features,
                    ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
             FROM destinations
             WHERE id = ANY($1::text[])`,
            [plan.destinations]
          )
        : Promise.resolve({ rows: [] as DestinationQueryRow[] })
      ).then((result) => result.rows),
      [] as DestinationQueryRow[],
      (error) => console.error(`getPlanBundle(${planId}): destinations query failed`, error)
    ),
    withFallback(
      (plan.routes.length > 0
        ? db.query<RouteQueryRow>(
            `SELECT id, name, polyline6, distance, gain, status
             FROM routes
             WHERE id = ANY($1::text[]) AND status IN ('active', 'superseded')`,
            [plan.routes]
          )
        : Promise.resolve({ rows: [] as RouteQueryRow[] })
      ).then((result) => result.rows),
      [] as RouteQueryRow[],
      (error) => console.error(`getPlanBundle(${planId}): routes query failed`, error)
    ),
    withFallback(
      db
        .query<ReachedDestinationQueryRow>(
          `SELECT d.id, d.name, d.elevation, d.features,
                  ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
                  prd.ordinal
           FROM destinations d
           JOIN plan_reached_destinations prd ON prd.destination_id = d.id
           WHERE prd.plan_id = $1
           ORDER BY prd.ordinal`,
          [planId]
        )
        .then((result) => result.rows),
      [] as ReachedDestinationQueryRow[],
      (error) => console.error(`getPlanBundle(${planId}): reached-destinations query failed`, error)
    ),
    withFallback(
      db
        .query<ProcessingQueryRow>(
          `SELECT distance, gain, processing_state,
                  CASE WHEN path IS NOT NULL THEN ST_AsGeoJSON(path)::json END AS path
           FROM plans
           WHERE id = $1`,
          [planId]
        )
        .then((result) => result.rows),
      [] as ProcessingQueryRow[],
      (error) => console.error(`getPlanBundle(${planId}): processing query failed`, error)
    ),
  ]);

  const processingRow = processingRows[0];

  return {
    plan,
    destinations: orderByIds(destinationRows.map(shapeDestinationRow), plan.destinations),
    routes: orderByIds(routeRows.map(shapeRouteRow), plan.routes),
    reachedDestinations: reachedRows.map((row) => ({
      ...shapeDestinationRow(row),
      ordinal: Number(row.ordinal),
    })),
    processing: processingRow
      ? {
          distance: processingRow.distance != null ? Number(processingRow.distance) : null,
          gain: processingRow.gain != null ? Number(processingRow.gain) : null,
          processingState: processingRow.processing_state,
          path: processingRow.path ?? null,
        }
      : null,
  };
}

/**
 * Create a new plan.
 */
export async function createPlan(
  token: string,
  data: {
    name: string;
    description?: string;
    destinations?: string[];
    routes?: string[];
    date?: string;
  }
): Promise<{ id: string }> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");

  const now = new Date().toISOString();
  const ref = adminDb.collection("plans").doc();

  await ref.set({
    userId: auth.uid,
    name: data.name,
    description: data.description ?? "",
    destinations: data.destinations ?? [],
    routes: data.routes ?? [],
    party: [],
    date: data.date ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // Dual-write to Cloud SQL
  syncPlanToSql(ref.id, auth.uid, {
    name: data.name,
    description: data.description,
    date: data.date,
    destinations: data.destinations,
    routes: data.routes,
  }).catch(() => {});

  return { id: ref.id };
}

/**
 * Update an existing plan. Only the owner can update.
 */
export async function updatePlan(
  token: string,
  planId: string,
  updates: {
    name?: string;
    description?: string;
    destinations?: string[];
    routes?: string[];
    date?: string;
  }
): Promise<void> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");

  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const data = doc.data()!;
  if (data.userId !== auth.uid) throw new Error("Forbidden");

  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.destinations !== undefined) patch.destinations = updates.destinations;
  if (updates.routes !== undefined) patch.routes = updates.routes;
  if (updates.date !== undefined) patch.date = updates.date;

  await adminDb.collection("plans").doc(planId).update(patch);

  // Dual-write to Cloud SQL — merge current data with updates
  syncPlanToSql(planId, auth.uid, {
    name: updates.name ?? data.name ?? "",
    description: updates.description ?? data.description,
    date: updates.date ?? data.date,
    destinations: updates.destinations ?? data.destinations,
    routes: updates.routes ?? data.routes,
  }).catch(() => {});
}

/**
 * Delete a plan. Only the owner can delete.
 */
export async function deletePlan(
  token: string,
  planId: string
): Promise<void> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");

  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const data = doc.data()!;
  if (data.userId !== auth.uid) throw new Error("Forbidden");

  await adminDb.collection("plans").doc(planId).delete();

  // Dual-write to Cloud SQL (CASCADE deletes join rows)
  db.query(`DELETE FROM plans WHERE id = $1`, [planId]).catch((err) =>
    console.error("Cloud SQL plan delete failed:", err)
  );
}

/**
 * Add a friend to the plan's party. Only the owner can invite.
 */
export async function inviteToPlan(
  token: string,
  planId: string,
  friendId: string
): Promise<void> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");

  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const data = doc.data()!;
  if (data.userId !== auth.uid) throw new Error("Forbidden");

  await adminDb
    .collection("plans")
    .doc(planId)
    .update({
      party: FieldValue.arrayUnion(friendId),
      updatedAt: new Date().toISOString(),
    });

  // Dual-write to Cloud SQL
  db.query(
    `INSERT INTO plan_party (plan_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [planId, friendId]
  ).catch((err) => console.error("Cloud SQL party sync failed:", err));
}
