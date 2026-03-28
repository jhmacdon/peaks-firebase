import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `plans` collection → PostGIS `plans` + join tables.
 *
 * Firestore doc fields:
 *   userId, name, description, date,
 *   destinations: [destinationId, ...],
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
      const parseTs = (val: any): Date => {
        if (!val) return new Date();
        if (val.toDate) return val.toDate(); // Firestore Timestamp
        const d2 = new Date(val);
        return isNaN(d2.getTime()) ? new Date() : d2;
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
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           date = EXCLUDED.date,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          d.userId,
          d.name || "Untitled",
          d.description || null,
          parseDateField(d.date),
          parseTs(d.createdAt),
          parseTs(d.updatedAt),
        ]
      );

      // Insert plan_destinations
      const destIds: string[] = d.destinations || [];
      for (let i = 0; i < destIds.length; i++) {
        try {
          await db.query(
            `INSERT INTO plan_destinations (plan_id, destination_id, ordinal)
             VALUES ($1, $2, $3)
             ON CONFLICT (plan_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
            [id, destIds[i], i]
          );
        } catch (err: any) {
          // FK violation if destination doesn't exist in PostGIS yet — skip
          if (err.code === "23503") continue;
          throw err;
        }
      }

      // Insert plan_routes
      const routeIds: string[] = d.routes || [];
      for (let i = 0; i < routeIds.length; i++) {
        try {
          await db.query(
            `INSERT INTO plan_routes (plan_id, route_id, ordinal)
             VALUES ($1, $2, $3)
             ON CONFLICT (plan_id, route_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
            [id, routeIds[i], i]
          );
        } catch (err: any) {
          if (err.code === "23503") continue;
          throw err;
        }
      }

      // Insert plan_party
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
}
