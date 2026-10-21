import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { lines, ndjson, writeNdjson } from './io';
import { parseState, type StateCode } from './state';
import type { ComposedRoute, PlaceRef } from './catalog-types';
import type { Segment } from './types';

export type FinalOrder = 'source' | 'research-first';
export interface SelectFinalOptions { state: StateCode; from: string; out: string; order?: FinalOrder }
export interface SelectFinalResult {
  state_code: StateCode; order: FinalOrder; input_routes: number; before_end_filter: number;
  excluded_named_trail_routes: number; excluded_end_routes: number; after_end_filter: number; research_routes: number;
}
interface SelectedRoute { route_id: string; name: string; segment_ids: string[]; line: string }
const RESEARCH_SAC = new Set(['demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking']);

export function selectFinalArgs(argv = process.argv.slice(2)): SelectFinalOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i], match = /^--(state|from|out|order)(?:=(.*))?$/.exec(raw);
    if (!match) throw new Error(`Unknown argument ${JSON.stringify(raw)}`);
    const key = match[1];
    if (values.has(key)) throw new Error(`Duplicate argument --${key}`);
    const value = match[2] ?? argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    values.set(key, value);
  }
  for (const key of ['state', 'from', 'out']) if (!values.has(key)) throw new Error(`--${key} is required`);
  const options = { state: parseState(values.get('state')!), from: values.get('from')!, out: values.get('out')!, order: values.get('order') as FinalOrder | undefined };
  validateOptions(options);
  return options;
}
function validateOptions(options: SelectFinalOptions): void {
  parseState(options.state);
  if (!options.from || !options.out) throw new Error('--from and --out require directories');
  if (options.order !== undefined && options.order !== 'source' && options.order !== 'research-first') throw new Error('--order must be source or research-first');
  if (resolve(options.from) === resolve(options.out)) throw new Error('--from and --out must be different directories');
}
export function isNewEnd(ref: PlaceRef | null | undefined): boolean {
  return !ref?.peaks_id && !!ref?.new && ref.new.feature !== 'trailhead' && ref.new.name.endsWith(' End');
}
export function needsResearch(segment: Pick<Segment, 'kind' | 'sac_scale'>): boolean {
  return segment.kind === 'glacier' || segment.kind === 'snowfield' || RESEARCH_SAC.has(segment.sac_scale ?? '');
}
/** Resolve an output path even when its last directories do not exist yet. */
async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
async function writeLines(path: string, records: Iterable<string>): Promise<void> {
  const stream = createWriteStream(path), done = finished(stream); done.catch(() => {});
  try {
    for (const line of records) if (!stream.write(line + '\n')) await once(stream, 'drain');
    stream.end(); await done;
  } finally { stream.destroy(); }
}

/** Select complete route records without changing their hashes or segment data. */
export async function selectFinal(options: SelectFinalOptions): Promise<SelectFinalResult> {
  validateOptions(options);
  const state = parseState(options.state), order = options.order ?? 'source';
  const from = await realpath(resolve(options.from)), out = await canonicalPath(resolve(options.out));
  if (from === out) throw new Error('--from and --out must be different directories');
  const result: SelectFinalResult = { state_code: state, order, input_routes: 0, before_end_filter: 0, excluded_named_trail_routes: 0, excluded_end_routes: 0, after_end_filter: 0, research_routes: 0 };
  const selected: SelectedRoute[] = [], needed = new Set<string>();
  for await (const line of lines(join(from, 'routes.ndjson'))) {
    const row = JSON.parse(line) as ComposedRoute;
    result.input_routes++;
    if (row.state_code !== undefined && row.state_code !== state) throw new Error(`Route ${row.route_id ?? row.name} is ${row.state_code}, not ${state}`);
    if (row.status !== 'ok') continue;
    result.before_end_filter++;
    if (row.discovery_source === 'named_trail') { result.excluded_named_trail_routes++; continue; }
    if ([row.trailhead, row.objective, row.end_trailhead].some(isNewEnd)) { result.excluded_end_routes++; continue; }
    if (!row.route_id || !row.name || !Array.isArray(row.segments) || row.segments.some(ref => !ref.id)) throw new Error('Selected route lacks an ID, name, or segment references');
    const segment_ids = row.segments.map(ref => ref.id);
    selected.push({ route_id: row.route_id, name: row.name, segment_ids, line });
    for (const id of segment_ids) needed.add(id);
  }
  const researchSegments = new Set<string>();
  // Keep only IDs while streaming the large segment file; do not retain geometry.
  for await (const segment of ndjson<Segment>(join(from, 'segments.ndjson'))) {
    if (segment.state_code !== undefined && segment.state_code !== state && !segment.frozen_catalog) throw new Error(`Segment ${segment.id} is ${segment.state_code}, not ${state}`);
    if (!needed.delete(segment.id)) continue;
    if (needsResearch(segment)) researchSegments.add(segment.id);
  }
  if (needed.size) throw new Error(`Selected routes reference missing segments: ${[...needed].slice(0, 10).join(', ')}`);
  const research = selected.filter(row => row.segment_ids.some(id => researchSegments.has(id))), researchIds = new Set(research.map(row => row.route_id));
  const ordered = order === 'research-first' ? [...research, ...selected.filter(row => !researchIds.has(row.route_id))] : selected;
  result.after_end_filter = selected.length; result.research_routes = research.length;
  await mkdir(out, { recursive: true });
  const staging = await mkdtemp(join(out, '.select-final-'));
  try {
    await copyFile(join(from, 'segments.ndjson'), join(staging, 'segments.ndjson'));
    await writeLines(join(staging, 'routes.ndjson'), ordered.map(row => row.line));
    await writeNdjson(join(staging, 'research.ndjson'), research.map(({ route_id, name }) => ({ route_id, name })));
    await writeFile(join(staging, 'select-final.json'), JSON.stringify(result, null, 2) + '\n');
    for (const file of ['segments.ndjson', 'routes.ndjson', 'research.ndjson', 'select-final.json']) await rename(join(staging, file), join(out, file));
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (require.main === module) selectFinal(selectFinalArgs()).catch(error => { console.error(error); process.exitCode = 1; });
