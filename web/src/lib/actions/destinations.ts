"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import db from "../db";
import { normalizeSearchName } from "../search-utils";
import { fetchElevations } from "../elevation";
import { mergeDestinationAverages } from "../destination-detail";
import { backfillDestinationToSessions } from "../destination-backfill";
import type { ExternalIds } from "../destination-types";

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays */
function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.startsWith("{")) {
    return val.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export interface DestinationRow {
  id: string;
  name: string | null;
  elevation: number | null;
  prominence: number | null;
  type: string;
  activities: string[];
  features: string[];
  owner: string;
  country_code: string | null;
  state_code: string | null;
  lat: number | null;
  lng: number | null;
  route_count: number;
  list_count: number;
}

export interface DestinationDetail {
  id: string;
  name: string | null;
  search_name: string | null;
  elevation: number | null;
  prominence: number | null;
  type: string;
  activities: string[];
  features: string[];
  owner: string;
  country_code: string | null;
  state_code: string | null;
  lat: number | null;
  lng: number | null;
  boundary: GeoJSON.Polygon | null;
  hero_image: string | null;
  hero_image_attribution: string | null;
  hero_image_attribution_url: string | null;
  averages: any | null;
  averages_offset: any | null;
  explicitly_saved: boolean;
  geohash: string | null;
  created_at: string;
  updated_at: string;
}

export interface DestinationRoute {
  id: string;
  name: string | null;
  distance: number | null;
  gain: number | null;
  ordinal: number;
}

export interface DestinationList {
  id: string;
  name: string | null;
  description: string | null;
  destination_count: number;
}

export type SortField = "name" | "elevation" | "prominence" | "route_count" | "list_count";
export type SortDir = "asc" | "desc";

export async function getDestinations(
  search: string = "",
  limit: number = 50,
  offset: number = 0,
  filters?: { type?: string; feature?: string; activity?: string },
  sort?: { field: SortField; dir: SortDir }
): Promise<{ destinations: DestinationRow[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (search.trim()) {
    conditions.push(`search_name ILIKE $${paramIndex}`);
    params.push(`%${normalizeSearchName(search.trim())}%`);
    paramIndex++;
  }

  if (filters?.type) {
    conditions.push(`type = $${paramIndex}::destination_type`);
    params.push(filters.type);
    paramIndex++;
  }

  if (filters?.feature) {
    conditions.push(`$${paramIndex}::destination_feature = ANY(features)`);
    params.push(filters.feature);
    paramIndex++;
  }

  if (filters?.activity) {
    conditions.push(`$${paramIndex}::activity_type = ANY(activities)`);
    params.push(filters.activity);
    paramIndex++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) FROM destinations ${where}`,
    params
  );

  const sortColumnMap: Record<SortField, string> = {
    name: "d.name",
    elevation: "d.elevation",
    prominence: "d.prominence",
    route_count: "route_count",
    list_count: "list_count",
  };
  const sortField = sort?.field || "name";
  const sortDir = sort?.dir === "desc" ? "DESC" : "ASC";
  const sortCol = sortColumnMap[sortField];
  const nulls = sortDir === "ASC" ? "NULLS LAST" : "NULLS FIRST";

  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.type,
            d.activities, d.features, d.owner,
            d.country_code, d.state_code,
            ST_Y(d.location::geometry) as lat,
            ST_X(d.location::geometry) as lng,
            (SELECT COUNT(*) FROM route_destinations rd JOIN routes r2 ON r2.id = rd.route_id WHERE rd.destination_id = d.id AND r2.owner = 'peaks') as route_count,
            (SELECT COUNT(*) FROM list_destinations ld WHERE ld.destination_id = d.id) as list_count
     FROM destinations d
     ${where}
     ORDER BY ${sortCol} ${sortDir} ${nulls}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    destinations: result.rows.map((r: any) => ({
      ...r,
      elevation: r.elevation ? Number(r.elevation) : null,
      prominence: r.prominence ? Number(r.prominence) : null,
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      features: parseArray(r.features),
      activities: parseArray(r.activities),
      route_count: Number(r.route_count),
      list_count: Number(r.list_count),
    })),
    total: Number(countResult.rows[0].count),
  };
}

export async function getDestination(
  id: string
): Promise<DestinationDetail | null> {
  const result = await db.query(
    `SELECT d.id, d.name, d.search_name, d.elevation, d.prominence,
            d.type, d.activities, d.features, d.owner,
            d.country_code, d.state_code,
            ST_Y(d.location::geometry) as lat,
            ST_X(d.location::geometry) as lng,
            CASE WHEN d.boundary IS NOT NULL
                 THEN ST_AsGeoJSON(d.boundary)::json END AS boundary,
            d.hero_image, d.hero_image_attribution, d.hero_image_attribution_url,
            d.averages, d.averages_offset, d.explicitly_saved, d.geohash,
            d.created_at, d.updated_at
     FROM destinations d
     WHERE d.id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  return {
    ...r,
    elevation: r.elevation ? Number(r.elevation) : null,
    prominence: r.prominence ? Number(r.prominence) : null,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
    boundary: r.boundary || null,
    averages: mergeDestinationAverages(r.averages, r.averages_offset),
    averages_offset: r.averages_offset || null,
    features: parseArray(r.features),
    activities: parseArray(r.activities),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function getDestinationRoutes(
  destinationId: string,
  options?: { publicOnly?: boolean }
): Promise<DestinationRoute[]> {
  const publicFilter = options?.publicOnly
    ? ` AND r.owner = 'peaks' AND r.status = 'active'`
    : ` AND r.owner = 'peaks'`;

  const result = await db.query(
    `SELECT r.id, r.name, r.distance, r.gain, rd.ordinal
     FROM route_destinations rd
     JOIN routes r ON r.id = rd.route_id
     WHERE rd.destination_id = $1${publicFilter}
     ORDER BY r.name ASC NULLS LAST`,
    [destinationId]
  );

  return result.rows.map((r: any) => ({
    ...r,
    distance: r.distance ? Number(r.distance) : null,
    gain: r.gain ? Number(r.gain) : null,
    ordinal: Number(r.ordinal),
  }));
}

export async function getDestinationLists(
  destinationId: string
): Promise<DestinationList[]> {
  const result = await db.query(
    `SELECT l.id, l.name, l.description,
            (SELECT COUNT(*) FROM list_destinations ld2 WHERE ld2.list_id = l.id) as destination_count
     FROM list_destinations ld
     JOIN lists l ON l.id = ld.list_id
     WHERE ld.destination_id = $1
     ORDER BY l.name ASC`,
    [destinationId]
  );

  return result.rows.map((r: any) => ({
    ...r,
    destination_count: Number(r.destination_count),
  }));
}

export async function getDestinationSessionCount(
  destinationId: string
): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(DISTINCT session_id) as count
     FROM session_destinations
     WHERE destination_id = $1`,
    [destinationId]
  );
  return Number(result.rows[0].count);
}

export async function updateDestination(
  id: string,
  updates: { name?: string; type?: string; features?: string[]; activities?: string[] }
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${paramIndex}`);
    params.push(updates.name);
    paramIndex++;
    sets.push(`search_name = $${paramIndex}`);
    params.push(normalizeSearchName(updates.name));
    paramIndex++;
  }

  if (updates.type !== undefined) {
    sets.push(`type = $${paramIndex}::destination_type`);
    params.push(updates.type);
    paramIndex++;
  }

  if (updates.features !== undefined) {
    sets.push(`features = $${paramIndex}::destination_feature[]`);
    params.push(updates.features);
    paramIndex++;
  }

  if (updates.activities !== undefined) {
    sets.push(`activities = $${paramIndex}::activity_type[]`);
    params.push(updates.activities);
    paramIndex++;
  }

  if (sets.length === 0) return;

  params.push(id);
  await db.query(
    `UPDATE destinations SET ${sets.join(", ")} WHERE id = $${paramIndex}`,
    params
  );
}

export interface BulkImportWaypoint {
  name: string;
  lat: number;
  lng: number;
  ele: number | null;
  feature: string;
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  results: { name: string; status: "imported" | "skipped"; reason?: string }[];
}

export async function bulkImportDestinations(
  waypoints: BulkImportWaypoint[]
): Promise<BulkImportResult> {
  const results: BulkImportResult["results"] = [];
  let imported = 0;
  let skipped = 0;

  for (const wpt of waypoints) {
    if (!wpt.name.trim()) {
      results.push({ name: wpt.name || "(unnamed)", status: "skipped", reason: "No name" });
      skipped++;
      continue;
    }

    // Check for duplicate by name + proximity
    const dup = await db.query(
      `SELECT id FROM destinations
       WHERE search_name = $1
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 1000)`,
      [normalizeSearchName(wpt.name.trim()), wpt.lng, wpt.lat]
    );
    if (dup.rows.length > 0) {
      results.push({ name: wpt.name, status: "skipped", reason: "Already exists" });
      skipped++;
      continue;
    }

    const id = generateId();
    const ele = wpt.ele != null ? Math.round(wpt.ele) : null;

    let country_code: string | null = null;
    let state_code: string | null = null;
    try {
      const geo = await reverseGeocodePoint(wpt.lat, wpt.lng);
      country_code = geo.country_code;
      state_code = geo.state_code;
    } catch {}

    await db.query(
      `INSERT INTO destinations (id, name, search_name, location, elevation, features, owner, type, country_code, state_code)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5, COALESCE($6::double precision, 0)), 4326)::geography,
               $6, ARRAY[$7]::destination_feature[], 'peaks', 'point', $8, $9)`,
      [id, wpt.name.trim(), normalizeSearchName(wpt.name.trim()), wpt.lng, wpt.lat, ele, wpt.feature, country_code, state_code]
    );

    // Tag any existing sessions whose track passes through the new destination.
    // Non-fatal — a backfill failure shouldn't block the import response.
    backfillDestinationToSessions(id).catch((err) =>
      console.error("backfillDestinationToSessions failed for", id, err)
    );

    results.push({ name: wpt.name, status: "imported" });
    imported++;
  }

  return { imported, skipped, results };
}

export async function createDestination(input: {
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  features: string[];
  type?: string;
  external_ids?: ExternalIds;
}): Promise<{ id: string } | { duplicate: { id: string; name: string | null } }> {
  // Duplicate guard: if any external_ids key matches an existing row, surface
  // the existing destination instead of creating a duplicate. The @> jsonb
  // containment form uses the destinations_external_ids_idx GIN index;
  // an `external_ids->>$1 = $2` form would force a sequential scan.
  if (input.external_ids) {
    for (const [provider, providerId] of Object.entries(input.external_ids)) {
      if (!providerId) continue;
      const existing = await db.query<{ id: string; name: string | null }>(
        `SELECT id, name FROM destinations
         WHERE external_ids @> jsonb_build_object($1::text, $2::text)
         LIMIT 1`,
        [provider, providerId]
      );
      if (existing.rows.length > 0) {
        return { duplicate: existing.rows[0] };
      }
    }
  }

  const id = generateId();
  const searchName = normalizeSearchName(input.name);
  const destType = input.type || "point";

  // Reverse geocode for country/state
  let country_code: string | null = null;
  let state_code: string | null = null;
  try {
    const geo = await reverseGeocodePoint(input.lat, input.lng);
    country_code = geo.country_code;
    state_code = geo.state_code;
  } catch {
    // Non-fatal — location data is nice-to-have
  }

  const roundedEle = input.elevation != null ? Math.round(input.elevation) : null;
  const externalIdsJson = JSON.stringify(input.external_ids ?? {});

  await db.query(
    `INSERT INTO destinations (id, name, search_name, location, elevation, features, owner, type, country_code, state_code, external_ids)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5, COALESCE($6::double precision, 0)), 4326)::geography,
             $6, $7::destination_feature[], 'peaks', $8::destination_type, $9, $10, $11::jsonb)`,
    [id, input.name, searchName, input.lng, input.lat, roundedEle, input.features, destType, country_code, state_code, externalIdsJson]
  );

  // Tag any existing sessions whose track passes through the new destination.
  // Non-fatal — backfill failure shouldn't block the create response.
  backfillDestinationToSessions(id).catch((err) =>
    console.error("backfillDestinationToSessions failed for", id, err)
  );

  return { id };
}

export interface NearbyDestination {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  elevation: number | null;
  features: string[];
  type: string;
  distance: number;
}

export async function searchNearbyExisting(
  lat: number,
  lng: number,
  radiusM: number = 2000
): Promise<NearbyDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.type, d.features, d.elevation,
            ST_Y(d.location::geometry) as lat,
            ST_X(d.location::geometry) as lng,
            ROUND(ST_Distance(d.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric) as distance
     FROM destinations d
     WHERE ST_DWithin(d.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY distance
     LIMIT 20`,
    [lng, lat, radiusM]
  );

  return result.rows.map((r: any) => ({
    ...r,
    elevation: r.elevation ? Number(r.elevation) : null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    distance: Number(r.distance),
    features: parseArray(r.features),
  }));
}

export interface OSMSuggestion {
  osm_id: number;
  name: string;
  lat: number;
  lng: number;
  elevation: number | null;
  feature: string;
  osm_tags: string;
  distance: number;
}

export async function searchOSMNearby(
  lat: number,
  lng: number,
  radiusM: number = 2000
): Promise<OSMSuggestion[]> {
  const query = `
[out:json][timeout:10];
(
  node["natural"="peak"](around:${radiusM},${lat},${lng});
  node["natural"="volcano"](around:${radiusM},${lat},${lng});
  node["natural"="saddle"](around:${radiusM},${lat},${lng});
  node["tourism"="alpine_hut"](around:${radiusM},${lat},${lng});
  node["tourism"="wilderness_hut"](around:${radiusM},${lat},${lng});
  node["man_made"="tower"]["tower:type"="observation"](around:${radiusM},${lat},${lng});
  node["information"="trailhead"](around:${radiusM},${lat},${lng});
  node["highway"="trailhead"](around:${radiusM},${lat},${lng});
  node["amenity"="shelter"](around:${radiusM},${lat},${lng});
  node["tourism"="camp_site"](around:${radiusM},${lat},${lng});
  node["natural"="water"]["name"](around:${radiusM},${lat},${lng});
  way["natural"="water"]["name"](around:${radiusM},${lat},${lng});
  node["tourism"="viewpoint"](around:${radiusM},${lat},${lng});
  node["waterway"="waterfall"](around:${radiusM},${lat},${lng});
  way["waterway"="waterfall"](around:${radiusM},${lat},${lng});
);
out body center;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const elements: any[] = data.elements || [];

  // Haversine distance
  function dist(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function mapFeature(tags: Record<string, string>): { feature: string; label: string } {
    if (tags.natural === "volcano") return { feature: "volcano", label: "volcano" };
    if (tags.natural === "peak") return { feature: "summit", label: "peak" };
    if (tags.natural === "saddle") return { feature: "landform", label: "saddle" };
    if (tags.tourism === "alpine_hut" || tags.tourism === "wilderness_hut")
      return { feature: "hut", label: tags.tourism.replace("_", " ") };
    if (tags["tower:type"] === "observation")
      return { feature: "lookout", label: "observation tower" };
    if (tags.information === "trailhead" || tags.highway === "trailhead")
      return { feature: "trailhead", label: "trailhead" };
    if (tags.amenity === "shelter") return { feature: "hut", label: "shelter" };
    if (tags.tourism === "camp_site") return { feature: "", label: "campsite" };
    if (tags.natural === "water") return { feature: "lake", label: "lake" };
    if (tags.tourism === "viewpoint") return { feature: "viewpoint", label: "viewpoint" };
    if (tags.waterway === "waterfall") return { feature: "waterfall", label: "waterfall" };
    return { feature: "", label: "poi" };
  }

  return elements
    .filter((el: any) => el.tags?.name && (el.lat != null || el.center))
    .map((el: any) => {
      const tags = el.tags || {};
      const mapped = mapFeature(tags);
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      return {
        osm_id: el.id,
        name: tags.name,
        lat: elLat,
        lng: elLng,
        elevation: tags.ele ? parseFloat(tags.ele) : null,
        feature: mapped.feature,
        osm_tags: mapped.label,
        distance: Math.round(dist(lat, lng, elLat, elLng)),
      };
    })
    .sort((a: OSMSuggestion, b: OSMSuggestion) => a.distance - b.distance);
}

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";

/**
 * Reverse geocode a lat/lng to get a place name suggestion (for trailheads, etc.)
 */
export async function reverseGeocodePointName(
  lat: number,
  lng: number
): Promise<{ suggestedName: string | null; country_code: string | null; state_code: string | null }> {
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=poi,address,neighborhood,locality,place&limit=3&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);

  const data = await res.json();
  const features: any[] = data.features || [];

  let suggestedName: string | null = null;
  let country_code: string | null = null;
  let state_code: string | null = null;

  // Pick the most specific feature for the name
  for (const f of features) {
    const props = f.properties || {};
    if (!suggestedName && props.name) {
      suggestedName = props.name;
    }
    const ctx = props.context || {};
    if (!country_code && ctx.country) {
      country_code = ctx.country.country_code?.toUpperCase() || null;
    }
    if (!state_code && ctx.region) {
      state_code = ctx.region.region_code?.toUpperCase() || null;
    }
  }

  // Append "Trailhead" if the name doesn't already contain a descriptive term
  if (suggestedName) {
    const lower = suggestedName.toLowerCase();
    const hasDescriptor = ["trailhead", "parking", "campground", "lodge", "station", "ranger"].some(
      (t) => lower.includes(t)
    );
    if (!hasDescriptor) {
      suggestedName = suggestedName + " Trailhead";
    }
  }

  return { suggestedName, country_code, state_code };
}

/** Internal helper: reverse geocode for just country/state codes */
async function reverseGeocodePoint(
  lat: number,
  lng: number
): Promise<{ country_code: string | null; state_code: string | null }> {
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=region,country&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return { country_code: null, state_code: null };

  const data = await res.json();
  let country_code: string | null = null;
  let state_code: string | null = null;

  for (const f of (data.features || [])) {
    const props = f.properties || {};
    const ctx = props.context || {};
    if (!country_code && ctx.country) {
      country_code = ctx.country.country_code?.toUpperCase() || null;
    }
    if (!state_code && ctx.region) {
      state_code = ctx.region.region_code?.toUpperCase() || null;
    }
  }

  return { country_code, state_code };
}

export async function reverseGeocodeDestination(
  id: string
): Promise<{ country_code: string | null; state_code: string | null }> {
  const result = await db.query(
    `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM destinations WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) throw new Error("Destination not found");

  const { lat, lng } = result.rows[0];
  if (lat == null || lng == null) throw new Error("Destination has no location");

  const { country_code, state_code } = await reverseGeocodePoint(lat, lng);

  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (country_code) {
    sets.push(`country_code = $${idx}`);
    params.push(country_code);
    idx++;
  }
  if (state_code) {
    sets.push(`state_code = $${idx}`);
    params.push(state_code);
    idx++;
  }

  if (sets.length > 0) {
    params.push(id);
    await db.query(
      `UPDATE destinations SET ${sets.join(", ")} WHERE id = $${idx}`,
      params
    );
  }

  return { country_code, state_code };
}

export async function updateDestinationBoundary(
  id: string,
  geojson: GeoJSON.Polygon
): Promise<void> {
  await db.query(
    `UPDATE destinations
     SET boundary = ST_GeomFromGeoJSON($2)::geography
     WHERE id = $1`,
    [id, JSON.stringify(geojson)]
  );
}

export async function deleteDestinationBoundary(
  id: string
): Promise<void> {
  await db.query(
    `UPDATE destinations SET boundary = NULL WHERE id = $1`,
    [id]
  );
}

export async function lookupElevation(
  lat: number,
  lng: number
): Promise<number | null> {
  try {
    const [ele] = await fetchElevations([{ lat, lng }]);
    return Math.round(ele);
  } catch {
    return null;
  }
}
