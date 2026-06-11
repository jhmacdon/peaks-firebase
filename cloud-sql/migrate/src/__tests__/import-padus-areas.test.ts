import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  importPadusAreas,
  parseArgs,
} from "../import-padus-areas";

const square = {
  type: "Polygon",
  coordinates: [[
    [-121.9, 46.7],
    [-121.6, 46.7],
    [-121.6, 46.95],
    [-121.9, 46.95],
    [-121.9, 46.7],
  ]],
};

interface QueryCall {
  target: "client" | "pool";
  sql: string;
  params?: unknown[];
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function samplePadusNdjson(count: number): string {
  return Array.from({ length: count }, (_, i) => JSON.stringify({
    type: "Feature",
    geometry: square,
    properties: {
      Unit_Nm: "Mount Rainier National Park",
      Des_Tp: "National Park",
      Mang_Name: "National Park Service",
      Own_Name: "National Park Service",
      State_Nm: "Washington",
      PADUS_ID: `NPS-MORA-${i + 1}`,
    },
  })).join("\n");
}

function silentLogger(): { log: (...args: unknown[]) => void; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (...args: unknown[]) => logs.push(args.join(" ")),
  };
}

class FakeClient {
  released = false;

  constructor(
    private readonly calls: QueryCall[],
    private readonly failOn?: (sql: string) => boolean
  ) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    const normalized = compact(sql);
    this.calls.push({ target: "client", sql: normalized, params });
    if (this.failOn?.(normalized)) {
      throw new Error("forced query failure");
    }
    if (normalized.includes("link_summit_destinations_to_areas")) {
      return { rows: [{ inserted_count: "7" } as T], rowCount: 1 };
    }
    if (normalized.startsWith("WITH dissolved AS")) {
      return { rows: [], rowCount: 3 };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class FakeDb {
  connectCalls = 0;

  constructor(
    private readonly client: FakeClient,
    private readonly calls: QueryCall[],
    private readonly failReport = false
  ) {}

  async connect(): Promise<FakeClient> {
    this.connectCalls++;
    return this.client;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    const normalized = compact(sql);
    this.calls.push({ target: "pool", sql: normalized, params });
    if (this.failReport) {
      throw new Error("report failed");
    }
    if (normalized.includes("GROUP BY kind")) {
      return { rows: [{ kind: "national_park", count: 1 } as T], rowCount: 1 };
    }
    if (normalized.includes("linked_destinations")) {
      return { rows: [{ linked_destinations: 1, links: 2 } as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

function args(overrides: Partial<ReturnType<typeof parseArgs>> = {}): ReturnType<typeof parseArgs> {
  return {
    input: "/fake/padus.ndjson",
    sourceVersion: "4.1",
    apply: true,
    dryRun: false,
    linkDestinations: false,
    replaceLinks: false,
    ...overrides,
  };
}

test("rejects conflicting and ineffective CLI flags", () => {
  assert.throws(
    () => parseArgs(["--input=/tmp/padus.ndjson", "--apply", "--dry-run"]),
    /--apply and --dry-run cannot be used together/
  );
  assert.throws(
    () => parseArgs(["--input=/tmp/padus.ndjson", "--replace-links"]),
    /--replace-links requires --link-destinations/
  );
});

test("dry-run reads and normalizes without checking out a client or writing", async () => {
  const logger = silentLogger();
  const forbiddenDb = {
    async connect(): Promise<never> {
      throw new Error("dry-run must not connect");
    },
    async query(): Promise<never> {
      throw new Error("dry-run must not query");
    },
  };

  await importPadusAreas(args({ apply: false, dryRun: true }), {
    db: forbiddenDb,
    readFile: () => samplePadusNdjson(2),
    console: logger,
  });

  assert.deepEqual(logger.logs.slice(0, 3), [
    "Read features: 2",
    "Importable PAD-US area parts: 2",
    "Dissolved logical areas: 1",
  ]);
  assert.equal(logger.logs.at(-1), "DRY RUN - no rows written. Re-run with --apply to persist.");
});

test("apply mode uses one checked-out client for transaction work and reports after commit", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls);
  const logger = silentLogger();

  await importPadusAreas(args({ linkDestinations: true }), {
    db: fakeDb,
    readFile: () => samplePadusNdjson(2),
    console: logger,
  });

  assert.equal(fakeDb.connectCalls, 1);
  assert.equal(client.released, true);

  const clientSql = calls.filter((call) => call.target === "client").map((call) => call.sql);
  assert.equal(clientSql[0], "BEGIN");
  assert.match(clientSql[1], /^CREATE TEMP TABLE padus_area_import_parts/);
  assert.match(clientSql[2], /^INSERT INTO padus_area_import_parts/);
  assert.match(clientSql[3], /^WITH dissolved AS/);
  assert.match(clientSql[3], /jsonb_agg\(DISTINCT source_record_id ORDER BY source_record_id\)/);
  assert.match(clientSql[3], /jsonb_agg\(metadata ORDER BY source_record_id\)/);
  assert.match(clientSql[3], /IS DISTINCT FROM/);
  assert.equal(clientSql[4], "SELECT link_summit_destinations_to_areas(false) AS inserted_count;");
  assert.equal(clientSql[5], "COMMIT");

  const commitIndex = calls.findIndex((call) => call.sql === "COMMIT");
  const firstPoolQueryIndex = calls.findIndex((call) => call.target === "pool");
  assert.ok(firstPoolQueryIndex > commitIndex);
  assert.ok(logger.logs.includes("Upserted inserted or changed areas: 3"));
  assert.ok(logger.logs.includes("Inserted destination-area links: 7"));
});

test("apply mode rolls back transaction errors and releases the client", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls, (sql) => sql.startsWith("WITH dissolved AS"));
  const fakeDb = new FakeDb(client, calls);

  await assert.rejects(
    () => importPadusAreas(args(), {
      db: fakeDb,
      readFile: () => samplePadusNdjson(1),
      console: silentLogger(),
    }),
    /forced query failure/
  );

  const clientSql = calls.filter((call) => call.target === "client").map((call) => call.sql);
  assert.ok(clientSql.includes("ROLLBACK"));
  assert.ok(!clientSql.includes("COMMIT"));
  assert.equal(calls.some((call) => call.target === "pool"), false);
  assert.equal(client.released, true);
});

test("report failures after commit do not attempt rollback", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls, true);

  await assert.rejects(
    () => importPadusAreas(args(), {
      db: fakeDb,
      readFile: () => samplePadusNdjson(1),
      console: silentLogger(),
    }),
    /report failed/
  );

  const clientSql = calls.filter((call) => call.target === "client").map((call) => call.sql);
  assert.ok(clientSql.includes("COMMIT"));
  assert.ok(!clientSql.includes("ROLLBACK"));
  assert.equal(client.released, true);
});

test("temp table inserts are chunked instead of one query per PAD-US part", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls);

  await importPadusAreas(args(), {
    db: fakeDb,
    readFile: () => samplePadusNdjson(251),
    console: silentLogger(),
  });

  const insertCalls = calls.filter((call) =>
    call.target === "client" && call.sql.startsWith("INSERT INTO padus_area_import_parts")
  );
  assert.equal(insertCalls.length, 2);
  assert.equal(insertCalls[0].params?.length, 250 * 15);
  assert.equal(insertCalls[1].params?.length, 15);
});
