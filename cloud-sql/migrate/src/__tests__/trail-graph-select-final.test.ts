import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { selectFinal, selectFinalArgs } from '../trail-graph/select-final';
import type { ComposedRoute, PlaceRef } from '../trail-graph/catalog-types';

const cache = resolve(__dirname, '../../../../.cache/test-trail-graph-select-final');
async function temporary(run: (dir: string) => Promise<void>) {
  await mkdir(cache, { recursive: true }); const dir = await mkdtemp(join(cache, 'fixture-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function route(id: string, overrides: Partial<ComposedRoute> = {}): ComposedRoute {
  return { route_id: `or-${id}`, name: id, state_code: 'OR', status: 'ok', discovery_source: 'objective',
    trailhead: { peaks_id: 'start' }, objective: { peaks_id: 'goal' }, segments: [{ id: 'easy', direction: 'forward' }],
    ...overrides } as ComposedRoute;
}
const endPlace: PlaceRef = { new: { name: 'Mapped Trail End', feature: 'landform', lng: -121, lat: 44, source: { kind: 'trail_end' } } };
async function fixture(dir: string) {
  const from = join(dir, 'compose'); await mkdir(from);
  const rows = [
    route('safe'), route('sac-1', { segments: [{ id: 'sac-1', direction: 'forward' }] }),
    route('existing-end', Object.fromEntries(['trailhead', 'objective', 'end_trailhead'].map(key => [key, { ...endPlace, peaks_id: 'existing' }]))),
    route('trailhead-end', Object.fromEntries(['trailhead', 'objective', 'end_trailhead'].map(key => [key, { new: { ...endPlace.new!, feature: 'trailhead' } }]))),
    route('sac-2', { segments: [{ id: 'sac-2', direction: 'forward' }] }),
    route('waypoint-end', { waypoints: [endPlace] as ComposedRoute['waypoints'] }),
    route('sac-3', { segments: [{ id: 'sac-3', direction: 'forward' }] }),
    route('glacier', { segments: [{ id: 'ice', direction: 'reverse' }] }),
    route('snowfield', { segments: [{ id: 'snow', direction: 'forward' }] }),
    route('sac-4', { segments: [{ id: 'sac-4', direction: 'forward' }] }),
    ...(['review', 'failed', 'needs_geometry'] as const).map(status => route(status, { status })),
    route('named-trail', { discovery_source: 'named_trail' }),
    ...(['trailhead', 'objective', 'end_trailhead'] as const).map(key => route(`end-${key}`, { [key]: endPlace })),
  ];
  const segments = [
    { id: 'easy', kind: 'trail', sac_scale: 'mountain_hiking', state_code: 'OR' },
    ...['demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'].map((sac_scale, i) => ({ id: `sac-${i + 1}`, kind: 'trail', sac_scale, state_code: 'OR' })),
    { id: 'ice', kind: 'glacier', sac_scale: null, state_code: 'OR' },
    { id: 'snow', kind: 'snowfield', sac_scale: null, state_code: 'OR' },
  ];
  const routeLines = rows.map(row => `  ${JSON.stringify(row)} `), segmentText = segments.map(row => ` ${JSON.stringify(row)} `).join('\n') + '\n';
  await writeFile(join(from, 'routes.ndjson'), routeLines.join('\n') + '\n');
  await writeFile(join(from, 'segments.ndjson'), segmentText);
  return { from, rows, routeLines, segmentText };
}
async function readRows(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

test('final selection filters status, named trails and all three new End refs while preserving records', async () => temporary(async dir => {
  const { from, rows, routeLines, segmentText } = await fixture(dir), out = join(dir, 'final');
  const counts = await selectFinal({ state: 'OR', from, out });
  assert.deepEqual(counts, { state_code: 'OR', order: 'source', input_routes: 17, before_end_filter: 14, excluded_named_trail_routes: 1, excluded_end_routes: 3, after_end_filter: 10, research_routes: 6 });
  assert.equal(await readFile(join(out, 'routes.ndjson'), 'utf8'), routeLines.slice(0, 10).join('\n') + '\n');
  assert.equal(await readFile(join(out, 'segments.ndjson'), 'utf8'), segmentText);
  assert.deepEqual(await readRows(join(out, 'research.ndjson')), [1, 4, 6, 7, 8, 9].map(i => ({ route_id: rows[i].route_id, name: rows[i].name })));
  assert.deepEqual(JSON.parse(await readFile(join(out, 'select-final.json'), 'utf8')), counts);
}));
test('research-first keeps source order within both groups and records the loader order', async () => temporary(async dir => {
  const { from, rows } = await fixture(dir), out = join(dir, 'final');
  await selectFinal({ state: 'OR', from, out, order: 'research-first' });
  assert.deepEqual((await readRows(join(out, 'routes.ndjson'))).map(row => row.route_id), [1, 4, 6, 7, 8, 9, 0, 2, 3, 5].map(i => rows[i].route_id));
  assert.equal(JSON.parse(await readFile(join(out, 'select-final.json'), 'utf8')).order, 'research-first');
}));
test('final selection rejects missing used segments, wrong states, and source/output aliases', async () => temporary(async dir => {
  const { from } = await fixture(dir), out = join(dir, 'final'), alias = join(dir, 'alias');
  await symlink(from, alias);
  await assert.rejects(selectFinal({ state: 'OR', from, out: alias }), /different directories/);
  await assert.rejects(selectFinal({ state: 'CA', from, out }), /not CA/);
  await writeFile(join(from, 'segments.ndjson'), JSON.stringify({ id: 'easy', kind: 'trail', sac_scale: null, state_code: 'CA' }) + '\n');
  await assert.rejects(selectFinal({ state: 'OR', from, out }), /Segment easy is CA, not OR/);
  await writeFile(join(from, 'segments.ndjson'), '');
  await assert.rejects(selectFinal({ state: 'OR', from, out }), /missing segments/);
  await assert.rejects(readFile(join(out, 'routes.ndjson')), { code: 'ENOENT' });
}));
test('final selection validates required, unknown, duplicate and order arguments before reading files', () => {
  assert.deepEqual(selectFinalArgs(['--state', 'or', '--from', 'compose', '--out=final', '--order', 'research-first']), { state: 'OR', from: 'compose', out: 'final', order: 'research-first' });
  assert.throws(() => selectFinalArgs([]), /--state is required/);
  assert.throws(() => selectFinalArgs(['--state', 'XX', '--from', 'compose', '--out', 'final']), /Unsupported state/);
  assert.throws(() => selectFinalArgs(['--state', 'OR', '--from', 'compose', '--out', 'final', '--apply']), /Unknown argument/);
  assert.throws(() => selectFinalArgs(['--state', 'OR', '--state', 'CA']), /Duplicate/);
  assert.throws(() => selectFinalArgs(['--from']), /requires a value/);
  assert.throws(() => selectFinalArgs(['--state', 'OR', '--from', 'compose', '--out', 'final', '--order', 'popularity']), /--order must/);
  assert.throws(() => selectFinalArgs(['--state', 'OR', '--from', 'compose', '--out', './compose']), /different directories/);
});
