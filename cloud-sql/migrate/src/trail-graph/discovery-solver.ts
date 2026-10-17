import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HardGoalRequest, HardGoalResult, HardGoalSolver } from './discovery';

export interface DiscoverySolverStats {
  calls: number; cached: number; cached_limited: number; hard_timeouts: number; optimal: number; feasible: number; infeasible: number; limited: number;
  unavailable: number; errors: number; budget_skipped: number; elapsed_seconds: number; peak_rss_mib: number;
}
interface SolverRun { stdout?: string; stderr?: string; status?: number | null; error?: Error }
interface SolverRunOptions { timeout: number; killSignal: 'SIGKILL' }
interface SolverOptions { runner?: (input: string, execution: SolverRunOptions) => SolverRun; timeLimitSeconds?: number; reuseLimitedAttempts?: boolean; maxNewCalls?: number }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const statuses = new Set(['optimal', 'feasible', 'infeasible', 'limit', 'unavailable', 'error']);
const cacheable = (result: HardGoalResult) => result.status === 'optimal' || result.status === 'infeasible' || result.status === 'feasible' || result.status === 'limit' && !!result.path?.length;

function parsedResult(value: unknown): HardGoalResult {
  if (!value || typeof value !== 'object' || !statuses.has(String((value as { status?: unknown }).status))) throw new Error('Invalid solver status');
  const result = value as HardGoalResult;
  if (result.path !== undefined && (!Array.isArray(result.path) || result.path.some(step => !Number.isInteger(step.edge) || typeof step.reverse !== 'boolean'))) throw new Error('Invalid solver path');
  if ((result.status === 'optimal' || result.status === 'feasible') && !result.path?.length) throw new Error('Feasible solver result has no path');
  return result;
}

/** Optional, offline acceleration. Cache constructive feasible paths and proved
 * infeasibility; results without either leave TypeScript search in charge. */
export function createDiscoverySolver(cacheDir: string, options: SolverOptions = {}): { solve: HardGoalSolver; stats: DiscoverySolverStats } {
  cacheDir = resolve(cacheDir);
  mkdirSync(cacheDir, { recursive: true });
  const temporary = join(cacheDir, 'tmp'); mkdirSync(temporary, { recursive: true });
  const helper = join(__dirname, 'discovery-solver.py');
  const helperHash = existsSync(helper) ? sha(readFileSync(helper)) : 'missing';
  const timeLimitSeconds = options.timeLimitSeconds ?? 60;
  if (options.maxNewCalls !== undefined && (!Number.isSafeInteger(options.maxNewCalls) || options.maxNewCalls < 0)) throw new Error('maxNewCalls must be a nonnegative safe integer');
  const executionOptions: SolverRunOptions = { timeout: Math.ceil(timeLimitSeconds * 1000) + 5000, killSignal: 'SIGKILL' };
  const stats: DiscoverySolverStats = { calls: 0, cached: 0, cached_limited: 0, hard_timeouts: 0, optimal: 0, feasible: 0, infeasible: 0, limited: 0, unavailable: 0, errors: 0, budget_skipped: 0, elapsed_seconds: 0, peak_rss_mib: 0 };
  const count = (result: HardGoalResult) => {
    if (result.status === 'optimal' || result.status === 'infeasible') stats[result.status]++;
    else if (result.status === 'feasible' || result.status === 'limit' && result.path?.length) stats.feasible++;
    else if (result.status === 'limit') stats.limited++;
    else if (result.status === 'unavailable') { stats.unavailable++; unavailable = true; }
    else stats.errors++;
  };
  let unavailable = helperHash === 'missing';
  const run = options.runner ?? ((input: string, execution: SolverRunOptions): SolverRun => spawnSync('python3', [helper], {
    input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: cacheDir,
    ...execution,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TMPDIR: temporary, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
  }));
  const solve: HardGoalSolver = (request: HardGoalRequest): HardGoalResult => {
    if (unavailable) return { status: 'unavailable', reason: 'Local Python/SciPy solver unavailable; continuing TypeScript search' };
    const started = Date.now(), key = sha(JSON.stringify({ schema: 1, helper_sha256: helperHash, request })), proof = join(cacheDir, `${key}.json`);
    const payload = { ...request, timeLimitSeconds };
    if (existsSync(proof)) {
      try {
        const cached = JSON.parse(readFileSync(proof, 'utf8')) as { key?: string; result?: unknown };
        const result = parsedResult(cached.result);
        if (cached.key === key && cacheable(result)) {
          stats.cached++; count(result); stats.elapsed_seconds += (Date.now() - started) / 1000;
          return result;
        }
      } catch { /* Recompute a missing or damaged proof. */ }
    }
    const attempt = join(cacheDir, `${key}.attempt.json`);
    if (options.reuseLimitedAttempts && existsSync(attempt)) {
      try {
        const cached = JSON.parse(readFileSync(attempt, 'utf8')) as { key?: string; helper_sha256?: string; request?: unknown; result?: unknown };
        const result = parsedResult(cached.result);
        if (cached.key === key && cached.helper_sha256 === helperHash && JSON.stringify(cached.request) === JSON.stringify(payload) && result.status === 'limit' && !result.path?.length) {
          stats.cached_limited++; count(result); stats.elapsed_seconds += (Date.now() - started) / 1000;
          return { status: 'limit', reason: 'Reused prior limited attempt; qualifying path remains unresolved' };
        }
      } catch { /* Advisory attempts cannot supply a proof or a path. */ }
    }
    if (stats.calls >= (options.maxNewCalls ?? Infinity)) {
      stats.budget_skipped++; stats.limited++;
      return { status: 'limit', reason: 'Optional native solver call budget exhausted; continuing TypeScript search' };
    }
    stats.calls++;
    let result: HardGoalResult, stderr = '';
    try {
      const execution = run(JSON.stringify(payload), executionOptions); stderr = execution.stderr ?? '';
      if (execution.error) throw execution.error;
      if (execution.status !== undefined && execution.status !== 0) throw new Error(`Local solver exited with status ${execution.status}`);
      result = parsedResult(JSON.parse(execution.stdout?.trim() || '{}'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const timedOut = code === 'ETIMEDOUT' || /\bETIMEDOUT\b/.test(message);
      if (timedOut) stats.hard_timeouts++;
      result = { status: timedOut ? 'limit' : code === 'ENOENT' || /ENOENT/.test(message) ? 'unavailable' : 'error', reason: message };
    }
    stats.elapsed_seconds += (Date.now() - started) / 1000;
    const peak = result.max_rss_mib;
    if (typeof peak === 'number' && Number.isFinite(peak) && peak >= 0) stats.peak_rss_mib = Math.max(stats.peak_rss_mib, peak);
    count(result);
    const destination = cacheable(result) ? proof : attempt;
    const staging = `${destination}.tmp-${process.pid}`;
    writeFileSync(staging, JSON.stringify({ key, helper_sha256: helperHash, request: payload, result, stderr }, null, 2) + '\n'); renameSync(staging, destination);
    return result;
  };
  return { solve, stats };
}
