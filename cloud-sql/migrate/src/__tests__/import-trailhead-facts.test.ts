import { strict as assert } from "node:assert";
import path from "path";
import { test } from "node:test";
import {
  CANDIDATE_CHUNK_SIZE,
  importTrailheadFacts,
  parseArgs,
  SIMILARITY_CHUNK_SIZE,
  usage,
  type Args,
  type ImportDatabase,
} from "../import-trailhead-facts";
import { distanceMeters, normalizeTrailheadName, selectSamplePayloads } from "../trailhead-facts-utils";

const DATA_DIR = "/tmp/trailhead-facts-test";

interface FakeDestination {
  id: string;
  name: string;
  lat: number;
  lng: number;
  amenities?: unknown;
}

interface QueryCall {
  target: "pool" | "client";
  sql: string;
  params?: unknown[];
}

interface FakeDbOptions {
  destinations: FakeDestination[];
  pgTrgm?: boolean;
  runsTable?: boolean;
}

function rows<T>(list: T[]) {
  return { rows: list, rowCount: list.length };
}

function createFakeDb(options: FakeDbOptions) {
  const calls: QueryCall[] = [];
  const runsTable = options.runsTable !== false;

  async function run(target: "pool" | "client", sql: string, params?: unknown[]) {
    calls.push({ target, sql, params });

    if (sql.includes("extname = 'pg_trgm'")) {
      return rows([{ pg_trgm_ready: options.pgTrgm === true }]);
    }
    if (sql.includes("to_regclass('public.data_source_runs')")) {
      return rows([{ runs_table_ready: runsTable }]);
    }
    if (sql.includes("destinations_ready")) {
      return rows([
        {
          destinations_ready: true,
          amenities_ready: true,
          trailhead_feature_ready: true,
          postgis_ready: true,
        },
      ]);
    }
    if (sql.includes("JOIN LATERAL")) {
      const idx = params?.[0] as number[];
      const lats = params?.[1] as number[];
      const lngs = params?.[2] as number[];
      const radius = params?.[3] as number;
      const out: Array<{ idx: number; destination_id: string; destination_name: string; distance_m: number }> = [];
      idx.forEach((globalIdx, i) => {
        const point = { lat: lats[i], lng: lngs[i] };
        options.destinations
          .map((dest) => ({ dest, distance: distanceMeters(point, { lat: dest.lat, lng: dest.lng }) }))
          .filter((entry) => entry.distance <= radius)
          .sort((a, b) => a.distance - b.distance)
          .forEach((entry) => {
            out.push({
              idx: globalIdx,
              destination_id: entry.dest.id,
              destination_name: entry.dest.name,
              distance_m: entry.distance,
            });
          });
      });
      return rows(out);
    }
    if (sql.includes("similarity(")) {
      const idx = params?.[0] as number[];
      const sourceNames = params?.[1] as string[];
      const destNames = params?.[2] as string[];
      return rows(
        idx.map((value, i) => ({
          idx: value,
          similarity: sourceNames[i] === destNames[i] ? 1 : 0.2,
        }))
      );
    }
    if (sql.includes("SELECT id, amenities")) {
      const ids = (params?.[0] as string[]) ?? [];
      return rows(
        options.destinations
          .filter((dest) => ids.includes(dest.id))
          .map((dest) => ({ id: dest.id, amenities: dest.amenities ?? null }))
      );
    }
    return rows([]);
  }

  const db: ImportDatabase = {
    query: (sql: string, params?: unknown[]) => run("pool", sql, params) as never,
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => run("client", sql, params) as never,
      release: () => undefined,
    }),
  };

  return { db, calls };
}

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

const SNOW_LAKE = { lat: 47.4459, lng: -121.4231 };

function defaultFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "1001",
        name: "SNOW LAKE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: true,
        day_fee_usd: 5,
        annual_fee_usd: null,
        passes_accepted: ["Northwest Forest"],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "$5 per vehicle per day",
        as_of: "2026-08-19",
      },
      {
        source_dataset: "usfs_rec_sites",
        source_id: "1002",
        name: "NOWHERE TRAILHEAD",
        lat: 10,
        lng: 10,
        fee_required: false,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "No fees are required for this site",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "1001",
        name: "SNOW LAKE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        status: "present",
        type: "vault_pit",
        season_note: null,
        raw_string: "Vault toilet(s)",
        verbatim_quote: "Vault toilet(s)",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: jsonl([
      {
        url: "https://www.fs.usda.gov/r06/mbs/recreation/snow-lake-trailhead",
        capacity_estimate: 30,
        fills_early_note: "The lot fills before 8am on summer weekends.",
        fee_text: null,
        restroom_text: null,
        road_text: null,
        fetched_at: "2026-08-19T20:43:51+00:00",
      },
    ]),
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: jsonl([
      {
        url: "https://www.fs.usda.gov/r06/mbs/recreation/snow-lake-trailhead",
        name: "Snow Lake Trailhead",
        region: "r06",
      },
    ]),
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      {
        site_cn: "1001",
        site_name: "SNOW LAKE TRAILHEAD",
        public_site_name: "Snow Lake Trailhead",
        region: "06",
        fee_charged: "Y",
        fee_type: "STANDARD AMENITY FEE",
      },
      {
        site_cn: "1002",
        site_name: "NOWHERE TRAILHEAD",
        public_site_name: "Nowhere Trailhead",
        region: "06",
        fee_charged: "N",
        fee_type: null,
      },
    ]),
    ...overrides,
  };
}

function testArgs(overrides: Partial<Args> = {}): Args {
  return {
    dataDir: DATA_DIR,
    feesPath: null,
    bathroomsPath: null,
    sectionsPath: null,
    registryPath: null,
    rawRecSitesPath: null,
    reportDir: null,
    apply: false,
    dryRun: true,
    log: true,
    nameThreshold: null,
    radiusM: 250,
    limit: null,
    samplePayloads: 0,
    help: false,
    ...overrides,
  };
}

function createIo(files: Record<string, string>) {
  const written: Record<string, string> = {};
  const dirs: string[] = [];
  return {
    written,
    dirs,
    readFile: (filePath: string) => {
      const contents = files[filePath];
      if (contents === undefined) throw new Error(`missing test file ${filePath}`);
      return contents;
    },
    writeFile: (filePath: string, contents: string) => {
      written[filePath] = contents;
    },
    mkdir: (dir: string) => {
      dirs.push(dir);
    },
  };
}

const silent = { log: () => undefined, warn: () => undefined };

// --- argument parsing -------------------------------------------------------

test("the run is a dry run unless --apply is given", () => {
  assert.equal(parseArgs(["--data-dir=/tmp/data"]).dryRun, true);
  assert.equal(parseArgs(["--data-dir=/tmp/data"]).apply, false);
  const applied = parseArgs(["--data-dir=/tmp/data", "--apply"]);
  assert.equal(applied.apply, true);
  assert.equal(applied.dryRun, false);
});

test("--apply and --dry-run together are refused", () => {
  assert.throws(() => parseArgs(["--apply", "--dry-run"]), /cannot be used together/);
});

test("flags parse into the expected shape", () => {
  const args = parseArgs([
    "--data-dir=/tmp/data",
    "--report-dir=/tmp/reports",
    "--no-log",
    "--name-threshold=0.65",
    "--radius-m=150",
    "--limit=25",
  ]);
  assert.equal(args.reportDir, "/tmp/reports");
  assert.equal(args.log, false);
  assert.equal(args.nameThreshold, 0.65);
  assert.equal(args.radiusM, 150);
  assert.equal(args.limit, 25);
});

test("out-of-range numeric flags are refused", () => {
  assert.throws(() => parseArgs(["--name-threshold=0"]), /--name-threshold/);
  assert.throws(() => parseArgs(["--name-threshold=1.5"]), /--name-threshold/);
  assert.throws(() => parseArgs(["--radius-m=0"]), /--radius-m/);
  assert.throws(() => parseArgs(["--limit=0"]), /--limit/);
});

test("--help is recognized and the usage names the required flag", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.match(usage(), /--data-dir=DIR/);
});

test("a missing --data-dir fails with the usage text", async () => {
  await assert.rejects(
    () => importTrailheadFacts(testArgs({ dataDir: null }), { console: silent }),
    /--data-dir is required/
  );
});

test("the report directory is prepared before the database is touched", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  await importTrailheadFacts(testArgs({ reportDir: "/tmp/somewhere-else" }), {
    db,
    console: silent,
    ...io,
  });
  assert.deepEqual(io.dirs, ["/tmp/somewhere-else"]);
  assert.equal(calls.length > 0, true);
});

