import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { parseGlaciers, parseRainierFacts, sha256, SNAPSHOT_SHA256, SNAPSHOT_DATE, GEOMETRY_CREDIT, FACTS_CREDIT } from "./glaciers/rainier";

export const DATA_DIR = resolve(__dirname, "../data/glaciers-rainier-2026-10-28");
export function loadRainierPackage(dir = DATA_DIR) {
  const snapshot = readFileSync(join(dir, "rainier-glaciers-overpass.json"));
  if (sha256(snapshot) !== SNAPSHOT_SHA256) throw new Error("Unreviewed OSM snapshot SHA-256");
  const candidates = parseGlaciers(JSON.parse(snapshot.toString("utf8")));
  if (candidates.length !== 29 || candidates.filter(c => c.kind === "glacier").length !== 28 || new Set(candidates.map(c => c.name)).size !== 29)
    throw new Error("Expected 28 named OSM glaciers and Muir Snowfield");
  const report = readFileSync(join(dir, "nps-beason-2023-report.txt"), "utf8");
  const pages: Record<string, string> = {};
  for (const file of readdirSync(join(dir, "nps-place-pages")).filter(f => f.endsWith(".txt")).sort())
    pages[file.slice(0,-4)] = readFileSync(join(dir,"nps-place-pages",file), "utf8");
  const facts = parseRainierFacts(report, candidates, pages);
  const manifest = { source_sha256: SNAPSHOT_SHA256, report_sha256: sha256(report), pages_sha256: sha256(JSON.stringify(pages)),
    geometry_observed_at: SNAPSHOT_DATE, facts_credit: FACTS_CREDIT, geometry_credit: GEOMETRY_CREDIT,
    mountain_context: { observed_year: 2021, named_glacier_count: 28, area_km2: 75.496, area_uncertainty_km2: 4.109, percent_change_since_1896: -41.6 },
    places: candidates.map(c => ({ ...c, facts: facts[c.name] })) };
  return { ...manifest, manifest_sha256: sha256(JSON.stringify(manifest)) };
}

const factColumns = ["kind","nps_name","observed_year","area_km2","area_uncertainty_km2","head_elevation_m","terminus_elevation_m",
  "elevation_range_m","length_km","average_slope_deg","flow_direction_deg","flow_direction_label","type_code","type_label",
  "estimated_volume_km3","volume_uncertainty_km3","rank_on_mountain","area_history","area_history_scope","percent_change_since_earliest","provenance"] as const;

