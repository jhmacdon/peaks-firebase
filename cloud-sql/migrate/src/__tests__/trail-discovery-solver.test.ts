import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiscoverySolver } from '../trail-graph/discovery-solver';
import { discover, type HardGoalRequest } from '../trail-graph/discovery';
import { composeDiscovery } from '../trail-graph/discovery-catalog';
import { length } from '../trail-graph/geo';
import { provenance } from '../trail-graph/topology';
import type { Coord, NamedFeature, Segment } from '../trail-graph/types';

const request: HardGoalRequest = { start: 's', edges: [{ id: 1, from: 's', to: 't', length: 1000, named: true, road: false }], contacts: [{ node: 't', connector: 0 }], maxDistance: 15000 };
function temporary(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'trail-solver-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('local solver caches only request-bound proved results and records child memory', () => temporary(directory => {
  let calls = 0;
  const solver = createDiscoverySolver(directory, { runner: input => {
    calls++; assert.equal(JSON.parse(input).timeLimitSeconds, 60);
    return { status: 0, stdout: JSON.stringify({ status: 'optimal', path: [{ edge: 1, reverse: false }], max_rss_mib: 123 }) };
  } });
  assert.equal(solver.solve(request).status, 'optimal'); assert.equal(solver.solve(request).status, 'optimal');
  assert.equal(calls, 1); assert.equal(solver.stats.cached, 1); assert.equal(solver.stats.peak_rss_mib, 123);
  const proof = readdirSync(directory).find(name => name.endsWith('.json'))!;
  const receipt = JSON.parse(readFileSync(join(directory, proof), 'utf8'));
  assert.equal(receipt.helper_sha256.length, 64); assert.deepEqual(receipt.request.edges, request.edges);
  solver.solve({ ...request, contacts: [{ node: 't', connector: 50 }] }); assert.equal(calls, 2);
}));

test('damaged proofs are recomputed and unfinished solves are never proof-cache hits', () => temporary(directory => {
  let calls = 0;
  const solver = createDiscoverySolver(directory, { runner: () => { calls++; return { status: 0, stdout: JSON.stringify({ status: calls === 1 ? 'infeasible' : 'limit' }) }; } });
  solver.solve(request);
  const proof = readdirSync(directory).find(name => name.endsWith('.json'))!; writeFileSync(join(directory, proof), '{broken');
  assert.equal(solver.solve(request).status, 'limit'); assert.equal(solver.solve(request).status, 'limit');
  assert.equal(calls, 3); assert.equal(solver.stats.cached, 0);
}));

test('feasible paths can be reused without claiming a global cost optimum', () => temporary(directory => {
  let calls = 0;
  const solver = createDiscoverySolver(directory, { runner: () => { calls++; return { status: 0, stdout: JSON.stringify({ status: 'feasible', path: [{ edge: 1, reverse: false }] }) }; } });
  assert.equal(solver.solve(request).status, 'feasible'); assert.equal(solver.solve(request).status, 'feasible');
  assert.equal(calls, 1); assert.equal(solver.stats.cached, 1); assert.equal(solver.stats.feasible, 2); assert.equal(solver.stats.optimal, 0);
}));

test('unavailable local solvers disable repeated subprocess attempts while errors remain non-proofs', () => temporary(directory => {
  let calls = 0;
  const missing = createDiscoverySolver(join(directory, 'missing'), { runner: () => { calls++; return { status: 0, stdout: '{"status":"unavailable"}' }; } });
  assert.equal(missing.solve(request).status, 'unavailable'); assert.equal(missing.solve(request).status, 'unavailable'); assert.equal(calls, 1);
  const malformed = createDiscoverySolver(join(directory, 'malformed'), { runner: () => ({ status: 0, stdout: '{"status":"optimal","path":[{"edge":"1","reverse":false}]}' }) });
  assert.equal(malformed.solve(request).status, 'error'); assert.equal(malformed.stats.optimal, 0);
  const exited = createDiscoverySolver(join(directory, 'exited'), { runner: () => ({ status: 1, stdout: '{"status":"infeasible"}' }) });
  assert.equal(exited.solve(request).status, 'error'); assert.equal(exited.stats.infeasible, 0);
}));

