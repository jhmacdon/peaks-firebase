"use server";

import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";
import { FieldValue } from "firebase-admin/firestore";
import db from "../db";

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
