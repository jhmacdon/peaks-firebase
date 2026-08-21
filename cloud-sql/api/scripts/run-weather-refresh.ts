/**
 * Manual/one-off runner for the destination weather refresh — the same work
 * Cloud Scheduler triggers via POST /internal/weather-refresh (see
 * src/index.ts), runnable locally against prod for a spot check or an
 * out-of-band refresh between scheduled runs.
 *
 * Run through the Cloud SQL proxy, with a service-account JSON for Firestore
 * (GOOGLE_APPLICATION_CREDENTIALS — admin.initializeApp() picks it up):
 *
 *   DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=peaks DB_USER=peaks-api \
 *   DB_PASS=... GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     npx tsx scripts/run-weather-refresh.ts
 */

import admin from "firebase-admin";
import pool from "../src/db";
import { refreshDestinationWeather } from "../src/weather-refresh";

if (!admin.apps.length) {
  admin.initializeApp();
}

async function main(): Promise<void> {
  try {
    const counts = await refreshDestinationWeather(pool, admin.firestore());
    console.log(
      `weather refresh: ${counts.refreshed}/${counts.total} destinations refreshed, ${counts.skipped} skipped`
    );
  } finally {
    // Neither of these keeps the event loop alive once resolved, but the pg
    // Pool's open sockets and firebase-admin's gRPC channels both can while
    // idle — without this the script hangs after a successful run instead
    // of exiting on its own. Runs on the failure path too, so a refresh
    // error still reaches main().catch() below with everything closed.
    await pool.end();
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error("Weather refresh failed:", error);
  process.exit(1);
});