test("an unusable report directory fails before any query or write", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  await assert.rejects(
    () =>
      importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
        db,
        console: silent,
        ...io,
        mkdir: () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    /EACCES/
  );
  // The reports are written after the apply transaction commits, so a bad
  // report directory must stop the run before it writes to the database.
  assert.deepEqual(calls, []);
  assert.deepEqual(io.written, {});
});

// --- dry run ----------------------------------------------------------------

test("a dry run writes nothing, reports the unmatched rows, and logs a dry_run", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.nameMeasure, "token_overlap");
  assert.equal(summary.destinationsChanged, 1);
  assert.equal(summary.counts.usfs_fees.matched, 1);
  assert.equal(summary.counts.usfs_fees.noNearbyTrailhead, 1);
  assert.equal(summary.counts.usfs_bathrooms.matched, 1);
  assert.equal(summary.counts.usfs_pages.matched, 1);

  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(calls.some((call) => call.sql === "BEGIN"), false);

  const runInserts = calls.filter((call) => call.sql.includes("INSERT INTO data_source_runs"));
  assert.equal(runInserts.length, 3);
  assert.deepEqual(
    runInserts.map((call) => call.params?.[0]),
    ["usfs_fees", "usfs_bathrooms", "usfs_pages"]
  );
  for (const insert of runInserts) {
    assert.equal(insert.params?.[1], "import");
    assert.equal(insert.params?.[2], "dry_run");
  }

  const feeReport = io.written[path.join(DATA_DIR, "import-unmatched-fees.jsonl")];
  const reported = feeReport.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(reported.length, 1);
  assert.equal(reported[0].reason, "no_nearby_trailhead");
  assert.equal(reported[0].row.source_id, "1002");
});

test("a nearby destination with a different name is reported, not written", async () => {
  const { db } = createFakeDb({
    destinations: [{ id: "dest-other", name: "Denny Creek Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_fees.matched, 0);
  assert.equal(summary.counts.usfs_fees.nameRejected, 1);
  assert.equal(summary.destinationsChanged, 0);

  const reported = io.written[path.join(DATA_DIR, "import-unmatched-fees.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const rejected = reported.find((record) => record.reason === "name_below_threshold");
  assert.equal(rejected.best_candidate.destination_id, "dest-other");
  assert.ok(rejected.best_candidate.similarity < 0.7);
});

// --- apply ------------------------------------------------------------------

test("apply merges every source into one destination row inside a transaction", async () => {
  const { db, calls } = createFakeDb({
    destinations: [
      { id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE, amenities: { toilet: "vault" } },
    ],
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.destinationsChanged, 1);
  const order = calls.filter((call) => call.target === "client").map((call) => call.sql);
  assert.equal(order[1], "BEGIN");
  assert.equal(order[order.length - 1], "COMMIT");

  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  assert.equal(update?.params?.[0], "dest-snow");
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.toilet, "vault", "unrelated campsite keys survive");
  assert.equal(merged.parking.fee_required.value, true);
  assert.equal(merged.parking.day_fee_usd.value, 5);
  assert.deepEqual(merged.parking.passes_accepted.value, ["Northwest Forest"]);
  assert.equal(merged.parking.capacity_vehicles.value, 30);
  assert.equal(merged.parking.capacity_vehicles.source.kind, "usfs_web");
  assert.equal(merged.parking.fills_early_note.value, "The lot fills before 8am on summer weekends.");
  assert.equal(merged.bathrooms.status.value, "present");
  assert.equal(merged.bathrooms.type.value, "vault_pit");

  const runInserts = calls.filter((call) => call.sql.includes("INSERT INTO data_source_runs"));
  assert.deepEqual(
    runInserts.map((call) => call.params?.[2]),
    ["success", "success", "success"]
  );
  assert.deepEqual(
    runInserts.map((call) => [call.params?.[0], call.params?.[5], call.params?.[6], call.params?.[7]]),
    [
      ["usfs_fees", 2, 1, 1],
      ["usfs_bathrooms", 1, 1, 1],
      ["usfs_pages", 1, 1, 1],
    ]
  );
});

test("a second apply over the same facts rewrites nothing", async () => {
  const first = createFakeDb({ destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }] });
  const io = createIo(defaultFiles());
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db: first.db, console: silent, ...io });
  const update = first.calls.find((call) => call.sql.includes("UPDATE destinations"));
  const stored = JSON.parse(update?.params?.[1] as string);

  const second = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE, amenities: stored }],
  });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db: second.db,
    console: silent,
    ...io,
  });

  assert.equal(summary.destinationsChanged, 0);
  assert.equal(summary.destinationsUnchanged, 1);
  assert.equal(second.calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(second.calls.some((call) => call.sql === "BEGIN"), false);
});

