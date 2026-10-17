import { readFileSync } from 'node:fs';
import pgm from 'pg'; const pg: any = (pgm as any).default ?? pgm;
const mod: any = await import('./src/trail-graph/load-bulk-preflight.ts'); const BULK_PREFLIGHT_SQL: string = mod.BULK_PREFLIGHT_SQL ?? mod.default.BULK_PREFLIGHT_SQL;
const v = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-josiahm-projects-peaks/1cf2aca3-97f5-48e5-b472-e14b5223aaf6/scratchpad/pf-values.json','utf8'));
const head = BULK_PREFLIGHT_SQL.slice(0, BULK_PREFLIGHT_SQL.indexOf('), overlap_rows AS ('));
const ov = BULK_PREFLIGHT_SQL.slice(BULK_PREFLIGHT_SQL.indexOf('), overlap_rows AS (') + 20, BULK_PREFLIGHT_SQL.lastIndexOf(')\nSELECT to_regprocedure'));
const [segArm, routeArm] = ov.split('\n  UNION\n');
const tail = BULK_PREFLIGHT_SQL.slice(BULK_PREFLIGHT_SQL.lastIndexOf(')\nSELECT to_regprocedure') + 2);
const pick = (name: string) => { const i = tail.indexOf("COALESCE((SELECT jsonb_agg(jsonb_build_object('id'," + name); return i; };
const arms: Record<string,string> = {
  seg_overlap: head + ')\nSELECT count(*) FROM (' + segArm + ') x',
  route_overlap: head + ')\nSELECT count(*) FROM (' + routeArm + ') x',
  destinations: head + ')\n' + 'SELECT ' + tail.slice(tail.indexOf("COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id"), tail.indexOf(' AS destinations,')) + ' AS d',
  existing_segments: head + ')\n' + 'SELECT ' + tail.slice(tail.indexOf("COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id"), tail.indexOf(' AS segments,')) + ' AS s',
};
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query("SET statement_timeout='90s'");
for (const [k, sql] of Object.entries(arms)) {
  const used = [1,2,3,4,5].filter(n => sql.includes('$'+n));
  const t = Date.now();
  try { const r = await c.query(sql.replace(/\$(\d)/g, (_m, n) => '$' + (used.indexOf(Number(n)) + 1)), used.map(n => v[n-1])); console.log(k, Date.now()-t, 'ms', JSON.stringify(r.rows[0]).slice(0,80)); }
  catch (e) { console.log(k, Date.now()-t, 'ms ERR', (e as Error).message); }
}
await c.end();
