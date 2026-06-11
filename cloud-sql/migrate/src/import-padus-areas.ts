import fs from "fs";
import db from "./db";
import {
  buildLinkDestinationsSql,
  normalizePadusFeature,
  parseGeoJsonFeatures,
  type NormalizedPadusArea,
} from "./padus-area-utils";

interface Args {
  input: string | null;
  sourceVersion: string;
  apply: boolean;
  dryRun: boolean;
  linkDestinations: boolean;
  replaceLinks: boolean;
}

function parseArgs(argv: string[]): Args {
  const inputArg = argv.find((a) => a.startsWith("--input="));
  const versionArg = argv.find((a) => a.startsWith("--source-version="));
  const apply = argv.includes("--apply");
  return {
    input: inputArg ? inputArg.slice("--input=".length) : null,
    sourceVersion: versionArg ? versionArg.slice("--source-version=".length) : "4.1",
    apply,
    dryRun: argv.includes("--dry-run") || !apply,
    linkDestinations: argv.includes("--link-destinations"),
    replaceLinks: argv.includes("--replace-links"),
  };
}

function usage(): string {
  return [
    "Usage:",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --dry-run",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply --link-destinations",
    "  tsx src/import-padus-areas.ts --input=/path/padus.geojson --apply --link-destinations --replace-links",
  ].join("\n");
}

function groupAreas(areas: NormalizedPadusArea[]): Map<string, NormalizedPadusArea[]> {
  const groups = new Map<string, NormalizedPadusArea[]>();
  for (const area of areas) {
    const list = groups.get(area.groupKey);
    if (list) list.push(area);
    else groups.set(area.groupKey, [area]);
  }
  return groups;
}

async function createTempTable(): Promise<void> {
  await db.query(`
    CREATE TEMP TABLE padus_area_import_parts (
      group_key text NOT NULL,
      id text NOT NULL,
      name text NOT NULL,
      search_name text NOT NULL,
      kind area_kind NOT NULL,
      designation text,
      manager text,
      owner_name text,
      country_code text NOT NULL,
      state_codes text[] NOT NULL,
      source text NOT NULL,
      source_id text NOT NULL,
      source_version text NOT NULL,
      source_record_id text NOT NULL,
      metadata jsonb NOT NULL,
      geom geometry(MultiPolygon, 4326) NOT NULL
    ) ON COMMIT DROP
  `);
}

async function insertParts(areas: NormalizedPadusArea[]): Promise<void> {
  for (const area of areas) {
    await db.query(
      `INSERT INTO padus_area_import_parts (
         group_key, id, name, search_name, kind, designation, manager,
         owner_name, country_code, state_codes, source, source_id,
         source_version, source_record_id, metadata, geom
       ) VALUES (
         $1, $2, $3, $4, $5::area_kind, $6, $7,
         $8, 'US', $9::text[], $10, $11,
         $12, $13, $14::jsonb,
         ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($15), 4326)), 3))
       )`,
      [
        area.groupKey,
        area.sourceId,
        area.name,
        area.searchName,
        area.kind,
        area.designation,
        area.manager,
        area.owner,
        area.stateCodes,
        area.source,
        area.sourceId,
        area.sourceVersion,
        area.sourceRecordId,
        JSON.stringify(area.metadata),
        JSON.stringify(area.geometry),
      ]
    );
  }
}

