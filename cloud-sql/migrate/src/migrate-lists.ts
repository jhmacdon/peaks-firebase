import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `lists` collection → PostGIS `lists` + `list_destinations` tables.
 *
 * Firestore doc fields:
 *   name, owner, description,
 *   destinations: [destinationId, ...] (array of IDs)
 *   meta: { [destId]: { name, elevation, l } } (lightweight dest info)
 */
export async function migrateLists() {
  console.log("Migrating lists...");

  const snapshot = await firestore.collection("lists").get();
  console.log(`  Found ${snapshot.size} lists in Firestore`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const id = doc.id;

    try {
      // Insert the list
      await db.query(
        `INSERT INTO lists (id, name, description, owner)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           updated_at = now()`,
        [id, d.name || "Unnamed", d.description || null, d.owner || "peaks"]
      );

      // Insert list_destinations join rows
      const destIds: string[] = d.destinations || [];
      for (let i = 0; i < destIds.length; i++) {
        await db.query(
          `INSERT INTO list_destinations (list_id, destination_id, ordinal)
           VALUES ($1, $2, $3)
           ON CONFLICT (list_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
          [id, destIds[i], i]
        );
      }

      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating list ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
}
