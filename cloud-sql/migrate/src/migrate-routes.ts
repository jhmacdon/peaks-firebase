import { firestore } from "./firebase";
import db from "./db";

export interface RouteProvenance {
  source_kind: string;
  source_url: string;
  license_name: string;
  license_url: string;
  attribution: string;
  retrieved_at: string;
  osm_way_ids: number[];
  osm_way_urls: string[];
  contains_osm_geometry: boolean;
}

const RETRIEVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const URL_PATTERN = /^https?:\/\/\S+$/;
const SOURCE_KIND_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Mirrors is_valid_route_provenance in schema.sql so a Firestore backfill
 * refuses malformed geometry credit before it reaches Cloud SQL.
 */
export function parseRouteProvenance(value: unknown): RouteProvenance | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route provenance must be an object");
  }

  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "source_kind", "source_url", "license_name", "license_url", "attribution",
    "retrieved_at", "osm_way_ids", "osm_way_urls", "contains_osm_geometry",
  ];
  if (Object.keys(record).length !== expectedKeys.length
      || !expectedKeys.every((key) => key in record)) {
    throw new Error("route provenance must use the canonical shape");
  }

  const text = (key: keyof RouteProvenance): string => {
    const item = record[key];
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`route provenance ${key} must be a non-empty string`);
    }
    return item;
  };

  const source_kind = text("source_kind");
  const source_url = text("source_url");
  const license_name = text("license_name");
  const license_url = text("license_url");
  const attribution = text("attribution");
  const retrieved_at = text("retrieved_at");
  const osm_way_ids = record.osm_way_ids;
  const osm_way_urls = record.osm_way_urls;
  const contains_osm_geometry = record.contains_osm_geometry;

  if (!SOURCE_KIND_PATTERN.test(source_kind)
      || !URL_PATTERN.test(source_url)
      || !URL_PATTERN.test(license_url)
      || !RETRIEVED_AT_PATTERN.test(retrieved_at)) {
    throw new Error("route provenance has an invalid source, URL, or retrieval time");
  }
  if (!Array.isArray(osm_way_ids)
      || !osm_way_ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new Error("route provenance osm_way_ids must contain positive integer JSON numbers");
  }
  if (!Array.isArray(osm_way_urls)
      || !osm_way_urls.every((url, index) =>
        typeof url === "string" && url === `https://www.openstreetmap.org/way/${osm_way_ids[index]}`)) {
    throw new Error("route provenance osm_way_urls must match osm_way_ids");
  }
  if (typeof contains_osm_geometry !== "boolean"
      || osm_way_ids.length !== osm_way_urls.length
      || contains_osm_geometry !== (osm_way_ids.length > 0)) {
    throw new Error("route provenance OSM fields do not agree");
  }
  if (contains_osm_geometry
      && (source_kind !== "openstreetmap"
        || license_name !== "Open Data Commons Open Database License (ODbL) 1.0"
        || license_url !== "https://opendatacommons.org/licenses/odbl/1-0/"
        || attribution !== "© OpenStreetMap contributors")) {
    throw new Error("route provenance OSM geometry must carry the required ODbL credit");
  }

  return {
    source_kind,
    source_url,
    license_name,
    license_url,
    attribution,
    retrieved_at,
    osm_way_ids,
    osm_way_urls,
    contains_osm_geometry,
  };
}

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
 * Note: polyline6 encodes lat/lng only (no elevation). It can never populate
 * the canonical LineStringZ path. New rows keep path NULL, and reruns preserve
 * any trusted 3D path already written by a later import or repair.
 */
export async function migrateRoutes() {
  console.log("Migrating routes...");

  const snapshot = await firestore.collection("routes").get();
  console.log(`  Found ${snapshot.size} routes in Firestore`);

  let migrated = 0;
  let skipped = 0;
  const missingDestinationLinks: string[] = [];

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
      const provenance = parseRouteProvenance(d.provenance);

      const path: null = null;

      await db.query(
        `INSERT INTO routes (
          id, name, path, polyline6, geohashes, owner,
          distance, gain, gain_loss, elevation_string,
          external_links, provenance, completion
        ) VALUES (
          $1, $2, $3::geography, $4, $5, $6,
          $7, $8, $9, $10,
          $11::jsonb, $12::jsonb, $13::completion_mode
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          path = routes.path,
          polyline6 = COALESCE(EXCLUDED.polyline6, routes.polyline6),
          geohashes = EXCLUDED.geohashes,
          owner = EXCLUDED.owner,
          distance = EXCLUDED.distance,
          gain = EXCLUDED.gain,
          gain_loss = EXCLUDED.gain_loss,
          elevation_string = COALESCE(routes.elevation_string, EXCLUDED.elevation_string),
          external_links = COALESCE(EXCLUDED.external_links, routes.external_links),
          provenance = COALESCE(EXCLUDED.provenance, routes.provenance),
          completion = EXCLUDED.completion,
          updated_at = now()`,
        [
          id,
          d.name || null,
          path,
          d.polyline6 || null,
          geohashes,
          d.owner || "peaks",
          stats.distance ?? null,
          stats.gain ?? null,
          stats.gainLoss ?? null,
          d.elevationString || null,
          extLinks.length > 0 ? JSON.stringify(extLinks) : null,
          provenance ? JSON.stringify(provenance) : null,
          completion,
        ]
      );

      await db.query("DELETE FROM route_destinations WHERE route_id = $1", [id]);
      const destIds: string[] = d.destinations || [];
      for (let i = 0; i < destIds.length; i++) {
        const link = await db.query(
          `INSERT INTO route_destinations (route_id, destination_id, ordinal)
           SELECT $1, $2, $3
           WHERE EXISTS (SELECT 1 FROM destinations WHERE id = $2)
           ON CONFLICT (route_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
          [id, destIds[i], i]
        );
        if (link.rowCount === 0) {
          missingDestinationLinks.push(`${id}:${destIds[i]}`);
        }
      }

      migrated++;
    } catch (err: any) {
      console.error(`  Error migrating route ${id}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  Done: ${migrated} migrated, ${skipped} skipped`);
  if (skipped > 0 || missingDestinationLinks.length > 0) {
    throw new Error(
      `Migration incomplete: ${skipped} routes failed and `
      + `${missingDestinationLinks.length} route-destination links are missing target rows. `
      + missingDestinationLinks.slice(0, 10).join(", ")
    );
  }
}

function mapCompletion(val: string | undefined): string {
  if (val === "straight" || val === "reverse") return val;
  return "none";
}
