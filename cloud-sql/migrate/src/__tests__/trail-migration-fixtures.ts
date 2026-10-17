import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const companions = {
  covers: { worktree: 'admin-route-covers', file: '20261015_route_covers.sql' },
  segments: { worktree: 'segment-matching-v2', file: '20261015_segment_model_v2.sql' },
};
export const functionNames = (sql: string): string[] => [...new Set([...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public\.)?\w+)\s*\(/gi)]
  .map(m => m[1].replace(/^public\./i, '')))];
export function catalogGuard(sql: string): string {
  const match = sql.match(/CREATE OR REPLACE FUNCTION guard_trail_catalog_pending_only\(\)[\s\S]*?END \$\$;/);
  if (!match) throw new Error('Missing guard_trail_catalog_pending_only definition');
  return match[0];
}
/** Read the merged migration or its actual sibling worktree first. Small guard
 * and function-name snapshots keep these checks runnable in an isolated CI
 * checkout before the companion PRs merge. Never execute the fixture SQL. */
export function companionMigration(key: keyof typeof companions): { sql: string; functions: string[]; source: string } {
  const { worktree, file } = companions[key];
  const source = [resolve(root, 'cloud-sql/migrations', file), resolve(root, '..', worktree, 'cloud-sql/migrations', file)].find(existsSync);
  if (source) { const sql = readFileSync(source, 'utf8'); return { sql, functions: functionNames(sql), source }; }
  const manifest = resolve(__dirname, 'fixtures/wa-companion-functions.json');
  return { sql: key === 'covers' ? readFileSync(resolve(__dirname, 'fixtures/wa-cover-guard.sql'), 'utf8') : '',
    functions: JSON.parse(readFileSync(manifest, 'utf8'))[key], source: manifest };
}