test('hard timeouts use SIGKILL and remain nonproof limits despite partial solver stdout', () => temporary(directory => {
  const solver = createDiscoverySolver(directory, { timeLimitSeconds: 10.0001, reuseLimitedAttempts: true, runner: (input, execution) => {
    assert.equal(JSON.parse(input).timeLimitSeconds, 10.0001); assert.deepEqual(execution, { timeout: 15001, killSignal: 'SIGKILL' });
    return { status: null, stdout: '{"status":"infeasible"}', error: Object.assign(new Error('spawnSync python3 ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
  } });
  const result = solver.solve(request); assert.equal(result.status, 'limit'); assert.equal(result.path, undefined); assert.equal(solver.stats.limited, 1); assert.equal(solver.stats.errors, 0); assert.equal(solver.stats.infeasible, 0); assert.equal(solver.stats.hard_timeouts, 1);
  assert.equal(solver.solve(request).status, 'limit'); assert.equal(solver.stats.hard_timeouts, 1); assert.equal(solver.stats.cached_limited, 1); assert.equal(solver.stats.calls, 1);
  const files = readdirSync(directory); assert.equal(files.filter(name => name.endsWith('.attempt.json')).length, 1); assert.equal(files.filter(name => name.endsWith('.json') && !name.endsWith('.attempt.json')).length, 0);
}));

test('the hard wall timeout terminates a child that outlives the native solver budget', () => temporary(directory => {
  let signal: string | null = null;
  const solver = createDiscoverySolver(directory, { timeLimitSeconds: .001, runner: (input, execution) => {
    assert.equal(execution.timeout, 5001);
    const result = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { input, encoding: 'utf8', ...execution }); signal = result.signal; return result;
  } });
  assert.equal(solver.solve(request).status, 'limit'); assert.equal(signal, 'SIGKILL'); assert.equal(solver.stats.errors, 0); assert.equal(solver.stats.hard_timeouts, 1);
}));

test('limited attempts are advisory only with explicit opt-in and the same configured budget', () => temporary(directory => {
  let calls = 0;
  const first = createDiscoverySolver(directory, { timeLimitSeconds: 10, runner: () => { calls++; return { status: 0, stdout: '{"status":"limit"}' }; } });
  assert.equal(first.solve(request).status, 'limit'); assert.equal(first.solve(request).status, 'limit'); assert.equal(calls, 2, 'default behavior retries unfinished attempts'); assert.equal(first.stats.hard_timeouts, 0);
  const reused = createDiscoverySolver(directory, { timeLimitSeconds: 10, reuseLimitedAttempts: true, runner: () => { throw new Error('advisory cache should avoid spawning'); } });
  const result = reused.solve(request); assert.equal(result.status, 'limit'); assert.equal(result.path, undefined); assert.equal(reused.stats.calls, 0); assert.equal(reused.stats.cached, 0); assert.equal(reused.stats.cached_limited, 1); assert.equal(reused.stats.limited, 1); assert.equal(reused.stats.infeasible, 0); assert.equal(reused.stats.hard_timeouts, 0);
  const changedBudget = createDiscoverySolver(directory, { timeLimitSeconds: 11, reuseLimitedAttempts: true, runner: () => { calls++; return { status: 0, stdout: '{"status":"limit"}' }; } });
  assert.equal(changedBudget.solve(request).status, 'limit'); assert.equal(changedBudget.stats.calls, 1); assert.equal(changedBudget.stats.cached_limited, 0); assert.equal(calls, 3);
}));

test('advisory reuse ignores wrong bindings, malformed attempts and any claimed solution or proof', () => temporary(directory => {
  const mutations = [
    (receipt: any) => { receipt.key = 'wrong'; }, (receipt: any) => { receipt.helper_sha256 = 'wrong'; },
    (receipt: any) => { receipt.request.timeLimitSeconds = 20; }, (receipt: any) => { receipt.request.edges[0].length = 2000; },
    (receipt: any) => { delete receipt.request; }, (receipt: any) => { receipt.result.status = 'infeasible'; },
    (receipt: any) => { receipt.result = { status: 'optimal', path: [{ edge: 1, reverse: false }] }; },
    (receipt: any) => { receipt.result = { status: 'limit', path: [{ edge: 1, reverse: false }] }; },
    (_receipt: any) => '{broken', (_receipt: any) => 'null',
  ];
  for (const [i, mutate] of mutations.entries()) {
    const cache = join(directory, String(i)), first = createDiscoverySolver(cache, { timeLimitSeconds: 10, runner: () => ({ status: 0, stdout: '{"status":"limit"}' }) }); first.solve(request);
    const file = join(cache, readdirSync(cache).find(name => name.endsWith('.attempt.json'))!), receipt = JSON.parse(readFileSync(file, 'utf8')), text = mutate(receipt);
    writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(receipt));
    let calls = 0; const solver = createDiscoverySolver(cache, { timeLimitSeconds: 10, reuseLimitedAttempts: true, runner: () => { calls++; return { status: 0, stdout: '{"status":"limit"}' }; } });
    assert.equal(solver.solve(request).status, 'limit'); assert.equal(calls, 1, `mutation ${i}`); assert.equal(solver.stats.cached_limited, 0); assert.equal(solver.stats.cached, 0); assert.equal(solver.stats.infeasible, 0);
  }
}));

test('reusing a limited native attempt leaves unresolved objective pairs as TypeScript review rows', () => temporary(directory => {
  const p = (east: number, north = 0): Coord => [-121 + east / 100000, 47 + north / 111000];
  const make = (id: string, node_ids: string[], coords: Coord[], name: string | null): Segment => ({ id, node_ids, coords, name, kind: 'trail', trail_names: name ? [name] : [], relation_names: [], relations: [], start_node: node_ids[0], end_node: node_ids.at(-1)!, length_m: length(coords), osm_way_ids: [10], osm_edge_way_ids: coords.slice(1).map(() => 10), sac_scale: null, trail_visibility: null, provenance: provenance([10], '2026-10-17T00:00:00Z'), alt_sources: [] });
  const segments = [make('approach', ['s', 'x'], [p(0), p(100)], null), make('short', ['x', 't'], [p(100), p(150)], 'Alpha Trail'), make('long', ['x', 'b', 't'], [p(100), p(125, 500), p(150)], 'Alpha Trail')];
  const feature = (id: string, name: string, kind: NamedFeature['feature'], point: Coord): NamedFeature => ({ osm_id: id, name, feature: kind, lon: point[0], lat: point[1], graph_node: null, graph_distance_m: null, location_method: 'osm_point' });
  const input = { segments, features: [feature('node/1', 'Alpha Trailhead', 'trailhead', p(0)), feature('node/2', 'Alpha View', 'viewpoint', p(150))], access: [] };
  const solver = createDiscoverySolver(directory, { timeLimitSeconds: 10, reuseLimitedAttempts: true, runner: () => ({ status: 0, stdout: '{"status":"limit"}' }) });
  for (let i = 0; i < 2; i++) {
    const routes = [...discover(input, () => {}, { hardGoalSolver: solver.solve, hardGoalAfterStates: 0, maxObjectiveStates: 1 })].filter(route => route.source === 'objective');
    assert.equal(routes.length, 1); assert.match(routes[0].reasons![0], /objective search budget exhausted/); assert.equal(composeDiscovery(routes[0], 0, 'CA', new Map(segments.map(s => [s.id, s]))).row.status, 'review');
  }
  assert.equal(solver.stats.calls, 1); assert.equal(solver.stats.cached_limited, 1); assert.equal(solver.stats.cached, 0); assert.equal(solver.stats.infeasible, 0);
}));

test('a native call cap retains cached proofs and never caches skipped work as a proof', () => temporary(directory => {
  let calls = 0;
  const solver = createDiscoverySolver(directory, { maxNewCalls: 1, runner: () => { calls++; return { status: 0, stdout: '{"status":"infeasible"}' }; } });
  assert.equal(solver.solve(request).status, 'infeasible');
  assert.equal(solver.solve(request).status, 'infeasible'); assert.equal(solver.stats.cached, 1);
  const changed = { ...request, maxDistance: request.maxDistance - 1 };
  assert.equal(solver.solve(changed).status, 'limit'); assert.equal(solver.stats.budget_skipped, 1); assert.equal(calls, 1);
  const retry = createDiscoverySolver(directory, { maxNewCalls: 1, runner: () => { calls++; return { status: 0, stdout: '{"status":"infeasible"}' }; } });
  assert.equal(retry.solve(changed).status, 'infeasible'); assert.equal(calls, 2, 'skipped work supplied no cached claim');
  for (const maxNewCalls of [-1, .5, NaN, Infinity]) assert.throws(() => createDiscoverySolver(directory, { maxNewCalls }), /nonnegative safe integer/);
}));

test('installed optional solver proves small fixtures, including a longer same-bad bypass', context => temporary(directory => {
  const solver = createDiscoverySolver(directory, { timeLimitSeconds: 10 });
  const first = solver.solve(request);
  if (first.status === 'unavailable') { context.skip('Optional local Python/SciPy solver not installed'); return; }
  assert.equal(first.status, 'optimal'); assert.deepEqual(first.path, [{ edge: 1, reverse: false }]);
  assert.equal(solver.solve({ ...request, edges: [{ ...request.edges[0], named: false }] }).status, 'infeasible');
  const bypass = solver.solve({ ...request, edges: [
    { id: 1, from: 's', to: 'x', length: 100, named: false, road: false },
    { id: 2, from: 'x', to: 't', length: 50, named: true, road: false },
    { id: 3, from: 'x', to: 'b', length: 500, named: true, road: false },
    { id: 4, from: 'b', to: 't', length: 500, named: true, road: false },
  ] });
  assert.equal(bypass.status, 'optimal'); assert.deepEqual(bypass.path?.map(step => step.edge), [1, 3, 4]);
  assert.equal(solver.solve({ ...request, edges: [{ ...request.edges[0], length: 14950 }], contacts: [{ node: 't', connector: 50.001 }] }).status, 'infeasible');
}));
