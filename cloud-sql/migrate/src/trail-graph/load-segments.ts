import { join } from 'node:path';
import { args, DEFAULT_OUT, ndjson, option } from './io';
import type { Segment } from './types';

// Keep the state list in sync with guard_trail_catalog_reviewed_links(). The DB
// trigger remains the final guard if a review changes while this loader runs.
export const UPSERT_SEGMENT = `
  INSERT INTO segments (id, name, display_name, kind, state_code, trail_names, path, distance, provenance, description, description_source_url)
  VALUES ($1,$2,$8,$3,'WA',$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326)::geography,$6,$7::jsonb,$9,$10)
  ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_name=EXCLUDED.display_name,
    description=EXCLUDED.description, description_source_url=EXCLUDED.description_source_url,
    kind=EXCLUDED.kind, state_code='WA', trail_names=EXCLUDED.trail_names,
    path=EXCLUDED.path, distance=EXCLUDED.distance, provenance=EXCLUDED.provenance,
    polyline6=NULL, gain=NULL, gain_loss=NULL, updated_at=now()
  WHERE NOT EXISTS (
    SELECT 1 FROM route_segments rs
    JOIN trail_catalog_review_jobs review ON review.route_id=rs.route_id
    WHERE rs.segment_id=segments.id
      AND review.state IN ('approved','publish_leased','published','verify_leased','verified','rejected')
  ) RETURNING id`;

export function segmentValues(s: Segment): unknown[] {
  if (!s.id || !s.coords || s.coords.length < 2 || s.coords.some(c => !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) || !(s.length_m > 0)) throw new Error(`Invalid segment geometry: ${s.id}`);
  if (!['trail', 'road', 'snowfield', 'glacier', 'scramble', 'climb', 'xc'].includes(s.kind)) throw new Error(`Invalid segment kind: ${s.kind}`);
  return [s.id, s.name, s.kind, s.trail_names, JSON.stringify({ type: 'LineString', coordinates: s.coords.map(c => [c[0], c[1], 0]) }), s.length_m, JSON.stringify(s.provenance), s.display_name === undefined ? s.trail_names[0] || s.relation_names[0] || null : s.display_name, s.description ?? null, null];
}
export async function loadSegments(path: string, apply = false): Promise<void> {
  const report = { mode: apply ? 'apply' : 'dry-run', validated: 0, upserted: 0, skipped_reviewed: 0, reviewed_status: apply ? 'checked by SQL and trigger' : 'unknown; no database connection' };
  if (!apply) {
    for await (const s of ndjson<Segment>(path)) { segmentValues(s); report.validated++; }
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (!process.env.DATABASE_URL) throw new Error('--apply requires DATABASE_URL');
  // Import pg only after explicit --apply. Do not import the shared DB module or .env.
  const { Client } = await import('pg'); const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    for await (const s of ndjson<Segment>(path)) {
      const values = segmentValues(s); report.validated++; await client.query('SAVEPOINT segment_load');
      try {
        const result = await client.query(UPSERT_SEGMENT, values);
        if (result.rowCount) report.upserted++; else { report.skipped_reviewed++; console.log(`Skipped reviewed segment ${s.id}`); }
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
  const options = args(); loadSegments(join(option(options, 'out', DEFAULT_OUT), 'segments.ndjson'), options.has('apply')).catch(e => { console.error(e.message); process.exitCode = 1; });
}
