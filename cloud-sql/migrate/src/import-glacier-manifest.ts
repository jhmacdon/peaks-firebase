import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import type { Outline } from "./glaciers/outline-geometry";

/** observed_at is an ice observation; snapshot_at is a mapping/download date.
 * The API's legacy outline_observed_at uses observed_at ?? snapshot_at. */
export type GlacierGeometryProvenance = {
  schema_version: 1; geometry_source: string; source_url: string; source_sha256: string;
  observed_at: string | null; snapshot_at: string | null;
  license: string; license_url: string; credit: string;
  method: string; geometry_sha256: string;
  analysis_ids?: string[]; glacier_ids?: string[]; submission_id?: string;
  review?: Record<string, unknown>;
};

/** One mountain's reviewed glacier package. Every name, credit, source and
 * identity check lives here, so a new mountain is a new manifest and data
 * files; the writer, schema, API and app stay unchanged. Source-specific
 * parsers (for example glaciers/rainier.ts) only build this object.
 */
export type GlacierManifestFacts = {
  kind: "glacier" | "snowfield"; inventory_name: string | null; observed_year: number | null;
  area_km2: number | null; area_uncertainty_km2: number | null; head_elevation_m: number | null;
  terminus_elevation_m: number | null; elevation_range_m: number | null; length_km: number | null;
  average_slope_deg: number | null; flow_direction_deg: number | null; flow_direction_label: string | null;
  type_code: string | null; type_label: string | null; estimated_volume_km3: number | null;
  volume_uncertainty_km3: number | null; rank_on_mountain: number | null;
  area_history: { year: number; area_km2: number | null; uncertainty_km2: number | null }[];
  area_history_scope: string | null; percent_change_since_earliest: number | null;
  description: string | null; description_source_url: string | null; provenance: Record<string, unknown>;
};
export type GlacierManifestPlace = {
  id: string; name: string; osm_key: string; external_ids: Record<string, string>; kind: "glacier" | "snowfield";
  /** Other spellings for search and route terrain names, e.g. "Interglacier". */
  aliases: string[];
  boundary: Outline;
  /** Required for new builders; old single-source manifests use package defaults. */
  geometry?: GlacierGeometryProvenance;
  facts: GlacierManifestFacts;
};
export type GlacierManifest = {
  source_sha256: string; geometry_observed_at: string;
  geometry_source: string; geometry_credit: string; geometry_license: string;
  facts_credit: string; facts_source_url: string | null;
  description_source_name: string | null; description_source_license: string | null;
  country_code: string; state_code: string | null; activities: string[];
  /** The checked parent destination: apply refuses an id that fails any field. */
  parent: { name: string; features: string[]; country_code: string; state_code: string | null; lat: number; lng: number; radius_m: number };
  /** Every outline must lie inside this area (a park or other managed unit). */
  container_area: { kind: string; name: string };
  /** Mountain-wide totals; served to clients as `mountain_context`. */
  mountain_context: Record<string, unknown>;
  /** Binds the whole offline review (including unmatched features) to apply. */
  outline_refresh?: { schema_version: 1; input_manifest_sha256: string; review_sha256: string };
  places: GlacierManifestPlace[];
};

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function placeGeometry(m: GlacierManifest, p: GlacierManifestPlace): GlacierGeometryProvenance {
  return p.geometry ?? {
    schema_version: 1, geometry_source: m.geometry_source,
    source_url: `https://www.openstreetmap.org/${p.osm_key.replace(":", "/")}`,
    source_sha256: m.source_sha256, observed_at: null, snapshot_at: m.geometry_observed_at,
    credit: m.geometry_credit, license: m.geometry_license,
    license_url: "https://www.openstreetmap.org/copyright", method: "OSM snapshot; imagery observation date unknown",
    geometry_sha256: sha256(JSON.stringify(p.boundary)),
  };
}

/** Shared by previews and writes so row metadata cannot retain package credit
 * after switching sources. Keep facts citations and the identity snapshot. */
export function glacierPlaceProvenance(m: GlacierManifest, p: GlacierManifestPlace) {
  const geometry = placeGeometry(m, p);
  return { geometry,
    catalog: { source: geometry.geometry_source, license: geometry.license, credit: geometry.credit,
      snapshot_sha256: geometry.source_sha256, fetched_at: geometry.snapshot_at,
      observed_at: geometry.observed_at, source_url: geometry.source_url, aliases: p.aliases },
    facts: { ...p.facts, provenance: { ...p.facts.provenance, mountain_context: m.mountain_context,
      source_snapshot_sha256: m.source_sha256, outline: geometry } },
  };
}
export function manifestSha256(manifest: GlacierManifest): string {
  const { manifest_sha256: _ignored, ...body } = manifest as GlacierManifest & { manifest_sha256?: string };
  return sha256(JSON.stringify(body));
}

