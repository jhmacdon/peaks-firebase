import { firestore } from "./firebase";
import db from "./db";
import { reconcileFirestoreList } from "./migrate-list-record";

/**
 * Migrate Firestore `lists` collection → PostGIS `lists` + `list_destinations` tables.
 *
 * Firestore doc fields:
 *   name, owner, description, completionTarget?,
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
      await reconcileFirestoreList(db, id, d);
      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating list ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
  if (skipped > 0) {
    throw new Error(`Failed to migrate ${skipped} Firestore list${skipped === 1 ? "" : "s"}`);
  }
}