/** Read-only until --apply AND the exact dry-run manifest hash are supplied. */
export async function importRainierGlaciers(args: string[]) {
  const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length+3);
  const pkg = loadRainierPackage(value("data-dir"));
  if (!args.includes("--apply")) {
    console.log(JSON.stringify({ ...pkg, places: pkg.places.map(({boundary,...p}) => ({...p,
      polygon_components: boundary.coordinates.length, holes: boundary.coordinates.reduce((n,p) => n+p.length-1,0),
      vertices: boundary.coordinates.flat(2).length })) },null,2));
    return;
  }
  if (value("expected-manifest-sha256") !== pkg.manifest_sha256) throw new Error("Apply requires the reviewed --expected-manifest-sha256");
  const parentId = value("parent-mountain-id"), parkId = value("park-area-id");
  if (!parentId || !parkId) throw new Error("Supply checked --parent-mountain-id and --park-area-id; IDs are never guessed");
  // No default connection, proxy, environment merge or network acquisition.
  const url = process.env.GLACIER_DATABASE_URL;
  if (!url) throw new Error("GLACIER_DATABASE_URL is required for apply");
  const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 30_000, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    const parent = await client.query(`SELECT id FROM destinations WHERE id=$1 AND owner='peaks' AND name='Mount Rainier'
      AND features && ARRAY['summit','volcano']::destination_feature[] AND country_code='US' AND state_code='WA'
      AND ST_DWithin(location,ST_MakePoint(-121.7603,46.8523)::geography,3000)`,[parentId]);
    const park = await client.query(`SELECT id FROM areas WHERE id=$1 AND kind='national_park' AND name='Mount Rainier National Park'`,[parkId]);
    if (parent.rowCount !== 1 || park.rowCount !== 1) throw new Error("Parent/park identity check failed");
    // Check every geometry before the first write; an incomplete or invalid
    // source package must not become a partly visible catalog.
    const preflight=await client.query(`WITH inputs AS (
      SELECT item->>'name' AS name,ST_SetSRID(ST_GeomFromGeoJSON(item->'boundary'),4326) AS g
      FROM jsonb_array_elements($1::jsonb) AS incoming(item)
    ) SELECT i.name FROM inputs i JOIN areas a ON a.id=$2
      WHERE NOT ST_IsValid(i.g) OR ST_IsEmpty(i.g) OR NOT ST_Covers(a.boundary,i.g)`,
      [JSON.stringify(pkg.places.map(p=>({name:p.name,boundary:p.boundary}))),parkId]);
    if (preflight.rows.length) throw new Error(`Invalid/out-of-park source package: ${preflight.rows.map(r=>r.name).join(", ")}`);
    for (const place of pkg.places) {
      await client.query("BEGIN");
      try {
        const shape = await client.query(`SELECT ST_IsValid(g) AS valid,ST_IsEmpty(g) AS empty,ST_GeometryType(g) AS type,
          ST_Covers(a.boundary,g) AS in_park FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g) s
          JOIN areas a ON a.id=$2`,[JSON.stringify(place.boundary),parkId]);
        if (!shape.rows[0]?.valid || shape.rows[0].empty || !shape.rows[0].in_park) throw new Error(`Invalid/out-of-park boundary: ${place.name}`);
        const collision = await client.query(`SELECT id FROM destinations WHERE id=$1 OR external_ids @> $2::jsonb
          OR ($4::jsonb<>'{}'::jsonb AND external_ids @> $4::jsonb)
          OR (owner='peaks' AND lower(name)=lower($3) AND ST_DWithin(location,ST_MakePoint(-121.76,46.85)::geography,30000))`,
          [place.id,JSON.stringify({ [place.osm_key.startsWith("way:") ? "osm_way" : "osm_relation"]: place.osm_key.split(":")[1] }),place.name,JSON.stringify(place.external_ids.wikidata ? {wikidata:place.external_ids.wikidata}:{})]);
        if (collision.rows.some(r => r.id !== place.id)) throw new Error(`Identity collision: ${place.name}`);
        const existing = await client.query(`SELECT owner,external_ids FROM destinations WHERE id=$1 FOR UPDATE`,[place.id]);
        if (existing.rows[0] && (existing.rows[0].owner !== "peaks" || Object.entries(place.external_ids).some(([k,v]) =>
          k === "wikidata" ? existing.rows[0].external_ids?.[k] && existing.rows[0].external_ids[k] !== v
            : existing.rows[0].external_ids?.[k] !== v))) throw new Error(`ID belongs to another place: ${place.id}`);
        const f = place.facts;
        await client.query(`WITH shape AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4),4326) AS g)
          INSERT INTO destinations(id,name,search_name,type,features,activities,owner,country_code,state_code,location,boundary,
            bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng,external_ids,metadata,
            description,description_source_name,description_source_url,description_source_license)
          SELECT $1,$2,peaks_search_name($2),'region',ARRAY['glacier']::destination_feature[],ARRAY['outdoor-trek','ski']::activity_type[],
            'peaks','US','WA',ST_Force3DZ(ST_PointOnSurface(largest.geom))::geography,largest.geom::geography,
            ST_YMin(g),ST_YMax(g),ST_XMin(g),ST_XMax(g),$3::jsonb,$5::jsonb,$6,
            CASE WHEN $6::text IS NULL THEN NULL ELSE 'National Park Service' END,$7,
            CASE WHEN $6::text IS NULL THEN NULL ELSE 'U.S. Government work' END FROM shape
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
          [place.id,place.name,JSON.stringify(place.external_ids),JSON.stringify(place.boundary),JSON.stringify({glacier_catalog: {
            source:"OpenStreetMap",license:"ODbL-1.0",credit:GEOMETRY_CREDIT,snapshot_sha256:SNAPSHOT_SHA256,fetched_at:SNAPSHOT_DATE,
            aliases:place.name==="Inter Glacier"?["Interglacier"]:[] }}),f.description,f.description_source_url]);
        const facts = { ...f, provenance: { ...f.provenance, report_sha256:pkg.report_sha256,
          mountain_context: pkg.mountain_context, source_snapshot_sha256: SNAPSHOT_SHA256 }};
        const parameters: unknown[] = [place.id,parentId,...factColumns.map(c => ["area_history","provenance"].includes(c) ? JSON.stringify(facts[c]) : facts[c]),SNAPSHOT_DATE,
          `https://www.openstreetmap.org/${place.osm_key.replace(":","/")}`,SNAPSHOT_SHA256,JSON.stringify(place.boundary)];
        const columns = ["destination_id","parent_mountain_id",...factColumns,"outline_observed_at","outline_source_url","outline_source_sha256","outline"];
        await client.query(`INSERT INTO destination_glacier_facts(${columns.join(",")}) VALUES(${columns.map((c,i)=>
          c==="outline" ? `ST_SetSRID(ST_GeomFromGeoJSON($${i+1}),4326)::geography` : `$${i+1}`).join(",")})
          ON CONFLICT(destination_id) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=EXCLUDED.${c}`).join(",")},updated_at=now()
          WHERE ${columns.slice(1).map(c=>c==="outline"
            ? "ST_AsEWKB(destination_glacier_facts.outline::geometry) IS DISTINCT FROM ST_AsEWKB(EXCLUDED.outline::geometry)"
            : `destination_glacier_facts.${c} IS DISTINCT FROM EXCLUDED.${c}`).join(" OR ")}`,parameters);
        await client.query(`INSERT INTO destination_areas(destination_id,area_id,relation,source) VALUES($1,$2,'contained_by','postgis')
          ON CONFLICT(destination_id,area_id) DO NOTHING`,[place.id,parkId]);
        await client.query("COMMIT");
        console.log(`Imported ${place.name} (${place.id})`);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    console.log(`Imported ${pkg.places.length} places. Run backfill-glacier-crossings for queued routes and sessions; no backfill runs on detail reads.`);
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) importRainierGlaciers(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode=1; });
