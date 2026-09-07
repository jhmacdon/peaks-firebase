import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { LookoutDestination, LookoutSource, auditedLookoutFeatures, matchLookout, validCoordinates } from "./lib/fire-lookouts";

function option(name: string): string | undefined {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface LookoutAudit {
  destinationId: string;
  name: string;
  action: "keep_fire_lookout" | "remove_fire_lookout" | "replace_fire_lookout_with_viewpoint";
  status: string;
  sources: Array<{url: string; [key: string]: unknown}>;
  note?: string;
}

async function main() {
  const input = option("input");
  const reportPath = option("report");
  const verifiedOn = option("verified-on");
  const apply = process.argv.includes("--apply");
  if (!input || !reportPath || !verifiedOn || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) {
    throw new Error("Required: --input=sources.json --report=report.json --verified-on=YYYY-MM-DD; defaults to dry run");
  }
  const sources: LookoutSource[] = JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(sources) || !sources.length) throw new Error("Source inventory is empty");
  const seen = new Set<string>();
  for (const source of sources) {
    if (!["ffla", "osm", "official"].includes(source.source) || !source.sourceId ||
        !source.name || !source.status || !validCoordinates(source.lat, source.lng) ||
        !/^https:\/\//.test(source.url)) throw new Error(`Invalid source: ${JSON.stringify(source)}`);
    const key = `${source.source}:${source.sourceId}`;
    if (seen.has(key)) throw new Error(`Duplicate source: ${key}`);
    seen.add(key);
  }
  const catalog = option("catalog");
  const auditPath = option("audit");
  const audit: LookoutAudit[] = auditPath ? JSON.parse(readFileSync(auditPath, "utf8")).records : [];
  if (!Array.isArray(audit)) throw new Error("Audit must contain a records array");
  const auditedIds = new Set<string>();
  for (const record of audit) {
    if (!record.destinationId || !record.name || !record.status ||
        !["keep_fire_lookout", "remove_fire_lookout", "replace_fire_lookout_with_viewpoint"].includes(record.action) ||
        !Array.isArray(record.sources) || !record.sources.length || record.sources.some(source => !/^https:\/\//.test(source.url)) ||
        auditedIds.has(record.destinationId)) throw new Error("Invalid or duplicate audit record");
    auditedIds.add(record.destinationId);
  }
  if (apply && catalog) throw new Error("Apply must read the live catalog");
  const pool = catalog ? null : new Pool({host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || "peaks",
    user: process.env.DB_USER || "peaks-api", password: process.env.DB_PASS, max: 1});
  try {
    const destinations: LookoutDestination[] = catalog ? JSON.parse(readFileSync(catalog, "utf8")) :
      (await pool!.query(`SELECT id, name, ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng, features::text[] AS features FROM destinations
        WHERE owner='peaks' ORDER BY id`)).rows;
    const matches = destinations.flatMap(destination => sources
      .filter(source => destination.lat !== null && (Math.abs(source.lat - destination.lat) < 0.005 ||
        source.reviewedMatches?.some(match => match.destinationId === destination.id)))
      .flatMap(source => { const match = matchLookout(destination, source); return match ? [match] : []; }));
    const matchedIds = [...new Set(matches.map(match => match.destinationId))];
    const matchedSourceIds = new Set(matches.map(match => `${match.source.source}:${match.source.sourceId}`));
    const changes = destinations.filter(destination => matchedIds.includes(destination.id) &&
      !destination.features.includes("fire-lookout"));
    for (const record of audit) {
      const destination = destinations.find(d => d.id === record.destinationId);
      if (!destination || destination.name !== record.name) throw new Error(`Audit identity mismatch: ${record.destinationId}`);
      if (record.action !== "keep_fire_lookout" && matchedIds.includes(record.destinationId)) {
        throw new Error(`Standing source conflicts with audit: ${record.destinationId}`);
      }
    }
    const reviewDigest = createHash("sha256").update(JSON.stringify({verifiedOn, matches, audit})).digest("hex");
    const report = {verifiedOn, mode: apply ? "apply" : "dry-run", catalogCount: destinations.length,
      sourceCount: sources.length, matchedCount: matchedIds.length, newTagCount: changes.length, reviewDigest,
      matches, audit, unmatchedSources: sources.filter(source => !matchedSourceIds.has(`${source.source}:${source.sourceId}`)),
      sharedSources: sources.flatMap(source => {
        const ids = matches.filter(m => m.source.source === source.source && m.source.sourceId === source.sourceId)
          .map(m => m.destinationId);
        return ids.length > 1 ? [{source, destinationIds: ids}] : [];
      }),
      unmatchedExisting: destinations.filter(destination => destination.features.includes("fire-lookout") &&
        !matchedIds.includes(destination.id)), changedRows: 0};
    // Persist the exact reviewed matches before opening a write transaction.
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    if (apply) {
      const expected = option("expected-count");
      if (!expected || Number(expected) !== matchedIds.length) {
        throw new Error(`Expected-count must equal reviewed matched count (${matchedIds.length})`);
      }
      if (option("expected-digest") !== reviewDigest) throw new Error(`Expected-digest must equal reviewed match digest (${reviewDigest})`);
      const client = await pool!.connect();
      let committed = false;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='30s'");
        for (const id of matchedIds) {
          const destination = destinations.find(d => d.id === id)!;
          const evidence = {status: "standing", verifiedOn, sources: matches.filter(m => m.destinationId === id)
            .map(({source, distanceMeters, method}) => ({...source, distanceMeters, method}))};
          const locked = await client.query(`SELECT
              ('fire-lookout'=ANY(features) AND metadata->'fire_lookout'=$2::jsonb) AS unchanged
            FROM destinations WHERE id=$1 AND owner='peaks' AND name IS NOT DISTINCT FROM $3
              AND ST_Y(location::geometry) IS NOT DISTINCT FROM $4::double precision
              AND ST_X(location::geometry) IS NOT DISTINCT FROM $5::double precision
              AND features::text[]=$6::text[]
              AND (metadata IS NULL OR jsonb_typeof(metadata)='object') FOR UPDATE`,
          [id, JSON.stringify(evidence), destination.name, destination.lat, destination.lng, destination.features]);
          if (locked.rowCount !== 1) throw new Error(`Destination changed or metadata is not an object: ${id}`);
          if (locked.rows[0].unchanged) continue;
          const result = await client.query(`UPDATE destinations SET
              features=CASE WHEN 'fire-lookout'=ANY(features) THEN features
                ELSE array_append(features, 'fire-lookout'::destination_feature) END,
              metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb), '{fire_lookout}', $2::jsonb)
            WHERE id=$1 AND owner='peaks' AND name IS NOT DISTINCT FROM $3
              AND ST_Y(location::geometry) IS NOT DISTINCT FROM $4::double precision
              AND ST_X(location::geometry) IS NOT DISTINCT FROM $5::double precision
              AND features::text[]=$6::text[]
              AND (metadata IS NULL OR jsonb_typeof(metadata)='object')
            RETURNING id`, [id, JSON.stringify(evidence), destination.name, destination.lat, destination.lng, destination.features]);
          if (result.rowCount !== 1) throw new Error(`Destination changed or metadata is not an object: ${id}`);
          report.changedRows++;
        }
        for (const record of audit) {
          if (record.action === "keep_fire_lookout" && matchedIds.includes(record.destinationId)) continue;
          const destination = destinations.find(d => d.id === record.destinationId)!;
          const evidence = {status: record.status, verifiedOn, sources: record.sources, ...(record.note ? {note: record.note} : {})};
          const features = auditedLookoutFeatures(destination.features, record.action);
          const locked = await client.query(`SELECT (features::text[]=$2::text[] AND metadata->'fire_lookout'=$3::jsonb) AS unchanged
            FROM destinations WHERE id=$1 AND owner='peaks' AND name=$4
              AND features::text[]=$5::text[]
              AND ST_Y(location::geometry) IS NOT DISTINCT FROM $6::double precision
              AND ST_X(location::geometry) IS NOT DISTINCT FROM $7::double precision
              AND (metadata IS NULL OR jsonb_typeof(metadata)='object') FOR UPDATE`,
          [destination.id, features, JSON.stringify(evidence), destination.name, destination.features, destination.lat, destination.lng]);
          if (locked.rowCount !== 1) throw new Error(`Audit destination changed: ${destination.id}`);
          if (locked.rows[0].unchanged) continue;
          await client.query(`UPDATE destinations SET features=$2::destination_feature[],
            metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb), '{fire_lookout}', $3::jsonb) WHERE id=$1`,
          [destination.id, features, JSON.stringify(evidence)]);
          report.changedRows++;
        }
        const check = await client.query(`SELECT id FROM destinations
          WHERE id=ANY($1::text[]) AND NOT ('fire-lookout'=ANY(features))`, [matchedIds]);
        if (check.rowCount) throw new Error("Post-write feature verification failed");
        await client.query("COMMIT");
        committed = true;
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      } catch (error) {
        if (committed) throw new Error(`Database COMMITTED, but writing the final report failed: ${error}`);
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
    console.log(JSON.stringify({mode: report.mode, catalogCount: report.catalogCount,
      sourceCount: sources.length, matchedCount: matchedIds.length, newTagCount: changes.length,
      unmatchedExisting: report.unmatchedExisting.length, reviewDigest, changedRows: report.changedRows}));
  } finally { await pool?.end(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
