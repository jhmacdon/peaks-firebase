import { firestore } from "./firebase";
import db from "./db";

/**
 * Migrate Firestore `destinations` collection → PostGIS `destinations` table.
 *
 * Firestore doc fields:
 *   name, elevation, prominence, type, activities[], features[],
 *   l: [lat, lng], g (geohash), searchName,
 *   details: { location: { countryCode, stateCode }, heroImage, heroImageAttribution, heroImageAttributionURL },
 *   bounds: { minLat, maxLat, minLng, maxLng },
 *   recency, explicitlySaved (not stored in Firestore but we handle if present)
 */
export async function migrateDestinations() {
  console.log("Migrating destinations...");

  const snapshot = await firestore.collection("destinations").get();
  console.log(`  Found ${snapshot.size} destinations in Firestore`);

  let migrated = 0;
  let skipped = 0;

  // Process in batches to avoid overwhelming the connection
  const batchSize = 100;
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);

    const values: any[][] = [];
    for (const doc of batch) {
      const d = doc.data();
      const id = doc.id;

      // Location: Firestore stores as l: [lat, lng]
      const lat = d.l?.[0];
      const lng = d.l?.[1];
      if (lat == null || lng == null) {
        console.warn(`  Skipping ${id} — no location`);
        skipped++;
        continue;
      }

      const elevation = d.elevation ?? null;
      const details = d.details || {};
      const location = details.location || {};
      const bounds = d.bounds || {};

      // Map Firestore activity/feature strings to PostGIS enum values
      const activities = mapActivities(d.activities || []);
      const features = mapFeatures(d.features || []);

      values.push([
        id,
        d.name || null,
        (d.searchName || d.name || "").toLowerCase(),
        elevation,
        d.prominence ?? null,
        lng, lat, elevation ?? 0, // for ST_MakePoint(lng, lat, elev)
        d.g || null,
        mapDestinationType(d.type),
        `{${activities.join(",")}}`,
        `{${features.join(",")}}`,
        d.owner || "peaks",
        bounds.minLat ?? null,
        bounds.maxLat ?? null,
        bounds.minLng ?? null,
        bounds.maxLng ?? null,
        location.countryCode || null,
        location.stateCode || null,
        details.heroImage || null,
        details.heroImageAttribution || null,
        details.heroImageAttributionURL || null,
        d.averages ? JSON.stringify(d.averages) : null,
        d.recency?.toDate?.() ?? null,
      ]);
    }

    // Insert batch
    for (const v of values) {
      try {
        await db.query(
          `INSERT INTO destinations (
            id, name, search_name, elevation, prominence,
            location, geohash, type, activities, features, owner,
            bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
            country_code, state_code,
            hero_image, hero_image_attribution, hero_image_attribution_url,
            averages, recency
          ) VALUES (
            $1, $2, $3, $4, $5,
            ST_MakePoint($6, $7, $8)::geography,
            $9, $10::destination_type, $11::activity_type[], $12::destination_feature[], $13,
            $14, $15, $16, $17,
            $18, $19,
            $20, $21, $22,
            $23::jsonb, $24
          ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            search_name = EXCLUDED.search_name,
            elevation = EXCLUDED.elevation,
            location = EXCLUDED.location,
            updated_at = now()`,
          v
        );
        migrated++;
      } catch (err: any) {
        console.error(`  Error migrating destination ${v[0]}: ${err.message}`);
        skipped++;
      }
    }

    console.log(`  Progress: ${Math.min(i + batchSize, docs.length)}/${docs.length}`);
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
}

// Map Firestore activity strings to PostGIS enum values
function mapActivities(arr: string[]): string[] {
  const mapping: Record<string, string> = {
    "outdoor-trek": "outdoor-trek",
    "hiking": "outdoor-trek",
    "outdoor-moto": "outdoor-moto",
    "ski": "ski",
    "skiing": "ski",
  };
  return arr.map(a => mapping[a]).filter(Boolean);
}

// Map Firestore feature strings to PostGIS enum values
function mapFeatures(arr: string[]): string[] {
  const mapping: Record<string, string> = {
    "volcano": "volcano",
    "fire-lookout": "fire-lookout",
    "summit": "summit",
    "trailhead": "trailhead",
  };
  return arr.map(f => mapping[f]).filter(Boolean);
}

function mapDestinationType(type: string | undefined): string {
  if (type === "region") return "region";
  return "point";
}
