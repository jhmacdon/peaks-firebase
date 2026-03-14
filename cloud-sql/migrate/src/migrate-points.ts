import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `points` collection → PostGIS `tracking_points` table.
 *
 * Firestore stores ALL points for a session in a single document:
 *   Document ID = session ID
 *   points: [{ time, lat, lng, elevation, speed, azimuth, hdop, speedAccuracy, segmentNumber }, ...]
 *
 * PostGIS stores each point as a row with composite PK (session_id, time).
 *
 * This is the largest migration — sessions can have thousands of points.
 * We batch inserts for performance.
 */
export async function migratePoints() {
  console.log("Migrating tracking points...");

  const snapshot = await firestore.collection("points").get();
  console.log(`  Found ${snapshot.size} point documents in Firestore`);

  let totalPoints = 0;
  let docsProcessed = 0;
  let docsSkipped = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const sessionId = d.sessionId || doc.id;
    const points: any[] = d.points || [];

    if (points.length === 0) {
      docsSkipped++;
      continue;
    }

    // Verify the session exists in PostGIS
    const sessionCheck = await db.query(
      `SELECT id FROM tracking_sessions WHERE id = $1`,
      [sessionId]
    );
    if (sessionCheck.rows.length === 0) {
      console.warn(`  Skipping points for session ${sessionId} — session not found in PostGIS`);
      docsSkipped++;
      continue;
    }

    // Batch insert points (chunks of 500 to stay under query size limits)
    const chunkSize = 500;
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);

      // Build a multi-row INSERT
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const p of chunk) {
        if (p.lat == null || p.lng == null || p.time == null) continue;

        const elevation = p.elevation ?? 0;

        placeholders.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, ` +
          `ST_MakePoint($${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})::geography, ` +
          `$${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11})`
        );

        values.push(
          sessionId,         // session_id
          p.time,            // time (ms)
          p.segmentNumber ?? 0, // segment_number
          p.lng,             // ST_MakePoint X
          p.lat,             // ST_MakePoint Y
          elevation,         // ST_MakePoint Z
          elevation,         // denormalized elevation
          p.speed ?? null,
          p.azimuth ?? null,
          p.hdop ?? null,
          p.speedAccuracy ?? null,
          p.geoHash ?? null,
        );
        paramIdx += 12;
      }

      if (placeholders.length === 0) continue;

      try {
        await db.query(
          `INSERT INTO tracking_points
           (session_id, time, segment_number, location, elevation, speed, azimuth, hdop, speed_accuracy, geohash)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (session_id, time) DO NOTHING`,
          values
        );
        totalPoints += placeholders.length;
      } catch (err: any) {
        console.error(`  Error inserting points for session ${sessionId} chunk ${i}: ${err.message}`);
      }
    }

    docsProcessed++;
    if (docsProcessed % 50 === 0) {
      console.log(`  Progress: ${docsProcessed}/${snapshot.size} sessions, ${totalPoints} points`);
    }
  }

  console.log(`  Done: ${docsProcessed} sessions processed, ${totalPoints} points migrated, ${docsSkipped} skipped`);
}
