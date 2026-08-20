// The road processing store.
//
// Road segments never land in the `peaks` database — only the derived
// per-trailhead facts will, in a later task. Processing happens in a local
// DuckDB file with the spatial extension loaded. The reasoning is in
// migrate/docs/roads-processing-store.md; the short version is that the shared
// Cloud SQL instance is a db-f1-micro serving production, and half a million
// road geometries have no business competing with it for memory or for a disk
// that cannot shrink again.

import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export interface OpenStoreOptions {
  /** Open without taking a write lock. */
  readOnly?: boolean;
  /** DuckDB memory limit, e.g. "4GB". Left to DuckDB when unset. */
  memoryLimit?: string;
}

export interface RoadStore {
  connection: DuckDBConnection;
  path: string;
  /** Run a statement and discard the result. */
  run(sql: string): Promise<void>;
  /** Run a query and return its rows as objects. */
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Run a query expected to return exactly one row. */
  one<T = Record<string, unknown>>(sql: string): Promise<T>;
  close(): void;
}

/** Open the store, creating it when absent, with the spatial extension loaded. */
export async function openRoadStore(
  path: string,
  options: OpenStoreOptions = {},
): Promise<RoadStore> {
  const config: Record<string, string> = {};
  if (options.readOnly) config.access_mode = "READ_ONLY";
  if (options.memoryLimit) config.memory_limit = options.memoryLimit;

  const instance = await DuckDBInstance.create(path, config);
  const connection = await instance.connect();
  // The spatial extension carries the GDAL reader used for the geodatabases.
  // INSTALL is a no-op once it is in the local extension directory.
  if (!options.readOnly) await connection.run("INSTALL spatial");
  await connection.run("LOAD spatial");

  const store: RoadStore = {
    connection,
    path,
    async run(sql: string) {
      await connection.run(sql);
    },
    async all<T = Record<string, unknown>>(sql: string) {
      const result = await connection.runAndReadAll(sql);
      return result.getRowObjectsJS() as T[];
    },
    async one<T = Record<string, unknown>>(sql: string) {
      const rows = await store.all<T>(sql);
      if (rows.length !== 1) {
        throw new Error(`expected one row, got ${rows.length}: ${sql.slice(0, 120)}`);
      }
      return rows[0]!;
    },
    close() {
      connection.closeSync();
    },
  };
  return store;
}

/** Single-quote a value for inline SQL. Only used for our own literals. */
export function sqlLiteral(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replace(/'/g, "''")}'`;
}

/** A DuckDB BIGINT arrives as a JS bigint; counts are small enough to narrow. */
export function toCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}