test("--no-log skips run logging entirely", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  await importTrailheadFacts(testArgs({ log: false }), { db, console: silent, ...io });
  assert.equal(calls.some((call) => call.sql.includes("data_source_runs")), false);
});

test("a missing data_source_runs table warns and the import still finishes", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
    runsTable: false,
  });
  const warnings: string[] = [];
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: { log: () => undefined, warn: (message: string) => warnings.push(message) },
    ...io,
  });

  assert.equal(summary.destinationsChanged, 1);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO data_source_runs")), false);
  assert.ok(warnings.some((message) => message.includes("data_source_runs is missing")));
});

// --- gates and conflicts on live-shaped input -------------------------------

test("pg_trgm scores the name gate when the extension is present", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
    pgTrgm: true,
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.nameMeasure, "pg_trgm");
  assert.equal(summary.nameThreshold, 0.5);
  const similarityCall = calls.find((call) => call.sql.includes("similarity("));
  assert.ok(similarityCall, "the name gate went through pg_trgm");
  assert.equal(
    (similarityCall?.params?.[1] as string[])[0],
    normalizeTrailheadName("SNOW LAKE TRAILHEAD")
  );
  assert.equal(summary.counts.usfs_fees.matched, 1);
});

function noFeeFiles(overrides: { quote: string; feeCharged: string }): Record<string, string> {
  return defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "1001",
        name: "SNOW LAKE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: false,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "low",
        verbatim_quote: overrides.quote,
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      {
        site_cn: "1001",
        site_name: "SNOW LAKE TRAILHEAD",
        public_site_name: "Snow Lake Trailhead",
        region: "06",
        fee_charged: overrides.feeCharged,
        fee_type: overrides.feeCharged === "Y" ? "STANDARD AMENITY FEE" : null,
      },
    ]),
  });
}

test("a no-fee claim the raw dataset contradicts never reaches the row", async () => {
  // The quote is the EDW boilerplate that ships as the default, so the quote
  // guard passes; fee_charged='Y' is what stops it.
  const files = noFeeFiles({ quote: "No fees are required for this site", feeCharged: "Y" });
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_fees.refusals.fee_required_false_contradicted_by_fee_charged, 1);
  assert.equal(summary.counts.usfs_fees.matched, 0);
  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.parking.fee_required, undefined, "the contradicted no-fee claim is dropped");
});

test("the same row is written when the raw dataset agrees there is no fee", async () => {
  const files = noFeeFiles({ quote: "No fees are required for this site", feeCharged: "N" });
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db, console: silent, ...io });
  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.parking.fee_required.value, false);
});

test("a missing raw EDW pull stops the import rather than weakening the guard", async () => {
  const files = defaultFiles();
  delete files[path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")];
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  await assert.rejects(
    () => importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) }),
    /usfs-rec-sites-trailheads\.jsonl/
  );
});

test("fee_required=false without a quote never reaches the row", async () => {
  const files = noFeeFiles({ quote: "", feeCharged: "N" });
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_fees.refusals.fee_required_false_without_quote, 1);
  assert.equal(summary.counts.usfs_fees.matched, 0);
  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.parking.fee_required, undefined, "the unquoted no-fee claim is dropped");
  assert.equal(merged.parking.capacity_vehicles.value, 30, "the page facts still land");
  assert.equal(merged.bathrooms.status.value, "present");
});

