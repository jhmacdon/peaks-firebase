import { join } from 'node:path';
import { DEFAULT_OUT, ndjson, option } from './io';
import { loaderArgs } from './loader-cli';
import { assertDisplayName, displayName } from './display-names';
import type { Segment } from './types';
import { DEFER_REMATCH_SQL } from './load-sql';

// Geometry and elevation are immutable here. A conflicting ID is inspected,
// never reset to Z=0. XY changes require a new segment ID and explicit review.
export const UPSERT_SEGMENT = `INSERT INTO segments
  (id,name,display_name,kind,state_code,trail_names,path,distance,provenance,description,description_source_url)
  VALUES($1,$2,$8,$3,'WA',$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6,$7::jsonb,$9,$10)
  ON CONFLICT(id) DO NOTHING RETURNING id`;
export const SEGMENT_CONFLICT = `SELECT
  ST_OrderingEquals(ST_Force2D(path::geometry),ST_Force2D(ST_GeomFromGeoJSON($2))) AS same_xy,
  gain IS NOT NULL OR EXISTS(SELECT 1 FROM ST_DumpPoints(path::geometry) p WHERE ST_Z((p).geom)<>0) AS has_elevation,
  EXISTS(SELECT 1 FROM route_segments rs JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id
    WHERE rs.segment_id=segments.id AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')) AS protected
  FROM segments WHERE id=$1`;

export function segmentValues(s: Segment): unknown[] {
  if (s.frozen_partial || s.frozen_catalog) throw new Error(`Frozen catalog geometry is not insertable: ${s.id}`);
  if (!s.id || !s.coords || s.coords.length < 2 || s.coords.some(c => !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) || !(s.length_m > 0)) throw new Error(`Invalid segment geometry: ${s.id}`);
  if (!['trail', 'road', 'snowfield', 'glacier', 'scramble', 'climb', 'xc'].includes(s.kind)) throw new Error(`Invalid segment kind: ${s.kind}`);
  const name = s.display_name === undefined ? displayName(s.trail_names[0] || s.relation_names[0] || null) : s.display_name;
  assertDisplayName(name);
  return [s.id, s.name, s.kind, s.trail_names, JSON.stringify({ type: 'LineString', coordinates: s.coords.map(c => [c[0], c[1], 0]) }), s.length_m, JSON.stringify(s.provenance), name, s.description ?? null, null];
}
export async function loadSegments(path: string, apply = false): Promise<void> {
  const report = { mode: apply ? 'apply' : 'dry-run', validated: 0, upserted: 0, skipped_reviewed: 0, skipped_frozen: 0, existing_unchanged: 0, xy_conflicts: 0, reviewed_status: apply ? 'checked by SQL and trigger' : 'unknown; no database connection' };
  if (!apply) {
    for await (const s of ndjson<Segment>(path)) { if (s.frozen_catalog || s.frozen_partial) { report.skipped_frozen++; continue; } segmentValues(s); report.validated++; }
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  // Import pg only after explicit --apply. Do not import the shared DB module or .env.
  const { Client } = await import('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(DEFER_REMATCH_SQL);
    for await (const s of ndjson<Segment>(path)) {
      if (s.frozen_catalog || s.frozen_partial) { report.skipped_frozen++; continue; }
      const values = segmentValues(s); report.validated++; await client.query('SAVEPOINT segment_load');
      try {
        const result = await client.query(UPSERT_SEGMENT, values);
        if (result.rowCount) report.upserted++; else {
          const existing = (await client.query(SEGMENT_CONFLICT, [s.id, values[4]])).rows[0];
          if (existing?.protected) report.skipped_reviewed++;
          if (existing?.same_xy) report.existing_unchanged++; else report.xy_conflicts++;
          console.log(`Existing segment ${s.id}: ${existing?.same_xy ? 'unchanged; elevation preserved' : 'XY differs; skipped, use a new ID'}`);
        }
        await client.query('RELEASE SAVEPOINT segment_load');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT segment_load');
        if (error instanceof Error && error.message.includes('catalog reviewed source segment is immutable')) {
          report.skipped_reviewed++; console.log(`Skipped reviewed segment ${s.id} (concurrent review)`);
          await client.query('RELEASE SAVEPOINT segment_load');
        } else throw error;
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) {
  try { const options = loaderArgs(process.argv.slice(2), 'segments'); loadSegments(join(option(options, 'out', DEFAULT_OUT), 'segments.ndjson'), options.has('apply')).catch(e => { console.error(e.message); process.exitCode = 1; }); }
  catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
