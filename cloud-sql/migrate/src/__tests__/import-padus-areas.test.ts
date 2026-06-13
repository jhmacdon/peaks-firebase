import { strict as assert } from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import {
  importPadusAreas,
  PADUS_IMPORT_INSERT_CHUNK_SIZE,
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

function distinctPadusNdjson(count: number): string {
  return Array.from({ length: count }, (_, i) => JSON.stringify({
    type: "Feature",
    geometry: square,
    properties: {
      Unit_Nm: `Example ${i + 1} National Park`,
      Des_Tp: "National Park",
      Mang_Name: "National Park Service",
      Own_Name: "National Park Service",
      State_Nm: "Washington",
      Source_PAID: `NPS-EXAMPLE-${i + 1}`,
    },
  })).join("\n");
}

function mixedPadusNdjson(): string {
  return [
    JSON.stringify({
      type: "Feature",
      geometry: square,
      properties: {
        Unit_Nm: "Mount Rainier National Park",
        Des_Tp: "National Park",
        Mang_Name: "National Park Service",
        Own_Name: "National Park Service",
        State_Nm: "Washington",
        Source_PAID: "NPS-MORA",
      },
    }),
    JSON.stringify({
      type: "Feature",
      geometry: square,
      properties: {
        Unit_Nm: "Joint Base Example",
        Des_Tp: "Military Land",
        Mang_Type: "FED",
      },
    }),
    JSON.stringify({
      type: "Feature",
      geometry: square,
      properties: {
        Unit_Nm: "Volunteer Park",
        Des_Tp: "Local Park",
        Mang_Name: "City Land",
      },
    }),
    JSON.stringify({
      type: "Feature",
      geometry: null,
      properties: {
        Unit_Nm: "Geometry Missing National Park",
        Des_Tp: "National Park",
        Mang_Name: "National Park Service",
      },
    }),
  ].join("\n");
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
    if (normalized.startsWith("SELECT id FROM destinations")) {
      return { rows: [{ id: "summit-1" }, { id: "summit-2" }] as T[], rowCount: 2 };
    }
    if (normalized.startsWith("INSERT INTO destination_areas")) {
      return { rows: [], rowCount: 7 };
    }
    if (normalized.startsWith("WITH input (")) {
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO padus_area_import_parts")) {
      return { rows: [], rowCount: 2 };
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
    if (normalized.includes("unlinked_summits")) {
      return { rows: [{ unlinked_summits: 4 } as T], rowCount: 1 };
    }
    if (normalized.includes("linked_area_count")) {
      return { rows: [{ name: "Mount Rainier", linked_area_count: 2 } as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

function args(overrides: Partial<ReturnType<typeof parseArgs>> = {}): ReturnType<typeof parseArgs> {
  return {
    input: "/fake/padus.ndjson",
    sourceVersion: "4.1",
    insertChunkSize: PADUS_IMPORT_INSERT_CHUNK_SIZE,
    trustSourceGeometry: false,
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
  assert.throws(
    () => parseArgs(["--input=/tmp/padus.ndjson", "--insert-chunk-size=0"]),
    /--insert-chunk-size must be a positive integer/
  );
  assert.equal(
    parseArgs(["--input=/tmp/padus.ndjson", "--insert-chunk-size=10"]).insertChunkSize,
    10
  );
  assert.equal(
    parseArgs(["--input=/tmp/padus.ndjson", "--trust-source-geometry"]).trustSourceGeometry,
    true
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

test("dry-run reports import designations and skipped reasons for audit", async () => {
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
    readFile: () => mixedPadusNdjson(),
    console: logger,
  });

  assert.ok(logger.logs.includes("Skipped PAD-US features: 3"));
  assert.ok(logger.logs.includes("Importable PAD-US designations:"));
  assert.ok(logger.logs.includes("  National Park: 1"));
  assert.ok(logger.logs.includes("Skipped PAD-US features by reason:"));
  assert.ok(logger.logs.includes("  non_federal: 1"));
  assert.ok(logger.logs.includes("  unsupported_or_missing_geometry: 1"));
  assert.ok(logger.logs.includes("  unsupported_designation: 1"));
});

test("dry-run streams NDJSON files instead of using readFileSync", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "padus-stream-"));
  const inputPath = path.join(tmpDir, "padus.ndjson");
  fs.writeFileSync(inputPath, samplePadusNdjson(2), "utf8");
  const logger = silentLogger();
  const forbiddenDb = {
    async connect(): Promise<never> {
      throw new Error("dry-run must not connect");
    },
    async query(): Promise<never> {
      throw new Error("dry-run must not query");
    },
  };

  const originalReadFileSync = fs.readFileSync;
  (fs as unknown as { readFileSync: typeof fs.readFileSync }).readFileSync = (() => {
    throw new Error("readFileSync should not be used for NDJSON imports");
  }) as typeof fs.readFileSync;

  try {
    await importPadusAreas(args({ input: inputPath, apply: false, dryRun: true }), {
      db: forbiddenDb,
      console: logger,
    });
  } finally {
    (fs as unknown as { readFileSync: typeof fs.readFileSync }).readFileSync = originalReadFileSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.deepEqual(logger.logs.slice(0, 3), [
    "Read features: 2",
    "Importable PAD-US area parts: 2",
    "Dissolved logical areas: 1",
  ]);
});

test("dry-run rejects oversized buffered GeoJSON imports with NDJSON guidance", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "padus-geojson-"));
  const inputPath = path.join(tmpDir, "padus.geojson");
  fs.writeFileSync(inputPath, JSON.stringify({
    type: "FeatureCollection",
    features: [JSON.parse(samplePadusNdjson(1))],
  }), "utf8");
  const logger = silentLogger();
  const forbiddenDb = {
    async connect(): Promise<never> {
      throw new Error("dry-run must not connect");
    },
    async query(): Promise<never> {
      throw new Error("dry-run must not query");
    },
  };

  const originalStatSync = fs.statSync;
  (fs as unknown as { statSync: typeof fs.statSync }).statSync = ((targetPath, options) => {
    const stats = originalStatSync(targetPath, options as never);
    if (targetPath === inputPath) {
      return { ...stats, size: 75 * 1024 * 1024 };
    }
    return stats;
  }) as typeof fs.statSync;

  try {
    await assert.rejects(
      () => importPadusAreas(args({ input: inputPath, apply: false, dryRun: true }), {
        db: forbiddenDb,
        console: logger,
      }),
      /Large GeoJSON imports must be converted to NDJSON or GeoJSONL/
    );
  } finally {
    (fs as unknown as { statSync: typeof fs.statSync }).statSync = originalStatSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  assert.match(clientSql[1], /^WITH input \(/);
  assert.match(clientSql[1], /ST_MakeValid\(parsed_geom\)/);
  assert.doesNotMatch(clientSql[1], /::geography/);
  assert.match(clientSql[1], /IS DISTINCT FROM/);
  assert.match(clientSql[2], /^SELECT id FROM destinations/);
  assert.match(clientSql[3], /^INSERT INTO destination_areas/);
  // tolerance-aware: bbox expanded by the planar gate, contained OR within tolerance m
  assert.match(clientSql[3], /d\.lng BETWEEN a\.bbox_min_lng - \$2 AND a\.bbox_max_lng \+ \$2/);
  assert.match(clientSql[3], /ST_DWithin\(a\.boundary, d\.geom, \$2\)/);
  assert.match(clientSql[3], /ST_Covers\(a\.boundary, d\.geom\)/);
  assert.match(clientSql[3], /ST_DWithin\(a\.boundary::geography, d\.gloc, \$3\)/);
  assert.equal(clientSql[4], "COMMIT");

  const upsertCall = calls.find((call) =>
    call.target === "client" && call.sql.startsWith("WITH input (")
  );
  const upsertMetadata = JSON.parse(String(upsertCall?.params?.[11]));
  assert.deepEqual(upsertMetadata.source_record_ids, ["NPS-MORA-1", "NPS-MORA-2"]);
  assert.equal(upsertMetadata.parts.length, 2);

  const commitIndex = calls.findIndex((call) => call.sql === "COMMIT");
  const firstPoolQueryIndex = calls.findIndex((call) => call.target === "pool");
  assert.ok(firstPoolQueryIndex > commitIndex);
  assert.ok(logger.logs.includes("Prepared PAD-US logical area geometries: 1"));
  assert.ok(logger.logs.includes("Upserted inserted or changed areas: 1"));
  assert.ok(logger.logs.includes("Linked destination-area batch 1/1"));
  assert.ok(logger.logs.includes("Inserted destination-area links: 7"));
  assert.match(
    calls.find((call) => call.target === "pool" && call.sql.includes("linked_destinations"))?.sql ?? "",
    /JOIN destinations d ON d\.id = da\.destination_id/
  );
  assert.match(
    calls.find((call) => call.target === "pool" && call.sql.includes("linked_destinations"))?.sql ?? "",
    /da\.source = 'postgis'/
  );
  assert.ok(logger.logs.includes("Database-wide summit destinations with no postgis area link: 4"));
  assert.ok(logger.logs.includes("Top linked summit destinations by area count:"));
});

test("apply mode rolls back transaction errors and releases the client", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls, (sql) => sql.startsWith("WITH input ("));
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

test("grouped area upserts are chunked instead of one query per PAD-US part", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls);

  await importPadusAreas(args(), {
    db: fakeDb,
    readFile: () => distinctPadusNdjson(251),
    console: silentLogger(),
  });

  const insertCalls = calls.filter((call) =>
    call.target === "client" && call.sql.startsWith("WITH input (")
  );
  assert.equal(insertCalls.length, 2);
  assert.equal(insertCalls[0].params?.length, 250 * 13);
  assert.equal(insertCalls[1].params?.length, 13);
});

test("grouped area upsert chunk size can be lowered for large geometries", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls);

  await importPadusAreas(args({ insertChunkSize: 10 }), {
    db: fakeDb,
    readFile: () => distinctPadusNdjson(21),
    console: silentLogger(),
  });

  const insertCalls = calls.filter((call) =>
    call.target === "client" && call.sql.startsWith("WITH input (")
  );
  assert.equal(insertCalls.length, 3);
  assert.equal(insertCalls[0].params?.length, 10 * 13);
  assert.equal(insertCalls[1].params?.length, 10 * 13);
  assert.equal(insertCalls[2].params?.length, 13);
});

test("grouped area upsert can trust source geometry and skip eager repair", async () => {
  const calls: QueryCall[] = [];
  const client = new FakeClient(calls);
  const fakeDb = new FakeDb(client, calls);

  await importPadusAreas(args({ trustSourceGeometry: true }), {
    db: fakeDb,
    readFile: () => samplePadusNdjson(1),
    console: silentLogger(),
  });

  const insertSql = calls.find((call) =>
    call.target === "client" && call.sql.startsWith("WITH input (")
  )?.sql ?? "";
  assert.match(insertSql, /ST_CollectionExtract\(parsed_geom, 3\)/);
  assert.doesNotMatch(insertSql, /ST_IsValid/);
  assert.doesNotMatch(insertSql, /ST_MakeValid\(parsed_geom\)/);
});
