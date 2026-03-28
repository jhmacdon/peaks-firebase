import { migrateDestinations } from "./migrate-destinations";
import { migrateLists } from "./migrate-lists";
import { migrateRoutes } from "./migrate-routes";
import { migrateSessions } from "./migrate-sessions";
import { migratePoints } from "./migrate-points";
import { migratePlans } from "./migrate-plans";
import db from "./db";

/**
 * Firestore → PostGIS migration runner.
 *
 * Order matters — foreign keys require:
 *   1. destinations (no deps)
 *   2. lists + list_destinations (depends on destinations)
 *   3. routes + route_destinations (depends on destinations)
 *   4. sessions + session_destinations + session_routes + session_markers (depends on destinations, routes)
 *   5. points (depends on sessions)
 *
 * Usage:
 *   npm run migrate              # run all
 *   npm run migrate:destinations  # run only destinations
 *   npm run migrate:sessions      # run only sessions (assumes destinations + routes exist)
 */
async function main() {
  const only = process.argv.find(a => a.startsWith("--only"))
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;

  console.log("=== Peaks Firestore → PostGIS Migration ===\n");

  const start = Date.now();

  try {
    if (!only || only === "destinations") {
      await migrateDestinations();
      console.log();
    }

    if (!only || only === "lists") {
      await migrateLists();
      console.log();
    }

    if (!only || only === "routes") {
      await migrateRoutes();
      console.log();
    }

    if (!only || only === "sessions") {
      await migrateSessions();
      console.log();
    }

    if (!only || only === "points") {
      await migratePoints();
      console.log();
    }

    if (!only || only === "plans") {
      await migratePlans();
      console.log();
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`=== Migration complete in ${elapsed}s ===`);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await db.end();
    process.exit(0);
  }
}

main();
