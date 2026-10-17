import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Accumulate successful active-route changes across the ordered loader modes.
 * Checkpoint after commits; dry-runs never write or clear this apply receipt. */
export async function writeRematchNeeded(dir: string, affected: Iterable<string>, print = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'rematch-needed.json'), current = [...new Set(affected)].sort();
  let prior: string[] = [];
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(value.route_ids) || value.route_ids.some((id: unknown) => typeof id !== 'string' || !id)) throw new Error(`Invalid rematch receipt: ${path}`);
    prior = value.route_ids;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const route_ids = [...new Set([...prior, ...current])].sort();
  const receipt = { required: route_ids.length > 0, route_ids, this_run_route_ids: current,
    instruction: 'After all loader modes, run cloud-sql/migrate/src/rematch-all-sessions.ts from PR #236 with --batch-size 100 while the sweep drains. A full rematch is required; route_ids are an audit list, not a session filter. Archive this receipt only after the backfill and queue drain finish.' };
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n'); await rename(temporary, path);
  if (print) console.log(JSON.stringify({ rematch_needed: path, ...receipt }, null, 2));
}
