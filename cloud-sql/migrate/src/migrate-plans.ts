import { firestore } from "./firebase";
import db from "./db";
import {
  firestorePlanDate,
  firestorePlanDestinationIds,
  resolveMigratedPlanRouteId,
} from "./migrate-plan-fields";

/**
 * Migrate Firestore `plans` collection → PostGIS `plans` + join tables.
 *
 * Firestore doc fields:
 *   userId, name, description, plannedDate,
 *   goals: [destinationId, ...],
 *   routes: [routeId, ...],
 *   party: [userId, ...],
 *   createdAt, updatedAt
 */
export async function migratePlans() {
  console.log("Migrating plans...");

  const snapshot = await firestore.collection("plans").get();
  console.log(`  Found ${snapshot.size} plans in Firestore`);

  let migrated = 0;
  let skipped = 0;
  const missingDestinationLinks: string[] = [];
  const missingRouteLinks: string[] = [];
  const routeRows = await db.query<{ id: string }>("SELECT id FROM routes");
  const availableRouteIds = new Set(routeRows.rows.map((row) => row.id));

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const id = doc.id;

    if (!d.userId) {
      console.log(`  Skipping plan ${id}: no userId`);
      skipped++;
      continue;
    }

    try {
      // Parse timestamps — Firestore may store as ISO strings or Firestore Timestamps
      const parseTs = (val: any, fallback: Date): Date => {
        if (!val) return fallback;
        if (val.toDate) return val.toDate(); // Firestore Timestamp
        const d2 = new Date(val);
        return isNaN(d2.getTime()) ? fallback : d2;
      };

      const parseDateField = (val: any): string | null => {
        if (!val) return null;
        if (val.toDate) return val.toDate().toISOString();
        const d2 = new Date(val);
        return isNaN(d2.getTime()) ? null : d2.toISOString();
      };

      // Insert the plan
      await db.query(
        `INSERT INTO plans (id, user_id, name, description, date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           date = EXCLUDED.date,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          d.userId,
          d.name || "Untitled",
          d.description || null,
          parseDateField(firestorePlanDate(d)),
          parseTs(d.createdAt, doc.createTime.toDate()),
          parseTs(d.updatedAt, doc.updateTime.toDate()),
        ]
      );

      // Replace joins so rerunning the repair also removes stale links.
      await db.query("DELETE FROM plan_destinations WHERE plan_id = $1", [id]);
      const destIds = firestorePlanDestinationIds(d);
      for (let i = 0; i < destIds.length; i++) {
        const link = await db.query(
          `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
           SELECT $1, $2, $3
           WHERE EXISTS (SELECT 1 FROM destinations WHERE id = $2)
           ON CONFLICT (plan_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
          [id, destIds[i], i]
        );
        if (link.rowCount === 0) {
          missingDestinationLinks.push(`${id}:${destIds[i]}`);
        }
      }

      await db.query("DELETE FROM plan_routes WHERE plan_id = $1", [id]);
      const routeIds: string[] = d.routes || [];
      const linkedRouteIds = new Set<string>();
      for (let i = 0; i < routeIds.length; i++) {
        const resolvedRouteId = resolveMigratedPlanRouteId(routeIds[i], availableRouteIds);
        if (!resolvedRouteId) {
          missingRouteLinks.push(`${id}:${routeIds[i]}`);
          continue;
        }
        if (linkedRouteIds.has(resolvedRouteId)) continue;
        linkedRouteIds.add(resolvedRouteId);
        const link = await db.query(
          `INSERT INTO plan_routes (plan_id, route_id, ordinal)
           VALUES ($1, $2, $3)
           ON CONFLICT (plan_id, route_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
          [id, resolvedRouteId, i]
        );
        if (link.rowCount === 0) {
          missingRouteLinks.push(`${id}:${routeIds[i]}`);
        }
      }

      await db.query("DELETE FROM plan_party WHERE plan_id = $1", [id]);
      const party: string[] = d.party || [];
      for (const memberId of party) {
        await db.query(
          `INSERT INTO plan_party (plan_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, memberId]
        );
      }

      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating plan ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
  if (skipped > 0 || missingDestinationLinks.length > 0 || missingRouteLinks.length > 0) {
    const examples = [
      ...missingDestinationLinks.slice(0, 10).map((value) => `destination ${value}`),
      ...missingRouteLinks.slice(0, 10).map((value) => `route ${value}`),
    ].join(", ");
    throw new Error(
      `Migration incomplete: ${skipped} plans failed, `
      + `${missingDestinationLinks.length} destination links and `
      + `${missingRouteLinks.length} route links are missing target rows. ${examples}`
    );
  }
}