export function validateGlacierManifest(m: GlacierManifest): GlacierManifest {
  const fail = (why: string) => { throw new Error(`Invalid glacier manifest: ${why}`); };
  if (!m || !Array.isArray(m.places) || !m.places.length) fail("no places");
  if (!m.parent?.name || !Number.isFinite(m.parent.lat) || !Number.isFinite(m.parent.lng) || !(m.parent.radius_m > 0)) fail("parent identity");
  if (!m.container_area?.kind || !m.container_area?.name) fail("container area");
  if (!m.facts_credit?.trim() || !m.geometry_credit?.trim() || !m.geometry_license?.trim()) fail("credits");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.geometry_observed_at)) fail("geometry_observed_at");
  if (!/^[0-9a-f]{64}$/.test(m.source_sha256)) fail("source_sha256");
  if (m.outline_refresh && (m.outline_refresh.schema_version !== 1 || !/^[0-9a-f]{64}$/.test(m.outline_refresh.input_manifest_sha256)
    || !/^[0-9a-f]{64}$/.test(m.outline_refresh.review_sha256))) fail("outline_refresh review hash");
  if (new Set(m.places.map(p => p.id)).size !== m.places.length || new Set(m.places.map(p => p.name)).size !== m.places.length) fail("duplicate place");
  for (const p of m.places) {
    if (!["glacier", "snowfield"].includes(p.kind) || p.facts?.kind !== p.kind) fail(`kind for ${p.name}`);
    if (p.boundary?.type !== "MultiPolygon" || !p.boundary.coordinates?.length) fail(`boundary for ${p.name}`);
    if (!Array.isArray(p.aliases)) fail(`aliases for ${p.name}`);
    const g = placeGeometry(m, p);
    const date = (value: string | null) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    const url = (value: string) => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } };
    if (g.schema_version !== 1 || !g.geometry_source?.trim() || !g.credit?.trim() || !g.license?.trim()
      || !g.method?.trim() || !url(g.source_url) || !url(g.license_url)
      || !date(g.observed_at) || !date(g.snapshot_at) || !(g.observed_at ?? g.snapshot_at)
      || !/^[0-9a-f]{64}$/.test(g.source_sha256) || g.geometry_sha256 !== sha256(JSON.stringify(p.boundary))) fail(`geometry provenance for ${p.name}`);
    if (p.facts.provenance.outline && !isDeepStrictEqual(p.facts.provenance.outline, g)) fail(`conflicting outline provenance for ${p.name}`);
  }
  return m;
}

export function readGlacierManifest(path: string): GlacierManifest & { manifest_sha256: string } {
  const manifest = validateGlacierManifest(JSON.parse(readFileSync(path, "utf8")));
  return { ...manifest, manifest_sha256: manifestSha256(manifest) };
}

export function summarizeGlacierManifest(m: GlacierManifest & { manifest_sha256: string }) {
  return { ...m, places: m.places.map(({ boundary, ...p }) => ({ ...p,
    polygon_components: boundary.coordinates.length, holes: boundary.coordinates.reduce((n, p) => n + p.length - 1, 0),
    vertices: boundary.coordinates.flat(2).length })) };
}

const factColumns = ["kind","inventory_name","observed_year","area_km2","area_uncertainty_km2","head_elevation_m","terminus_elevation_m",
  "elevation_range_m","length_km","average_slope_deg","flow_direction_deg","flow_direction_label","type_code","type_label",
  "estimated_volume_km3","volume_uncertainty_km3","rank_on_mountain","area_history","area_history_scope","percent_change_since_earliest","provenance"] as const;

