import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `routes` collection → PostGIS `routes` + `route_destinations` tables.
 *
 * Firestore doc fields:
 *   name, owner, polyline6, geohashes[], elevationString,
 *   stats: { distance, gain, gainLoss },
 *   completion: "none" | "straight" | "reverse",
 *   ext: { wta: "...", usfs: "..." },
 *   destinations: [destinationId, ...]
 *
 * Note: polyline6 encodes lat/lng only (no elevation).
 * We store the polyline6 as-is for client use and decode it to build a
 * LineStringZ if elevation data is available (future enhancement).
 * For now, path is NULL — the polyline6 column is the source of truth for route geometry.
 */
export async function migrateRoutes() {
  console.log("Migrating routes...");

  const snapshot = await firestore.collection("routes").get();
  console.log(`  Found ${snapshot.size} routes in Firestore`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const id = doc.id;

    try {
      // Build external_links JSONB from ext field
      const extLinks: any[] = [];
      if (d.ext?.wta) extLinks.push({ type: "wta", id: d.ext.wta });
      if (d.ext?.usfs) extLinks.push({ type: "usfs", id: d.ext.usfs });

      const stats = d.stats || {};
      const geohashes = d.geohashes || [];
      const completion = mapCompletion(d.completion);

      // Decode polyline6 to build LineStringZ (2D — no elevation yet)
      const path = d.polyline6 ? decodePolyline6ToWKT(d.polyline6) : null;

      await db.query(
        `INSERT INTO routes (
          id, name, path, polyline6, geohashes, owner,
          distance, gain, gain_loss, elevation_string,
          external_links, completion
        ) VALUES (
          $1, $2, ${path ? `ST_GeogFromText($3)` : `$3::geography`}, $4, $5, $6,
          $7, $8, $9, $10,
          $11::jsonb, $12::completion_mode
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          path = EXCLUDED.path,
          polyline6 = EXCLUDED.polyline6,
          distance = EXCLUDED.distance,
          gain = EXCLUDED.gain,
          gain_loss = EXCLUDED.gain_loss,
          updated_at = now()`,
        [
          id,
          d.name || null,
          path, // WKT string or null
          d.polyline6 || null,
          geohashes,
          d.owner || "peaks",
          stats.distance ?? null,
          stats.gain ?? null,
          stats.gainLoss ?? null,
          d.elevationString || null,
          extLinks.length > 0 ? JSON.stringify(extLinks) : null,
          completion,
        ]
      );

      // Insert route_destinations join rows
      const destIds: string[] = d.destinations || [];
      for (let i = 0; i < destIds.length; i++) {
        try {
          await db.query(
            `INSERT INTO route_destinations (route_id, destination_id, ordinal)
             VALUES ($1, $2, $3)
             ON CONFLICT (route_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
            [id, destIds[i], i]
          );
        } catch {
          // Destination may not exist yet — skip FK violation
        }
      }

      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating route ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
}

function mapCompletion(val: string | undefined): string {
  if (val === "straight" || val === "reverse") return val;
  return "none";
}

/**
 * Decode a Google Polyline Algorithm string (precision 1e6) to WKT LINESTRING.
 * Since Firestore routes don't store elevation per vertex, this produces a 2D line.
 * We use LINESTRING (not LINESTRINGZ) — path column is geography(LineStringZ)
 * so we produce LINESTRING Z with Z=0 for now.
 */
function decodePolyline6ToWKT(encoded: string): string | null {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e6, lat / 1e6]); // WKT is lng lat order
  }

  if (coords.length < 2) return null;

  // LINESTRING Z with Z=0 (no elevation data in polyline)
  const points = coords.map(([x, y]) => `${x} ${y} 0`).join(", ");
  return `SRID=4326;LINESTRING Z(${points})`;
}
