/** Read-only catalog scan. Findings are review candidates, never rename instructions. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface StretchRow {
  id: string;
  ordinal: number;
  direction: string;
  display_name: string | null;
  trail_names: string[];
  kind: string | null;
  distance: number | null;
}
export interface StretchRoute {
  id: string;
  name: string | null;
  status: string;
  state_code: string | null;
  section_count: number;
  segments: StretchRow[];
}
export interface NameFinding {
  code: 'missing_segments' | 'missing_segment' | 'unnamed_ice' | 'ice_named_as_trail' | 'ice_uses_path_name'
    | 'name_repeated_across_kinds' | 'adjacent_name_variants' | 'adjacent_trail_aliases';
  ordinals: number[];
  segment_ids: string[];
  names: (string | null)[];
  kinds: (string | null)[];
}

// No geometry, private routes, sessions, or user data. Keep routes without links
// in the snapshot so lack of coverage cannot look like a clean result.
export const STRETCH_SNAPSHOT_SQL = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '300s';
SET LOCAL work_mem = '32MB';
SET LOCAL max_parallel_workers_per_gather = 0;
DECLARE stretch_names NO SCROLL CURSOR FOR
WITH catalog AS MATERIALIZED (
  SELECT id, name, status, state_code FROM routes
  WHERE owner = 'peaks' AND status IN ('active', 'pending')
), links AS MATERIALIZED (
  SELECT rs.route_id, rs.segment_id, rs.ordinal, rs.direction
  FROM route_segments rs JOIN catalog c ON c.id = rs.route_id
), names AS MATERIALIZED (
  SELECT s.id, s.display_name, s.trail_names, s.kind, s.distance
  FROM segments s
), sections AS (
  SELECT route_id, count(*)::int AS n FROM route_sections GROUP BY route_id
)
SELECT jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
  'state_code', c.state_code, 'section_count', COALESCE(sections.n, 0), 'segments', '[]'::jsonb)
FROM catalog c LEFT JOIN sections ON sections.route_id = c.id
UNION ALL
SELECT jsonb_build_object('record', 'segment', 'route_id', rs.route_id,
  'id', rs.segment_id, 'ordinal', rs.ordinal, 'direction', rs.direction,
  'display_name', s.display_name, 'trail_names', COALESCE(s.trail_names, ARRAY[]::text[]),
  'kind', s.kind, 'distance', s.distance)
FROM links rs LEFT JOIN names s ON s.id = rs.segment_id;
-- Bound the number of fetches by all rows in the two source tables. The cursor
-- itself only contains public catalog rows; empty fetches produce no output.
SELECT 'FETCH FORWARD 5000 FROM stretch_names;' FROM generate_series(1,
  ceil(((SELECT count(*) FROM routes) + (SELECT count(*) FROM route_segments)) / 5000.0)::int + 1)
\\gexec
CLOSE stretch_names;
COMMIT;`;

const key = (name: string | null): string => (name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const ice = (kind: string | null) => kind === 'glacier' || kind === 'snowfield';
const trailWord = /\b(?:trail|path|road|footpath)\b/i;

export function auditStretchNames(route: StretchRoute): NameFinding[] {
  const findings: NameFinding[] = [];
  const add = (code: NameFinding['code'], rows: StretchRow[]) => findings.push({
    code, ordinals: rows.map(s => s.ordinal), segment_ids: rows.map(s => s.id),
    names: rows.map(s => s.display_name), kinds: rows.map(s => s.kind),
  });
  const segments = [...route.segments].sort((a, b) => a.ordinal - b.ordinal);
  if (!segments.length) { add('missing_segments', []); return findings; }
  for (const segment of segments) {
    if (!segment.kind) add('missing_segment', [segment]);
    else if (ice(segment.kind)) {
      if (!key(segment.display_name)) add('unnamed_ice', [segment]);
      else if (trailWord.test(segment.display_name!)) add('ice_named_as_trail', [segment]);
      else if (!/\b(?:glacier|snowfield|crossing)\b/i.test(segment.display_name!)
        && segment.trail_names.some(name => key(name) === key(segment.display_name))) add('ice_uses_path_name', [segment]);
    }
  }
  // Mirror the app's adjacent name/kind folding. Repeated source segments with
  // one name and kind already render once; a later return to a trail is valid.
  for (let from = 0; from < segments.length;) {
    let to = from + 1;
    const name = key(segments[from].display_name);
    while (name && to < segments.length && segments[to].ordinal === segments[to - 1].ordinal + 1
      && key(segments[to].display_name) === name) to++;
    const run = segments.slice(from, to);
    if (name && new Set(run.map(s => s.kind)).size > 1) add('name_repeated_across_kinds', run);
    if (name && new Set(run.map(s => s.display_name)).size > 1) add('adjacent_name_variants', run);
    from = to;
  }
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1], b = segments[i];
    if (b.ordinal !== a.ordinal + 1 || a.kind !== 'trail' || b.kind !== 'trail'
      || !key(a.display_name) || !key(b.display_name) || key(a.display_name) === key(b.display_name)) continue;
    const aliases = new Set(a.trail_names.map(key).filter(Boolean));
    if (b.trail_names.some(n => aliases.has(key(n)))) add('adjacent_trail_aliases', [a, b]);
  }
  return findings;
}

export function auditCatalogStretchNames(routes: StretchRoute[]) {
  const ids = new Set<string>();
  for (const route of routes) {
    if (ids.has(route.id)) throw new Error(`Duplicate snapshot route: ${route.id}`);
    ids.add(route.id);
  }
  const byStatus: Record<string, number> = {}, counts: Record<string, number> = {};
  const findings = routes.flatMap(route => {
    byStatus[route.status] = (byStatus[route.status] ?? 0) + 1;
    const issues = auditStretchNames(route);
    for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    return issues.length ? [{ id: route.id, name: route.name, status: route.status,
      state_code: route.state_code, section_count: route.section_count, issues }] : [];
  });
  return {
    scope: "All Peaks-owned active and pending routes; superseded and private routes excluded.",
    limitation: 'This checks stored labels, not terrain accuracy or outside-source identity. Findings require review; no names or terrain types are changed.',
    summary: {
      routes: routes.length, by_status: byStatus,
      segment_links: routes.reduce((n, r) => n + r.segments.length, 0),
      unique_segments: new Set(routes.flatMap(r => r.segments.map(s => s.id))).size,
      routes_without_segments: routes.filter(r => !r.segments.length).length,
      routes_with_label_findings: findings.filter(r => r.issues.some(i => !['missing_segments', 'missing_segment'].includes(i.code))).length,
      routes_with_findings: findings.length, findings_by_code: counts,
    }, findings,
  };
}

export function parseSnapshot(text: string): StretchRoute[] {
  const records = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const routes = records.filter(row => row.record !== 'segment') as StretchRoute[];
  const byId = new Map(routes.map(row => [row.id, row]));
  if (byId.size !== routes.length) throw new Error('Duplicate snapshot route');
  for (const row of records.filter(row => row.record === 'segment')) {
    const parent = byId.get(row.route_id);
    if (!parent || !Array.isArray(parent.segments)) throw new Error(`Segment without route: ${row.route_id}`);
    const { record, route_id, ...segment } = row;
    parent.segments.push(segment);
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id)).map((route, index) => {
    if (!route || typeof route.id !== 'string' || !['active', 'pending'].includes(route.status)
      || !Array.isArray(route.segments) || !Number.isInteger(route.section_count)) {
      throw new Error(`Invalid route snapshot at line ${index + 1}`);
    }
    const ordinals = new Set<number>();
    for (const s of route.segments) {
      if (!s || typeof s.id !== 'string' || !Number.isInteger(s.ordinal) || s.ordinal < 0
        || ordinals.has(s.ordinal) || !Array.isArray(s.trail_names) || s.trail_names.some(n => typeof n !== 'string')
        || !(s.display_name === null || typeof s.display_name === 'string')
        || !(s.kind === null || typeof s.kind === 'string')) throw new Error(`Invalid segment at line ${index + 1}`);
      ordinals.add(s.ordinal);
    }
    return route;
  });
}

function main(args: string[]) {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output', '--snapshot'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: audit-trail-stretch-names.ts --output report.json [--input snapshot.ndjson | --snapshot snapshot.ndjson]');
    }
    if (options.has(args[i])) throw new Error(`Duplicate option: ${args[i]}`);
    options.set(args[i], args[i + 1]);
  }
  const output = options.get('--output'), input = options.get('--input'), snapshot = options.get('--snapshot');
  if (!output || (input && snapshot)) throw new Error('Require --output and at most one of --input or --snapshot');
  if ([input, snapshot].some(p => p && resolve(p) === resolve(output))) throw new Error('Report and snapshot paths must differ');
  for (const target of [output, snapshot]) if (target && existsSync(target)) throw new Error(`Output already exists: ${target}`);
  let source: string;
  if (input) source = readFileSync(input, 'utf8');
  else {
    const result = spawnSync(resolve(__dirname, '../../scripts/peaks-psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      input: STRETCH_SNAPSHOT_SQL, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_200_000,
      env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=300000' },
    });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `Snapshot exited ${result.status}`);
    source = result.stdout;
  }
  const report = auditCatalogStretchNames(parseSnapshot(source));
  if (!report.summary.routes) throw new Error('Empty catalog snapshot; audit is incomplete');
  if (snapshot) writeFileSync(snapshot, source, { flag: 'wx' });
  writeFileSync(output, JSON.stringify({ generated_at: new Date().toISOString(),
    snapshot_sha256: createHash('sha256').update(source).digest('hex'), ...report }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report.summary, null, 2));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