test("a page row whose name cannot be located is counted, not guessed", async () => {
  const files = defaultFiles({
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: jsonl([
      {
        url: "https://www.fs.usda.gov/r06/mbs/recreation/snow-lake-trailhead",
        name: "Some Page With No EDW Row",
      },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_pages.noLocation, 1);
  assert.equal(summary.counts.usfs_pages.refusals.no_edw_name_location, 1);
  assert.equal(summary.counts.usfs_pages.matched, 0);

  const reported = io.written[path.join(DATA_DIR, "import-unmatched-pages.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    reported.map((record) => record.reason),
    ["no_edw_name_location"]
  );
});

test("a page never borrows a point from another Forest Service region", async () => {
  const files = defaultFiles({
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: jsonl([
      {
        url: "https://www.fs.usda.gov/r06/mbs/recreation/snow-lake-trailhead",
        name: "Snow Lake Trailhead",
        region: "r09",
      },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_pages.matched, 0);
  assert.equal(summary.counts.usfs_pages.refusals.region_mismatch, 1);
  const reported = io.written[path.join(DATA_DIR, "import-unmatched-pages.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    reported.map((record) => record.reason),
    ["region_mismatch"]
  );
  assert.equal(reported[0].wanted_region, "09", "the report says what was compared");
  assert.deepEqual(reported[0].point_regions, ["06"]);
});

test("a page whose EDW point carries no region is counted separately", async () => {
  // The point comes from a recreation-opportunity fee row, which has no raw
  // counterpart and therefore no region — not a cross-country name clash.
  const pageUrl = "https://www.fs.usda.gov/r09/marktwain/recreation/blue-hole-trailhead";
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_recreation_opportunities",
        source_id: "9001",
        name: "BLUE HOLE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "fee",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: "",
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: jsonl([
      {
        url: pageUrl,
        capacity_estimate: 12,
        fills_early_note: null,
        fee_text: null,
        restroom_text: null,
        road_text: null,
        fetched_at: "2026-08-19T20:43:51+00:00",
      },
    ]),
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: jsonl([
      { url: pageUrl, name: "Blue Hole Trailhead", region: "r09" },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-blue", name: "Blue Hole Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_pages.refusals.region_unknown, 1);
  assert.equal(summary.counts.usfs_pages.refusals.region_mismatch, undefined);
  const reported = io.written[path.join(DATA_DIR, "import-unmatched-pages.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(reported[0].reason, "region_unknown");
  assert.equal(reported[0].wanted_region, "09");
  assert.deepEqual(reported[0].point_regions, []);
});

test("a quote-only no-fee claim is written and counted", async () => {
  // A recreation-opportunity row has no raw counterpart, so its no-fee claim
  // rests on its quote alone. It writes — and it is counted, not silent.
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_recreation_opportunities",
        // The same id as a rec-site row with fee_charged='Y': a dataset-blind
        // lookup would inherit that flag and wrongly refuse this row.
        source_id: "1001",
        name: "SNOW LAKE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: false,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "No fees are required for this site",
        as_of: "2026-08-19",
      },
    ]),
  });
  const { db, calls } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_fees.notices.fee_required_false_quote_only, 1);
  assert.equal(summary.counts.usfs_fees.refusals.fee_required_false_contradicted_by_fee_charged, undefined);
  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.parking.fee_required.value, false);
});

test("the public site name can clear the gate when the internal name cannot", async () => {
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "2001",
        name: "MARTIN BRIDGE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "$5 per vehicle",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      {
        site_cn: "2001",
        site_name: "MARTIN BRIDGE TRAILHEAD",
        public_site_name: "Eagle Forks Trailhead",
        region: "06",
        fee_charged: "Y",
        fee_type: null,
      },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-eagle", name: "Eagle Forks Trailhead", ...SNOW_LAKE }],
  });
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) });
  assert.equal(summary.counts.usfs_fees.matched, 1);
  assert.equal(summary.destinationsChanged, 1);
});

