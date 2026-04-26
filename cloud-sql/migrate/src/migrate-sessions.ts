import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `sessions` collection → PostGIS `tracking_sessions` +
 * `session_destinations` + `session_routes` + `session_markers` tables.
 *
 * Firestore doc fields:
 *   userId, name, segCounter, lastUpdated, source, externalId, activityType,
 *   overview: { distance, pace, totalTime, gain, highPoint, ascentTime, descentTime, stillTimeTotal, startDate, endDate },
 *   status: { ended, public, photosSynced, destinationsSynced },
 *   destinationsReached: [destId, ...],
 *   destinationGoals: [destId, ...],
 *   routes: [routeId, ...],
 *   markers: [{ lat, lng, name, created, createdBy, image }, ...],
 *   healthData: { calories: [...], heartRates: [...] },
 *   deleted: boolean
 */
export async function migrateSessions() {
  console.log("Migrating sessions...");

  const snapshot = await firestore.collection("sessions").get();
  console.log(`  Found ${snapshot.size} sessions in Firestore`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const id = doc.id;

    // Skip deleted sessions
    if (d.deleted === true) {
      skipped++;
      continue;
    }

    try {
      const overview = d.overview || {};
      const status = d.status || {};

      let startTime = toDate(overview.startDate);
      let endTime = toDate(overview.endDate);

      // Fallback: derive start/end from the session's tracking points.
      // Older / aborted Firestore sessions can be missing overview.startDate
      // (recording started but no overview written) yet still have a populated
      // points doc. min/max of point.time is the authoritative window.
      // Without this, those sessions hit the NOT NULL constraint on
      // tracking_sessions.start_time and get silently dropped.
      if (!startTime || !endTime) {
        const ptsDoc = await firestore.collection("points").doc(id).get();
        if (ptsDoc.exists) {
          const pts: any[] = ptsDoc.data()?.points || [];
          const times = pts
            .map((p) => p?.time)
            .filter((t): t is number => typeof t === "number" && t > 0);
          if (times.length > 0) {
            if (!startTime) startTime = new Date(Math.min(...times) * 1000);
            if (!endTime) endTime = new Date(Math.max(...times) * 1000);
          }
        }
      }

      // Last-resort: lastUpdated as start_time so we don't silently drop a
      // session that has no overview, no points, but does have a timestamp.
      if (!startTime) startTime = toDate(d.lastUpdated);
      if (!startTime) {
        console.warn(`  Skipping session ${id} — no startDate, no points, no lastUpdated`);
        skipped++;
        continue;
      }

      const lastUpdated = toDate(d.lastUpdated) || endTime || startTime || new Date();
      const hasDerivedMatches =
        status.destinationsSynced === true ||
        (d.destinationsReached?.length ?? 0) > 0 ||
        (d.destinationGoals?.length ?? 0) > 0 ||
        (d.routes?.length ?? 0) > 0;
      const processingState = hasDerivedMatches
        ? "completed"
        : status.ended
          ? "pending"
          : "idle";
      const processedAt = processingState === "completed" ? lastUpdated : null;

      if (!d.userId) {
        console.warn(`  Skipping session ${id} — no userId`);
        skipped++;
        continue;
      }

      // Map activity type
      const activityType = mapActivityType(d.activityType);

      await db.query(
        `INSERT INTO tracking_sessions (
          id, user_id, name, start_time, end_time,
          distance, total_time, pace, gain, highest_point,
          ascent_time, descent_time, still_time,
          activity_type, source, external_id,
          health_data, ended, is_public,
          processed_at, processing_state,
          created_at, updated_at, server_updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13,
          $14::activity_type, $15, $16,
          $17::jsonb, $18, $19,
          $20, $21,
          $22, $23, $24
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          distance = EXCLUDED.distance,
          total_time = EXCLUDED.total_time,
          gain = EXCLUDED.gain,
          highest_point = EXCLUDED.highest_point,
          processed_at = EXCLUDED.processed_at,
          processing_state = EXCLUDED.processing_state,
          updated_at = EXCLUDED.updated_at,
          server_updated_at = EXCLUDED.server_updated_at`,
        [
          id,
          d.userId,
          d.name || null,
          startTime,
          endTime,
          overview.distance ?? null,
          overview.totalTime ?? null,
          overview.pace ?? null,
          overview.gain ?? null,
          overview.highPoint ?? null,
          overview.ascentTime ?? null,
          overview.descentTime ?? null,
          overview.stillTimeTotal ?? null,
          activityType,
          d.source || null,
          d.externalId || null,
          d.healthData ? JSON.stringify(d.healthData) : null,
          status.ended ?? false,
          status.public ?? false,
          processedAt,
          processingState,
          startTime || lastUpdated,
          lastUpdated,
          lastUpdated,
        ]
      );

      // session_destinations: reached
      const reached: string[] = d.destinationsReached || [];
      for (const destId of reached) {
        try {
          await db.query(
            `INSERT INTO session_destinations (session_id, destination_id, relation)
             VALUES ($1, $2, 'reached')
             ON CONFLICT (session_id, destination_id) DO UPDATE SET relation = 'reached'`,
            [id, destId]
          );
        } catch { /* FK violation — dest may not exist */ }
      }

      // session_destinations: goal
      const goals: string[] = d.destinationGoals || [];
      for (const destId of goals) {
        if (reached.includes(destId)) continue; // already inserted as reached
        try {
          await db.query(
            `INSERT INTO session_destinations (session_id, destination_id, relation)
             VALUES ($1, $2, 'goal')
             ON CONFLICT (session_id, destination_id) DO NOTHING`,
            [id, destId]
          );
        } catch { /* FK violation */ }
      }

      // session_routes
      const routeIds: string[] = d.routes || [];
      for (const routeId of routeIds) {
        try {
          await db.query(
            `INSERT INTO session_routes (session_id, route_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [id, routeId]
          );
        } catch { /* FK violation */ }
      }

      // session_markers
      const markers: any[] = d.markers || [];
      for (const m of markers) {
        if (m.lat == null || m.lng == null) continue;
        const markerCreated = toDate(m.created) || new Date();
        try {
          await db.query(
            `INSERT INTO session_markers (session_id, location, name, image, created_by, created_at)
             VALUES ($1, ST_MakePoint($2, $3, 0)::geography, $4, $5, $6, $7)`,
            [
              id,
              m.lng, m.lat,
              m.name || null,
              m.image || null,
              m.createdBy || null,
              markerCreated,
            ]
          );
        } catch (err: any) {
          console.warn(`  Warning: marker insert failed for session ${id}: ${err.message}`);
        }
      }

      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating session ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
}

function toDate(val: any): Date | null {
  if (!val) return null;
  if (val.toDate) return val.toDate(); // Firestore Timestamp
  if (val instanceof Date) return val;
  if (typeof val === "number") return new Date(val * 1000); // Unix seconds
  if (typeof val === "string") return new Date(val);
  return null;
}

function mapActivityType(type: string | undefined): string | null {
  const mapping: Record<string, string> = {
    "outdoor-trek": "outdoor-trek",
    "hiking": "outdoor-trek",
    "outdoor-moto": "outdoor-moto",
    "ski": "ski",
    "skiing": "ski",
  };
  return type ? mapping[type] || null : null;
}