async function upsertAreas(): Promise<number> {
  const result = await db.query(`
    WITH dissolved AS (
      SELECT
        group_key,
        min(id) AS id,
        min(name) AS name,
        min(search_name) AS search_name,
        min(kind::text)::area_kind AS kind,
        min(designation) AS designation,
        min(manager) AS manager,
        min(owner_name) AS owner_name,
        'US' AS country_code,
        ARRAY(
          SELECT DISTINCT code
          FROM padus_area_import_parts p2, unnest(p2.state_codes) AS code
          WHERE p2.group_key = p.group_key
          ORDER BY code
        ) AS state_codes,
        min(source) AS source,
        min(source_id) AS source_id,
        min(source_version) AS source_version,
        jsonb_build_object(
          'source_record_ids', jsonb_agg(DISTINCT source_record_id),
          'parts', jsonb_agg(metadata)
        ) AS metadata,
        ST_Multi(ST_Union(geom)) AS geom
      FROM padus_area_import_parts p
      GROUP BY group_key
    ),
    prepared AS (
      SELECT
        id, name, search_name, kind, designation, manager, owner_name,
        country_code, state_codes, source, source_id, source_version,
        metadata,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)) AS geom
      FROM dissolved
      WHERE NOT ST_IsEmpty(geom)
    )
    INSERT INTO areas (
      id, name, search_name, kind, designation, manager, owner,
      country_code, state_codes, source, source_id, source_version,
      boundary, centroid,
      bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
      metadata, created_at, updated_at
    )
    SELECT
      id, name, search_name, kind, designation, manager, owner_name,
      country_code, state_codes, source, source_id, source_version,
      geom::geography,
      ST_Centroid(geom)::geography,
      ST_YMin(Box2D(geom)),
      ST_YMax(Box2D(geom)),
      ST_XMin(Box2D(geom)),
      ST_XMax(Box2D(geom)),
      metadata,
      NOW(), NOW()
    FROM prepared
    ON CONFLICT (source, source_id) DO UPDATE SET
      name = EXCLUDED.name,
      search_name = EXCLUDED.search_name,
      kind = EXCLUDED.kind,
      designation = EXCLUDED.designation,
      manager = EXCLUDED.manager,
      owner = EXCLUDED.owner,
      state_codes = EXCLUDED.state_codes,
      source_version = EXCLUDED.source_version,
      boundary = EXCLUDED.boundary,
      centroid = EXCLUDED.centroid,
      bbox_min_lat = EXCLUDED.bbox_min_lat,
      bbox_max_lat = EXCLUDED.bbox_max_lat,
      bbox_min_lng = EXCLUDED.bbox_min_lng,
      bbox_max_lng = EXCLUDED.bbox_max_lng,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `);
  return result.rowCount ?? 0;
}

async function linkDestinations(replaceLinks: boolean): Promise<number> {
  const result = await db.query<{ inserted_count: number | string }>(
    buildLinkDestinationsSql(replaceLinks)
  );
  const value = result.rows[0]?.inserted_count ?? 0;
  return typeof value === "number" ? value : parseInt(value, 10);
}

async function report(): Promise<void> {
  const byKind = await db.query(
    `SELECT kind, count(*)::int AS count FROM areas GROUP BY kind ORDER BY kind`
  );
  console.log("Areas by kind:");
  for (const row of byKind.rows) {
    console.log(`  ${row.kind}: ${row.count}`);
  }

  const linked = await db.query(`
    SELECT count(DISTINCT destination_id)::int AS linked_destinations,
           count(*)::int AS links
    FROM destination_areas
  `);
  console.log(`Linked summit destinations: ${linked.rows[0].linked_destinations}`);
  console.log(`Destination-area links: ${linked.rows[0].links}`);
}

export async function importPadusAreas(args: Args): Promise<void> {
  if (!args.input) {
    throw new Error(`${usage()}\n\n--input is required`);
  }

  const contents = fs.readFileSync(args.input, "utf8");
  const features = parseGeoJsonFeatures(contents);
  const normalized = features
    .map((feature) => normalizePadusFeature(feature, args.sourceVersion))
    .filter((area): area is NormalizedPadusArea => area !== null);
  const groups = groupAreas(normalized);

  console.log(`Read features: ${features.length}`);
  console.log(`Importable PAD-US area parts: ${normalized.length}`);
  console.log(`Dissolved logical areas: ${groups.size}`);

  const byKind = new Map<string, number>();
  for (const area of normalized) {
    byKind.set(area.kind, (byKind.get(area.kind) ?? 0) + 1);
  }
  for (const [kind, count] of Array.from(byKind.entries()).sort()) {
    console.log(`  ${kind}: ${count}`);
  }

  if (args.dryRun) {
    console.log("DRY RUN - no rows written. Re-run with --apply to persist.");
    return;
  }

  await db.query("BEGIN");
  try {
    await createTempTable();
    await insertParts(normalized);
    const upserted = await upsertAreas();
    console.log(`Upserted areas: ${upserted}`);

    if (args.linkDestinations) {
      const linked = await linkDestinations(args.replaceLinks);
      console.log(`Inserted destination-area links: ${linked}`);
    }

    await db.query("COMMIT");
    await report();
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

if (process.argv[1]?.includes("import-padus-areas")) {
  const args = parseArgs(process.argv.slice(2));
  importPadusAreas(args)
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await db.end();
      process.exit(1);
    });
}