test("the report says which name scored best", async () => {
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "2001",
        name: "MARTIN BRIDGE TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "$5 per vehicle",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      {
        site_cn: "2001",
        site_name: "MARTIN BRIDGE TRAILHEAD",
        public_site_name: "Eagle Forks Trailhead",
        region: "06",
        fee_charged: "Y",
        fee_type: null,
      },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-basin", name: "Eagle Fork Basin", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_fees.nameRejected, 1);
  const rejected = io.written[path.join(DATA_DIR, "import-unmatched-fees.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((record) => record.reason === "name_below_threshold");
  assert.equal(rejected.best_candidate.matched_name, "Eagle Forks Trailhead");
});

test("--limit does not shrink the index a page row is located from", async () => {
  const pageUrl = "https://www.fs.usda.gov/r06/mbs/recreation/second-trailhead";
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "3001",
        name: "FIRST TRAILHEAD",
        lat: 40,
        lng: -120,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "fee",
        as_of: "2026-08-19",
      },
      {
        source_dataset: "usfs_rec_sites",
        source_id: "3002",
        name: "SECOND TRAILHEAD",
        lat: SNOW_LAKE.lat,
        lng: SNOW_LAKE.lng,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "fee",
        as_of: "2026-08-19",
      },
    ]),
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: "",
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: jsonl([
      {
        url: pageUrl,
        capacity_estimate: 30,
        fills_early_note: null,
        fee_text: null,
        restroom_text: null,
        road_text: null,
        fetched_at: "2026-08-19T20:43:51+00:00",
      },
    ]),
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: jsonl([
      { url: pageUrl, name: "Second Trailhead", region: "r06" },
    ]),
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      { site_cn: "3001", site_name: "FIRST TRAILHEAD", region: "06", fee_charged: "Y" },
      { site_cn: "3002", site_name: "SECOND TRAILHEAD", region: "06", fee_charged: "Y" },
    ]),
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-second", name: "Second Trailhead", ...SNOW_LAKE }],
  });
  // The fee row that locates the page sits past the limit, so a limited run
  // must still read the whole file to build the location index.
  const summary = await importTrailheadFacts(testArgs({ limit: 1 }), {
    db,
    console: silent,
    ...createIo(files),
  });
  assert.equal(summary.counts.usfs_fees.rowsIn, 1, "matching still honours the limit");
  assert.equal(summary.counts.usfs_pages.matched, 1, "the page still finds its point");
});

test("a dry run can print real payloads for the human apply gate", async () => {
  const { db } = createFakeDb({
    destinations: [
      { id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE },
      { id: "dest-other", name: "Nowhere Trailhead", lat: 10, lng: 10 },
    ],
  });
  const logs: string[] = [];
  const summary = await importTrailheadFacts(testArgs({ samplePayloads: 2 }), {
    db,
    console: { log: (message: string) => logs.push(String(message)), warn: () => undefined },
    ...createIo(defaultFiles()),
  });

  const header = logs.find((line) => line.startsWith("Sample amenity payloads"));
  assert.ok(header, "the sample section is printed");
  assert.match(header as string, new RegExp(`of ${summary.destinationsChanged}, richest first`));
  assert.ok(
    logs.some((line) => line.includes("dest-snow") && line.includes("Snow Lake Trailhead")),
    "each payload names the destination it would land on"
  );

  const payloads = logs.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  assert.equal(payloads.length, summary.destinationsChanged);
  const parking = payloads[0].parking;
  assert.equal(parking.fee_required.value, true);
  assert.equal(parking.fee_required.source.kind, "usfs_edw");
  assert.equal(parking.fee_required.retrieved_at, "2026-08-19");
});

test("payload sampling is richest-first and stable across runs", async () => {
  const pending = [
    { id: "b", merged: { parking: { fee_required: {}, day_fee_usd: {} } } },
    { id: "a", merged: { parking: { fee_required: {}, day_fee_usd: {} } } },
    { id: "c", merged: { parking: { fee_required: {}, day_fee_usd: {} }, bathrooms: { status: {} } } },
    { id: "d", merged: { bathrooms: { status: {} } } },
  ];
  assert.deepEqual(selectSamplePayloads(pending, 3).map((row) => row.id), ["c", "a", "b"]);
  assert.deepEqual(selectSamplePayloads(pending, 3).map((row) => row.id), ["c", "a", "b"]);
  assert.deepEqual(selectSamplePayloads(pending, 0), []);
});

test("an apply prints no payload sample", async () => {
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const logs: string[] = [];
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false, samplePayloads: 5 }), {
    db,
    console: { log: (message: string) => logs.push(String(message)), warn: () => undefined },
    ...createIo(defaultFiles()),
  });
  assert.equal(logs.some((line) => line.startsWith("Sample amenity payloads")), false);
});

test("--limit bounds how many rows each source contributes", async () => {
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs({ limit: 1 }), { db, console: silent, ...io });
  assert.equal(summary.counts.usfs_fees.rowsIn, 1);
  assert.equal(summary.counts.usfs_fees.noNearbyTrailhead, 0);
});

