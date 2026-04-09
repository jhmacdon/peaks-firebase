import { firestore } from "./firebase";
import db from "./db";

/**
 * Backfill historical offsets from Firestore into PostGIS destinations.
 *
 * Firestore has two data sources that weren't captured in the initial migration:
 *
 * 1. `destinations/{id}.stats` — { sessionCount, successCount }
 *    Incremented by Cloud Functions whenever a session ends. Includes both
 *    reached and goal destinations. This count may exceed what's in the
 *    PostGIS session_destinations table (backloaded data, FK-skipped sessions, etc.).
 *
 * 2. `averages` collection — separate docs per destination with:
 *    { destinationId, months: {jan: N, ...}, weekdays: {mo: N, ...}, lastUpdated }
 *    The original migration read `d.averages` from the destination doc itself,
 *    but the real data lives in this separate collection.
 *
 * This script computes the delta between Firestore counts and PostGIS computed
 * counts, and stores it as offset columns. It also copies the Firestore averages
 * collection data into averages_offset.
 *
 * Usage:
 *   npx ts-node src/backfill-offsets.ts
 *   npx ts-node src/backfill-offsets.ts --dry-run
 */

async function backfillOffsets() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== Backfill Firestore offsets${dryRun ? " (DRY RUN)" : ""} ===\n`);

  // Step 1: Load Firestore destination stats
  console.log("Loading Firestore destination stats...");
  const destSnapshot = await firestore.collection("destinations").get();
  console.log(`  Found ${destSnapshot.size} destinations in Firestore`);

  const firestoreStats: Map<string, { sessionCount: number; successCount: number }> = new Map();
  for (const doc of destSnapshot.docs) {
    const data = doc.data();
    const stats = data.stats;
    if (stats && (stats.sessionCount || stats.successCount)) {
      firestoreStats.set(doc.id, {
        sessionCount: stats.sessionCount || 0,
        successCount: stats.successCount || 0,
      });
    }
  }
  console.log(`  ${firestoreStats.size} destinations have stats`);

  // Step 2: Load Firestore averages collection
  console.log("Loading Firestore averages collection...");
  const avgSnapshot = await firestore.collection("averages").get();
  console.log(`  Found ${avgSnapshot.size} averages docs`);

  const firestoreAverages: Map<string, { months: Record<string, number>; days: Record<string, number> }> = new Map();
  for (const doc of avgSnapshot.docs) {
    const data = doc.data();
    const destId = data.destinationId;
    if (!destId) continue;

    const months: Record<string, number> = {};
    const days: Record<string, number> = {};

    if (data.months && typeof data.months === "object") {
      for (const [k, v] of Object.entries(data.months)) {
        if (typeof v === "number" && v > 0) months[k] = v;
      }
    }
    // Firestore uses "weekdays", PostGIS uses "days"
    if (data.weekdays && typeof data.weekdays === "object") {
      for (const [k, v] of Object.entries(data.weekdays)) {
        if (typeof v === "number" && v > 0) days[k] = v;
      }
    }

    if (Object.keys(months).length > 0 || Object.keys(days).length > 0) {
      firestoreAverages.set(destId, { months, days });
    }
  }
  console.log(`  ${firestoreAverages.size} destinations have averages`);

  // Step 3: Load current PostGIS computed counts
  console.log("Loading PostGIS computed counts...");
  const pgResult = await db.query(
    `SELECT d.id,
            COALESCE(stats.session_count, 0)::int AS session_count,
            COALESCE(stats.success_count, 0)::int AS success_count
     FROM destinations d
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS session_count,
              COUNT(*) FILTER (WHERE sd.relation = 'reached') AS success_count
       FROM session_destinations sd WHERE sd.destination_id = d.id
     ) stats ON true`
  );

  const pgCounts: Map<string, { sessionCount: number; successCount: number }> = new Map();
  for (const row of pgResult.rows) {
    pgCounts.set(row.id, {
      sessionCount: parseInt(row.session_count) || 0,
      successCount: parseInt(row.success_count) || 0,
    });
  }
  console.log(`  ${pgCounts.size} destinations in PostGIS`);

  // Step 4: Compute and apply offsets
  console.log("\nComputing offsets...");
  let countUpdated = 0;
  let avgUpdated = 0;
  let skipped = 0;

  // Collect all destination IDs that need updates
  const allDestIds = new Set([...firestoreStats.keys(), ...firestoreAverages.keys()]);

  for (const destId of allDestIds) {
    const pgCount = pgCounts.get(destId);
    if (!pgCount) {
      // Destination doesn't exist in PostGIS — skip
      skipped++;
      continue;
    }

    const fsStats = firestoreStats.get(destId);
    const fsAvg = firestoreAverages.get(destId);

    // Compute count offsets: Firestore total minus PostGIS computed count
    // This captures sessions that contributed to the Firestore count but aren't
    // in session_destinations (backloaded data, FK failures, etc.)
    let sessionOffset = 0;
    let successOffset = 0;
    if (fsStats) {
      sessionOffset = Math.max(0, fsStats.sessionCount - pgCount.sessionCount);
      successOffset = Math.max(0, fsStats.successCount - pgCount.successCount);
    }

    const hasCountOffset = sessionOffset > 0 || successOffset > 0;
    const hasAvgOffset = !!fsAvg;

    if (!hasCountOffset && !hasAvgOffset) continue;

    if (dryRun) {
      if (hasCountOffset) {
        console.log(`  [DRY] ${destId}: session_count_offset=${sessionOffset}, success_count_offset=${successOffset} (firestore=${fsStats!.sessionCount}/${fsStats!.successCount}, pg=${pgCount.sessionCount}/${pgCount.successCount})`);
      }
      if (hasAvgOffset) {
        const totalMonths = Object.values(fsAvg!.months).reduce((a, b) => a + b, 0);
        console.log(`  [DRY] ${destId}: averages_offset with ${totalMonths} total month entries`);
      }
    } else {
      await db.query(
        `UPDATE destinations
         SET session_count_offset = $2,
             success_count_offset = $3,
             averages_offset = $4::jsonb
         WHERE id = $1`,
        [
          destId,
          sessionOffset,
          successOffset,
          hasAvgOffset ? JSON.stringify(fsAvg) : null,
        ]
      );
    }

    if (hasCountOffset) countUpdated++;
    if (hasAvgOffset) avgUpdated++;
  }

  console.log(`\nResults:`);
  console.log(`  Count offsets applied: ${countUpdated}`);
  console.log(`  Averages offsets applied: ${avgUpdated}`);
  console.log(`  Skipped (not in PostGIS): ${skipped}`);
}

backfillOffsets()
  .then(() => {
    console.log("\n=== Backfill complete ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
