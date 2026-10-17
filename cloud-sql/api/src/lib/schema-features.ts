import db from "../db";

/**
 * Whether a column exists, cached per process for a minute.
 *
 * Migrations are applied by hand and CI never applies them, so an API deploy
 * can land before its migration. A query that names a missing column fails
 * every request it serves (the 09-01 to 09-04 outage). Readers of a brand-new
 * column check here and leave it out until the migration is in.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; at: number }>();

export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const result = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  const value = (result.rowCount ?? 0) > 0;
  cache.set(key, { value, at: Date.now() });
  return value;
}