// --- chunk boundaries -------------------------------------------------------

test("rows keep their own candidates across candidate and similarity chunks", async () => {
  // 1,201 rows × 4 candidates spans four CANDIDATE_CHUNK_SIZE chunks and three
  // SIMILARITY_CHUNK_SIZE chunks, so any off-by-one in the chunk arithmetic
  // would hand a row another row's candidates.
  const rowCount = 1201;
  const candidatesPerRow = 4;
  assert.ok(rowCount > CANDIDATE_CHUNK_SIZE * 2, "spans at least three candidate chunks");
  assert.ok(rowCount * candidatesPerRow > SIMILARITY_CHUNK_SIZE * 2, "spans at least three similarity chunks");

  const files = {
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl(
      Array.from({ length: rowCount }, (_, i) => ({
        source_dataset: "usfs_rec_sites",
        source_id: `chunk-${i}`,
        name: `Trailhead ${i}`,
        lat: 40 + i * 0.01,
        lng: -120,
        fee_required: true,
        day_fee_usd: null,
        annual_fee_usd: null,
        passes_accepted: [],
        fee_waived_for: [],
        confidence: "high",
        verbatim_quote: "fee",
        as_of: "2026-08-19",
      }))
    ),
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: "",
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: "",
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: "",
    [path.join(DATA_DIR, "raw", "usfs-rec-sites-trailheads.jsonl")]: jsonl([
      { site_cn: "chunk-0", site_name: "Trailhead 0", region: "06", fee_charged: "Y" },
    ]),
  };

  let candidateQueries = 0;
  let similarityQueries = 0;
  const updates: Array<{ id: string; amenities: string }> = [];
  const db: ImportDatabase = {
    query: (async (sql: string, params?: unknown[]) => {
      if (sql.includes("extname = 'pg_trgm'")) return rows([{ pg_trgm_ready: true }]);
      if (sql.includes("to_regclass('public.data_source_runs')")) return rows([{ runs_table_ready: false }]);
      if (sql.includes("JOIN LATERAL")) {
        candidateQueries += 1;
        const idx = params?.[0] as number[];
        const out: Array<{ idx: number; destination_id: string; destination_name: string; distance_m: number }> = [];
        for (const value of idx) {
          out.push({ idx: value, destination_id: `dest-${value}`, destination_name: `Trailhead ${value}`, distance_m: 10 });
          for (let decoy = 1; decoy < candidatesPerRow; decoy++) {
            out.push({
              idx: value,
              destination_id: `decoy-${value}-${decoy}`,
              destination_name: `Other Place ${value}`,
              distance_m: 10 + decoy,
            });
          }
        }
        return rows(out);
      }
      if (sql.includes("similarity(")) {
        similarityQueries += 1;
        const idx = params?.[0] as number[];
        const sourceNames = params?.[1] as string[];
        const destNames = params?.[2] as string[];
        return rows(idx.map((value, i) => ({ idx: value, similarity: sourceNames[i] === destNames[i] ? 1 : 0.2 })));
      }
      if (sql.includes("SELECT id, amenities")) return rows([]);
      return rows([]);
    }) as never,
    connect: async () => ({
      query: (async (sql: string, params?: unknown[]) => {
        if (sql.includes("UPDATE destinations")) {
          updates.push({ id: params?.[0] as string, amenities: params?.[1] as string });
        }
        if (sql.includes("destinations_ready")) {
          return rows([
            { destinations_ready: true, amenities_ready: true, trailhead_feature_ready: true, postgis_ready: true },
          ]);
        }
        return rows([]);
      }) as never,
      release: () => undefined,
    }),
  };

  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(files),
  });

  assert.equal(candidateQueries, Math.ceil(rowCount / CANDIDATE_CHUNK_SIZE));
  assert.equal(similarityQueries, Math.ceil((rowCount * candidatesPerRow) / SIMILARITY_CHUNK_SIZE));
  assert.equal(summary.counts.usfs_fees.matched, rowCount);
  assert.equal(updates.length, rowCount);
  assert.deepEqual(
    updates.map((update) => update.id).sort(),
    Array.from({ length: rowCount }, (_, i) => `dest-${i}`).sort(),
    "every row matched its own destination, not a neighbouring chunk's"
  );
});