/** Read-only until --apply AND the exact dry-run manifest hash are supplied. */
export async function applyGlacierManifest(pkg: GlacierManifest & { manifest_sha256: string }, args: string[]) {
  const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length+3);
  if (!args.includes("--apply")) { console.log(JSON.stringify(summarizeGlacierManifest(pkg), null, 2)); return; }
  if (value("expected-manifest-sha256") !== pkg.manifest_sha256) throw new Error("Apply requires the reviewed --expected-manifest-sha256");
  validateGlacierManifest(pkg);
  if (manifestSha256(pkg) !== pkg.manifest_sha256) throw new Error("Manifest changed after review");
  const parentId = value("parent-mountain-id"), areaId = value("park-area-id");
  if (!parentId || !areaId) throw new Error("Supply checked --parent-mountain-id and --park-area-id; IDs are never guessed");
  // No default connection, proxy, environment merge or network acquisition.
  const url = process.env.GLACIER_DATABASE_URL;
  if (!url) throw new Error("GLACIER_DATABASE_URL is required for apply");
  const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 30_000, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  const p = pkg.parent;
  try {
    const parent = await client.query(`SELECT id FROM destinations WHERE id=$1 AND owner='peaks' AND name=$2
      AND features && $3::destination_feature[] AND country_code=$4 AND state_code IS NOT DISTINCT FROM $5
      AND ST_DWithin(location,ST_MakePoint($6,$7)::geography,$8)`,
      [parentId,p.name,`{${p.features.join(",")}}`,p.country_code,p.state_code,p.lng,p.lat,p.radius_m]);
    const area = await client.query(`SELECT id FROM areas WHERE id=$1 AND kind=$2 AND name=$3`,
      [areaId,pkg.container_area.kind,pkg.container_area.name]);
    if (parent.rowCount !== 1 || area.rowCount !== 1) throw new Error("Parent/area identity check failed");
    // Check every geometry before the first write; an incomplete or invalid
    // source package must not become a partly visible catalog.
    const preflight=await client.query(`WITH inputs AS (
      SELECT item->>'name' AS name,ST_SetSRID(ST_GeomFromGeoJSON(item->'boundary'),4326) AS g
      FROM jsonb_array_elements($1::jsonb) AS incoming(item)
    ) SELECT i.name FROM inputs i JOIN areas a ON a.id=$2
      WHERE NOT ST_IsValid(i.g) OR ST_IsEmpty(i.g) OR NOT ST_Covers(a.boundary,i.g)`,
      [JSON.stringify(pkg.places.map(x=>({name:x.name,boundary:x.boundary}))),areaId]);
    if (preflight.rows.length) throw new Error(`Invalid/out-of-area source package: ${preflight.rows.map(r=>r.name).join(", ")}`);
    for (const place of pkg.places) {
      await client.query("BEGIN");
      try {
        const shape = await client.query(`SELECT ST_IsValid(g) AS valid,ST_IsEmpty(g) AS empty,
          ST_Covers(a.boundary,g) AS inside FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g) s
          JOIN areas a ON a.id=$2`,[JSON.stringify(place.boundary),areaId]);
        if (!shape.rows[0]?.valid || shape.rows[0].empty || !shape.rows[0].inside) throw new Error(`Invalid/out-of-area boundary: ${place.name}`);
        const collision = await client.query(`SELECT id FROM destinations WHERE id=$1 OR external_ids @> $2::jsonb
          OR ($4::jsonb<>'{}'::jsonb AND external_ids @> $4::jsonb)
          OR (owner='peaks' AND lower(name)=lower($3) AND ST_DWithin(location,ST_MakePoint($5,$6)::geography,30000))`,
          [place.id,JSON.stringify({ [place.osm_key.startsWith("way:") ? "osm_way" : "osm_relation"]: place.osm_key.split(":")[1] }),place.name,
            JSON.stringify(place.external_ids.wikidata ? {wikidata:place.external_ids.wikidata}:{}),p.lng,p.lat]);
        if (collision.rows.some(r => r.id !== place.id)) throw new Error(`Identity collision: ${place.name}`);
        const existing = await client.query(`SELECT owner,external_ids FROM destinations WHERE id=$1 FOR UPDATE`,[place.id]);
        if (existing.rows[0] && (existing.rows[0].owner !== "peaks" || Object.entries(place.external_ids).some(([k,v]) =>
          k === "wikidata" ? existing.rows[0].external_ids?.[k] && existing.rows[0].external_ids[k] !== v
            : existing.rows[0].external_ids?.[k] !== v))) throw new Error(`ID belongs to another place: ${place.id}`);
        const f = place.facts;
        const serialized = glacierPlaceProvenance(pkg, place), geometry = serialized.geometry;
        const described = f.description != null && pkg.description_source_name != null;
        await client.query(`WITH shape AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4),4326) AS g)
          INSERT INTO destinations(id,name,search_name,type,features,activities,owner,country_code,state_code,location,boundary,
            bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng,external_ids,metadata,
            description,description_source_name,description_source_url,description_source_license)
          SELECT $1,$2,peaks_search_name($2),'region',ARRAY['glacier']::destination_feature[],$11::activity_type[],
            'peaks',$9,$10,ST_Force3DZ(ST_PointOnSurface(largest.geom))::geography,largest.geom::geography,
            ST_YMin(g),ST_YMax(g),ST_XMin(g),ST_XMax(g),$3::jsonb,$5::jsonb,$6,$8,$7,$12 FROM shape
          CROSS JOIN LATERAL (SELECT geom FROM ST_Dump(g)
            ORDER BY ST_Area(geom::geography) DESC,path LIMIT 1) largest
          ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,search_name=EXCLUDED.search_name,type=EXCLUDED.type,
            features=EXCLUDED.features,boundary=EXCLUDED.boundary,location=EXCLUDED.location,elevation=EXCLUDED.elevation,
            bbox_min_lat=EXCLUDED.bbox_min_lat,bbox_max_lat=EXCLUDED.bbox_max_lat,bbox_min_lng=EXCLUDED.bbox_min_lng,bbox_max_lng=EXCLUDED.bbox_max_lng,
            external_ids=COALESCE(destinations.external_ids,'{}'::jsonb)||EXCLUDED.external_ids,metadata=COALESCE(destinations.metadata,'{}'::jsonb)||EXCLUDED.metadata,
            description=EXCLUDED.description,description_source_name=EXCLUDED.description_source_name,
            description_source_url=EXCLUDED.description_source_url,description_source_license=EXCLUDED.description_source_license
          WHERE destinations.name IS DISTINCT FROM EXCLUDED.name OR destinations.features IS DISTINCT FROM EXCLUDED.features
            OR destinations.type IS DISTINCT FROM EXCLUDED.type OR destinations.elevation IS NOT NULL
            OR ST_AsEWKB(destinations.location::geometry) IS DISTINCT FROM ST_AsEWKB(EXCLUDED.location::geometry)
            OR (destinations.bbox_min_lat,destinations.bbox_max_lat,destinations.bbox_min_lng,destinations.bbox_max_lng)
              IS DISTINCT FROM (EXCLUDED.bbox_min_lat,EXCLUDED.bbox_max_lat,EXCLUDED.bbox_min_lng,EXCLUDED.bbox_max_lng)
            OR destinations.description_source_name IS DISTINCT FROM EXCLUDED.description_source_name
            OR destinations.description_source_url IS DISTINCT FROM EXCLUDED.description_source_url
            OR destinations.description_source_license IS DISTINCT FROM EXCLUDED.description_source_license
            OR ST_AsEWKB(destinations.boundary::geometry) IS DISTINCT FROM ST_AsEWKB(EXCLUDED.boundary::geometry)
            OR NOT COALESCE(destinations.external_ids,'{}'::jsonb) @> EXCLUDED.external_ids
            OR NOT COALESCE(destinations.metadata,'{}'::jsonb) @> EXCLUDED.metadata
            OR destinations.description IS DISTINCT FROM EXCLUDED.description`,
          [place.id,place.name,JSON.stringify(place.external_ids),JSON.stringify(place.boundary),JSON.stringify({glacier_catalog: serialized.catalog}),described ? f.description : null,
            described ? f.description_source_url : null,described ? pkg.description_source_name : null,
            pkg.country_code,pkg.state_code,`{${pkg.activities.join(",")}}`,described ? pkg.description_source_license : null]);
        const facts = serialized.facts;
        const parameters: unknown[] = [place.id,parentId,...factColumns.map(c => ["area_history","provenance"].includes(c) ? JSON.stringify(facts[c]) : facts[c]),
          pkg.facts_credit,pkg.facts_source_url,geometry.credit,geometry.license,geometry.observed_at ?? geometry.snapshot_at,
          geometry.source_url,geometry.source_sha256,JSON.stringify(place.boundary)];
        const columns = ["destination_id","parent_mountain_id",...factColumns,"facts_credit","facts_source_url","geometry_credit","geometry_license",
          "outline_observed_at","outline_source_url","outline_source_sha256","outline"];
        await client.query(`INSERT INTO destination_glacier_facts(${columns.join(",")}) VALUES(${columns.map((c,i)=>
          c==="outline" ? `ST_SetSRID(ST_GeomFromGeoJSON($${i+1}),4326)::geography` : `$${i+1}`).join(",")})
          ON CONFLICT(destination_id) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=EXCLUDED.${c}`).join(",")},updated_at=now()
          WHERE ${columns.slice(1).map(c=>c==="outline"
            ? "ST_AsEWKB(destination_glacier_facts.outline::geometry) IS DISTINCT FROM ST_AsEWKB(EXCLUDED.outline::geometry)"
            : `destination_glacier_facts.${c} IS DISTINCT FROM EXCLUDED.${c}`).join(" OR ")}`,parameters);
        await client.query(`INSERT INTO destination_areas(destination_id,area_id,relation,source) VALUES($1,$2,'contained_by','postgis')
          ON CONFLICT(destination_id,area_id) DO NOTHING`,[place.id,areaId]);
        await client.query("COMMIT");
        console.log(`Imported ${place.name} (${place.id})`);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    console.log(`Imported ${pkg.places.length} places. Run backfill-glacier-crossings for queued routes and sessions; no backfill runs on detail reads.`);
  } finally { client.release(); await pool.end(); }
}

/** `npm run import:glacier-manifest -- --manifest=FILE [--apply ...]` */
export async function importGlacierManifest(args: string[]) {
  const path = args.find(a => a.startsWith("--manifest="))?.slice("--manifest=".length);
  if (!path) throw new Error("--manifest=FILE is required");
  await applyGlacierManifest(readGlacierManifest(path), args);
}
if (require.main === module) importGlacierManifest(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode=1; });
