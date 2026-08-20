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
  /** Road rows land by id, so a destination can be present and not a trailhead. */
  isTrailhead?: boolean;
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
    if (sql.includes("is_trailhead")) {
      const ids = (params?.[0] as string[]) ?? [];
      return rows(
        options.destinations
          .filter((dest) => ids.includes(dest.id))
          .map((dest) => ({
            id: dest.id,
            name: dest.name,
            is_trailhead: dest.isTrailhead !== false,
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

// The run's year decides how far a gate window may sit from today, so it is
// pinned rather than read off the wall clock.
const RUN_DATE = new Date(Date.UTC(2026, 7, 20));

const FEDERAL_PUBLIC_DOMAIN = "public domain (US federal government)";
const ROADCORE_SOURCE = {
  kind: "usfs_roadcore",
  name: "USFS National Forest System Roads (RoadCore)",
  url: "https://example.invalid/roadcore",
  license: FEDERAL_PUBLIC_DOMAIN,
};
const MVUM_SOURCE = {
  kind: "usfs_mvum",
  name: "USFS Motor Vehicle Use Map roads",
  license: FEDERAL_PUBLIC_DOMAIN,
};
const NPS_POIS_SOURCE = {
  kind: "nps_pois",
  name: "National Park Service",
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs/FeatureServer/0/query",
  license: FEDERAL_PUBLIC_DOMAIN,
};
const NPS_PARKING_SOURCE = {
  kind: "nps_parking",
  name: "National Park Service",
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_ParkingLots/MapServer/0/query",
  license: FEDERAL_PUBLIC_DOMAIN,
};

function npsLeaf(value: unknown, source: Record<string, unknown>): Record<string, unknown> {
  return { value, source, retrieved_at: "2026-08-19" };
}

/** A row shaped exactly as `normalize:nps-trailhead-facts` writes one. */
function npsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    destination_id: "dest-snow",
    destination_name: "Snow Lake Trailhead",
    parking: {
      type: npsLeaf("lot", NPS_PARKING_SOURCE),
      location_note: npsLeaf("SNOW LAKE PARKING (UPPER LOT)", NPS_PARKING_SOURCE),
    },
    diagnostics: {
      parking: {
        distance_m: 0,
        inside_lot: true,
        lot_name: "SNOW LAKE PARKING (UPPER LOT)",
        lot_name_field: "MAPLABEL",
        candidates_within_gate: 1,
        skipped: [],
      },
    },
    ...overrides,
  };
}

/** The bathroom half, which the default fixture leaves to the Forest Service. */
function npsBathroomBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: npsLeaf("present", NPS_POIS_SOURCE),
    type: npsLeaf("unspecified", NPS_POIS_SOURCE),
    ...overrides,
  };
}

/** A row shaped exactly as `roads:derive` writes one. */
function roadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    destination_id: "dest-snow",
    destination_name: "Snow Lake Trailhead",
    snapped: true,
    snap_distance_m: 18,
    anchor_reached: true,
    high_clearance: { value: "required", source: ROADCORE_SOURCE, retrieved_at: "2026-08-19" },
    four_wheel_drive: { value: false, source: ROADCORE_SOURCE, retrieved_at: "2026-08-19" },
    surface: { value: "gravel", source: ROADCORE_SOURCE, retrieved_at: "2026-08-19" },
    seasonal_window: {
      value: { opens: "2026-04-02", closes: "2026-11-30" },
      source: MVUM_SOURCE,
      retrieved_at: "2026-08-19",
    },
    limiting_segment_ref: {
      value: "FR 8040-550",
      source: ROADCORE_SOURCE,
      retrieved_at: "2026-08-19",
    },
    derivation: {
      snap_segment_key: "usfs_roadcore:{A}",
      path_miles: 39.17,
      path_segment_keys: ["usfs_roadcore:{A}", "usfs_roadcore:{Z}"],
      season_segments: 2,
      season_segments_with_window: 2,
      season_segments_without_evidence: 0,
      season_windows_found: 1,
    },
    ...overrides,
  };
}

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
    [path.join(DATA_DIR, "trailhead-road-access.jsonl")]: jsonl([
      roadRow(),
      // The derivation writes a row per trailhead whether or not it answered.
      {
        destination_id: "dest-nothing",
        destination_name: "Nowhere Trailhead",
        snapped: false,
        snap_distance_m: null,
        anchor_reached: false,
        skip_reason: "no_snap",
      },
    ]),
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: jsonl([npsRow()]),
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
    roadAccessPath: null,
    npsFactsPath: null,
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
    // Every run gets the same clock with its file handles, so the gate-window
    // year bound is a fixed distance from the run rather than from today.
    now: () => RUN_DATE,
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
  assert.equal(runInserts.length, 6);
  assert.deepEqual(
    runInserts.map((call) => call.params?.[0]),
    ["usfs_fees", "usfs_bathrooms", "usfs_pages", "usfs_roads", "nps_pois", "nps_parking"]
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
  assert.equal(merged.road_access.high_clearance.value, "required");
  assert.equal(merged.road_access.surface.value, "gravel");
  assert.equal(merged.road_access.surface.source.kind, "usfs_roadcore");

  const runInserts = calls.filter((call) => call.sql.includes("INSERT INTO data_source_runs"));
  assert.deepEqual(
    runInserts.map((call) => call.params?.[2]),
    ["success", "success", "success", "success", "success", "success"]
  );
  assert.deepEqual(
    runInserts.map((call) => [call.params?.[0], call.params?.[5], call.params?.[6], call.params?.[7]]),
    [
      ["usfs_fees", 2, 1, 1],
      ["usfs_bathrooms", 1, 1, 1],
      ["usfs_pages", 1, 1, 1],
      ["usfs_roads", 2, 1, 1],
      // The default NPS row carries a parking block only, so the POI service
      // reads no rows at all while the parking service reads and writes one.
      ["nps_pois", 0, 0, 0],
      ["nps_parking", 1, 1, 1],
    ]
  );
  assert.equal(merged.parking.type.value, "lot");
  assert.equal(merged.parking.type.source.kind, "nps_parking");
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

test("a qualifier-only difference matches on containment and says so", async () => {
  // "Windy Peak Trailhead/Long Swamp" against "Windy Peak Trailhead": a real
  // near-miss from the production dry run, 0.0 m apart, below the threshold.
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "7001",
        name: "WINDY PEAK TRAILHEAD/LONG SWAMP",
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
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: "",
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: "",
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-windy", name: "Windy Peak Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(files);
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_fees.matched, 1);
  assert.deepEqual(summary.counts.usfs_fees.matchedByRule, {
    threshold: 0,
    containment: 1,
    exact_id: 0,
  });
  assert.equal(summary.destinationsChanged, 1);

  const matched = io.written[path.join(DATA_DIR, "import-matched.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(matched.length, 1);
  assert.equal(matched[0].rule, "containment");
  assert.equal(matched[0].destination_id, "dest-windy");
  assert.equal(matched[0].matched_name, "WINDY PEAK TRAILHEAD/LONG SWAMP");
  assert.ok(matched[0].similarity < summary.nameThreshold, "it did not clear the threshold");
});

test("a name that only shares a word still fails both rules", async () => {
  const files = defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: jsonl([
      {
        source_dataset: "usfs_rec_sites",
        source_id: "7002",
        name: "WILLOW LAKE",
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
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: "",
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: "",
  });
  const { db } = createFakeDb({
    destinations: [{ id: "dest-willow", name: "Willow Creek Trailhead", ...SNOW_LAKE }],
  });
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) });

  assert.equal(summary.counts.usfs_fees.matched, 0);
  assert.equal(summary.counts.usfs_fees.nameRejected, 1);
  assert.equal(summary.destinationsChanged, 0);
});

test("a threshold match is recorded as one", async () => {
  const { db } = createFakeDb({
    destinations: [{ id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE }],
  });
  const io = createIo(defaultFiles());
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_fees.matchedByRule.threshold, 1);
  assert.equal(summary.counts.usfs_fees.matchedByRule.containment, 0);
  const matched = io.written[path.join(DATA_DIR, "import-matched.jsonl")]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual([...new Set(matched.map((record) => record.rule))].sort(), [
    "exact_id",
    "threshold",
  ]);
  assert.deepEqual(
    matched.map((record) => record.source).sort(),
    ["nps_parking", "usfs_bathrooms", "usfs_fees", "usfs_pages", "usfs_roads"]
  );
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
    // Neither derived file is under test here, and neither may be empty.
    [path.join(DATA_DIR, "trailhead-road-access.jsonl")]: jsonl([UNANSWERED_ROAD_ROW]),
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: jsonl([
      npsRow({ destination_id: "dest-elsewhere", destination_name: "Elsewhere" }),
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

// --- access-road facts ------------------------------------------------------

const SNOW_DEST = { id: "dest-snow", name: "Snow Lake Trailhead", ...SNOW_LAKE };

/** A data directory holding one road row and nothing else worth matching. */
function roadOnlyFiles(rows: Array<Record<string, unknown>>): Record<string, string> {
  return defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: "",
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: "",
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: "",
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: "",
    [path.join(DATA_DIR, "trailhead-road-access.jsonl")]: jsonl(rows),
    // Both derived files must hold at least one row or the import refuses to
    // start, so the source under test is isolated with a row that lands
    // nowhere rather than with an empty file.
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: jsonl([
      npsRow({ destination_id: "dest-elsewhere", destination_name: "Elsewhere" }),
    ]),
  });
}

/** A road row the derivation could not answer: parsed, but carrying no fact. */
const UNANSWERED_ROAD_ROW = {
  destination_id: "dest-elsewhere",
  destination_name: "Elsewhere",
  snapped: false,
  snap_distance_m: null,
  anchor_reached: false,
  skip_reason: "no_snap",
};

/** A data directory holding one NPS row and nothing else worth matching. */
function npsOnlyFiles(rows: Array<Record<string, unknown>>): Record<string, string> {
  return defaultFiles({
    [path.join(DATA_DIR, "trailhead-fees.jsonl")]: "",
    [path.join(DATA_DIR, "trailhead-bathrooms.jsonl")]: "",
    [path.join(DATA_DIR, "fs-page-sections.jsonl")]: "",
    [path.join(DATA_DIR, "fs-trailhead-page-registry.jsonl")]: "",
    [path.join(DATA_DIR, "trailhead-road-access.jsonl")]: jsonl([UNANSWERED_ROAD_ROW]),
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: jsonl(rows),
  });
}

function roadReport(io: ReturnType<typeof createIo>): Array<Record<string, unknown>> {
  return io.written[path.join(DATA_DIR, "import-rejected-roads.jsonl")]
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("a road row lands on its own destination id, with no name gate at all", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow()]));
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.matched, 1);
  assert.equal(summary.counts.usfs_roads.matchedByRule.exact_id, 1);
  assert.equal(summary.counts.usfs_roads.rowsWritten, 1);
  assert.equal(summary.destinationsChanged, 1);
  // The name gate is not consulted: the derivation started from this row.
  assert.equal(calls.some((call) => call.sql.includes("JOIN LATERAL")), false);

  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  assert.equal(update?.params?.[0], "dest-snow");
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.road_access.high_clearance.value, "required");
  assert.equal(merged.road_access.four_wheel_drive.value, false);
  assert.equal(merged.road_access.surface.value, "gravel");
  assert.deepEqual(merged.road_access.seasonal_window.value, {
    opens: "2026-04-02",
    closes: "2026-11-30",
  });
  assert.equal(merged.road_access.limiting_segment_ref.value, "FR 8040-550");
  // Every leaf carries the layer that answered it, and its own retrieval date.
  assert.equal(merged.road_access.seasonal_window.source.kind, "usfs_mvum");
  assert.equal(merged.road_access.high_clearance.source.kind, "usfs_roadcore");
  assert.equal(merged.road_access.high_clearance.source.url, "https://example.invalid/roadcore");
  assert.equal(merged.road_access.high_clearance.retrieved_at, "2026-08-19");
  // The terms travel with the name: a credit that says who told us and not
  // whether a reader may repeat it is half a credit.
  for (const leaf of Object.values(merged.road_access) as Array<Record<string, never>>) {
    assert.equal(
      (leaf as unknown as { source: { license?: string } }).source.license,
      FEDERAL_PUBLIC_DOMAIN
    );
  }
});

test("a source url that is not an http link never reaches the row", async () => {
  // The clients render a source url as something tappable.
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        surface: {
          value: "gravel",
          source: { ...ROADCORE_SOURCE, url: "javascript:alert(1)" },
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db, console: silent, ...io });
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.surface.value, "gravel", "the fact still lands");
  assert.equal(merged.road_access.surface.source.url, undefined);
  assert.equal(merged.road_access.surface.source.license, FEDERAL_PUBLIC_DOMAIN);
});

test("a leaf with no licence still lands, crediting the name alone", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        surface: {
          value: "gravel",
          source: { kind: "usfs_roadcore", name: "RoadCore" },
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db, console: silent, ...io });
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.surface.value, "gravel");
  assert.equal("license" in merged.road_access.surface.source, false);
});

test("the audit block never reaches the database, and neither does the drive", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow()]));
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db, console: silent, ...io });

  const written = calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string;
  assert.equal(written.includes("derivation"), false);
  assert.equal(written.includes("path_miles"), false);
  assert.equal(written.includes("39.17"), false);
  assert.equal(written.includes("snap_segment_key"), false);
  const merged = JSON.parse(written);
  assert.deepEqual(Object.keys(merged.road_access).sort(), [
    "four_wheel_drive",
    "high_clearance",
    "limiting_segment_ref",
    "seasonal_window",
    "surface",
  ]);
});

test("a row the derivation could not answer is skipped by its own reason", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      {
        destination_id: "dest-snow",
        destination_name: "Snow Lake Trailhead",
        snapped: true,
        snap_distance_m: 30,
        anchor_reached: false,
        skip_reason: "no_anchor",
      },
    ])
  );
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.refusals.skipped_no_anchor, 1);
  assert.equal(summary.counts.usfs_roads.noFacts, 1);
  assert.equal(summary.counts.usfs_roads.matched, 0);
  assert.equal(summary.destinationsChanged, 0);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
});

test("an unranked path is skipped whole, surface and road reference included", async () => {
  // The derivation still publishes what it knows on such a row. The importer
  // does not: a partial answer under a skip reason reads as a complete one.
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow({ skip_reason: "unranked_path" })]));
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_roads.refusals.skipped_unranked_path, 1);
  assert.equal(summary.destinationsChanged, 0);
});

test("a gate window resting on unchecked road is refused and named", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const warnings: string[] = [];
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        derivation: { season_segments: 7, season_segments_without_evidence: 2 },
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: { log: () => undefined, warn: (message: string) => warnings.push(String(message)) },
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.refusals.seasonal_window_evidence_gap, 1);
  // The emission gate should have caught this, so arriving here is loud.
  assert.ok(warnings.some((message) => message.includes("dest-snow")));
  // The rest of the row is still a good answer and still lands.
  assert.equal(summary.counts.usfs_roads.matched, 1);
  assert.equal(summary.destinationsChanged, 1);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.seasonal_window, undefined);
  assert.equal(merged.road_access.high_clearance.value, "required");
});

test("a row with no evidence counter at all keeps its window to itself", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow({ derivation: undefined })]));
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });
  assert.equal(summary.counts.usfs_roads.refusals.seasonal_window_evidence_gap, 1);
});

test("a gate date that is not an ISO day is refused, never reformatted", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        seasonal_window: {
          value: { opens: "04/02", closes: "2026-11-30" },
          source: MVUM_SOURCE,
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.refusals.seasonal_window_not_iso, 1);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.seasonal_window, undefined);
  assert.equal(merged.road_access.surface.value, "gravel", "the rest of the row still lands");
});

test("a day the calendar does not have is not an ISO date", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        seasonal_window: {
          value: { opens: "2026-04-02", closes: "2026-02-30" },
          source: MVUM_SOURCE,
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });
  assert.equal(summary.counts.usfs_roads.refusals.seasonal_window_not_iso, 1);
});

test("a window anchored years from the run is refused and reported", async () => {
  // The real one: "Stewart Creek Trailhead", whose window touches February 29
  // and is therefore anchored to the next leap year, two years out.
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        seasonal_window: {
          value: { opens: "2027-05-28", closes: "2028-02-29" },
          source: MVUM_SOURCE,
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.counts.usfs_roads.refusals.seasonal_window_out_of_range, 1);
  assert.equal(summary.counts.usfs_roads.matched, 1, "the vehicle answer is unaffected");

  // A thrown-away fact needs somewhere a person can go and read it.
  const reported = roadReport(io);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].reason, "seasonal_window_out_of_range");
  assert.equal(reported[0].destination_id, "dest-snow");
  assert.deepEqual(reported[0].refusals, ["seasonal_window_out_of_range"]);
});

test("a row the derivation could not answer is not written to the report", async () => {
  // 590 of the 918 rows today. The counts already say so, and a report that
  // reprints them every run is one nobody reads.
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow({ skip_reason: "no_snap" })]));
  await importTrailheadFacts(testArgs(), { db, console: silent, ...io });
  assert.deepEqual(roadReport(io), []);
});

test("a window one year either side of the run still lands", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        seasonal_window: {
          value: { opens: "2026-12-20", closes: "2027-03-15" },
          source: MVUM_SOURCE,
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), { db, console: silent, ...io });
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.deepEqual(merged.road_access.seasonal_window.value, {
    opens: "2026-12-20",
    closes: "2027-03-15",
  });
});

test("a leaf from a source kind this pipeline does not own is refused", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    roadOnlyFiles([
      roadRow({
        surface: {
          value: "gravel",
          source: { kind: "someone_elses_map", name: "Someone else's map" },
          retrieved_at: "2026-08-19",
        },
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });
  assert.equal(summary.counts.usfs_roads.refusals.surface_unusable, 1);
});

test("a destination the catalog no longer holds is reported, not written", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow({ destination_id: "dest-gone" })]));
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.destinationVanished, 1);
  assert.equal(summary.counts.usfs_roads.refusals.destination_missing, 1);
  assert.equal(summary.counts.usfs_roads.matched, 0);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);

  const reported = roadReport(io);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].reason, "destination_missing");
  assert.equal(reported[0].destination_id, "dest-gone");
});

test("a destination that is no longer a trailhead gets no road facts", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ ...SNOW_DEST, isTrailhead: false }],
  });
  const io = createIo(roadOnlyFiles([roadRow()]));
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.usfs_roads.destinationVanished, 1);
  assert.equal(summary.counts.usfs_roads.refusals.destination_not_trailhead, 1);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(roadReport(io)[0].reason, "destination_not_trailhead");
});

test("a second road import over the same file rewrites nothing", async () => {
  const files = roadOnlyFiles([roadRow()]);
  const first = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(files);
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db: first.db,
    console: silent,
    ...io,
  });
  const stored = JSON.parse(
    first.calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );

  const second = createFakeDb({ destinations: [{ ...SNOW_DEST, amenities: stored }] });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db: second.db,
    console: silent,
    ...io,
  });
  assert.equal(summary.destinationsChanged, 0);
  assert.equal(summary.destinationsUnchanged, 1);
  assert.equal(second.calls.some((call) => call.sql.includes("UPDATE destinations")), false);
});

test("a refreshed road fact overwrites the one this importer wrote before", async () => {
  const files = roadOnlyFiles([roadRow({ surface: {
    value: "dirt",
    source: ROADCORE_SOURCE,
    retrieved_at: "2026-11-01",
  } })]);
  const before = {
    road_access: {
      surface: { value: "gravel", source: ROADCORE_SOURCE, retrieved_at: "2026-08-19" },
    },
  };
  const { db, calls } = createFakeDb({
    destinations: [{ ...SNOW_DEST, amenities: before }],
  });
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(files),
  });
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.surface.value, "dirt");
  assert.equal(merged.road_access.surface.retrieved_at, "2026-11-01");
});

test("a road leaf a human wrote is left alone", async () => {
  const before = {
    road_access: {
      surface: {
        value: "washed out",
        source: { kind: "ranger_district_call", name: "Ranger district" },
        retrieved_at: "2026-08-01",
      },
    },
  };
  const { db, calls } = createFakeDb({
    destinations: [{ ...SNOW_DEST, amenities: before }],
  });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(roadOnlyFiles([roadRow()])),
  });
  assert.equal(summary.preservedForeignLeaves, 1);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.road_access.surface.value, "washed out");
  assert.equal(merged.road_access.high_clearance.value, "required");
});

test("a dry run writes no road fact and logs the run as a dry run", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(roadOnlyFiles([roadRow()]));
  const summary = await importTrailheadFacts(testArgs(), { db, console: silent, ...io });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.destinationsChanged, 1);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  const roadRun = calls
    .filter((call) => call.sql.includes("INSERT INTO data_source_runs"))
    .find((call) => call.params?.[0] === "usfs_roads");
  assert.equal(roadRun?.params?.[2], "dry_run");
  assert.equal(roadRun?.params?.[1], "import");
});

test("--no-log leaves no road run row either", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  await importTrailheadFacts(testArgs({ log: false }), {
    db,
    console: silent,
    ...createIo(roadOnlyFiles([roadRow()])),
  });
  assert.equal(calls.some((call) => call.sql.includes("data_source_runs")), false);
});

test("the road run row records what it refused", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(
      roadOnlyFiles([roadRow({ skip_reason: "no_snap" }), roadRow({ destination_id: "dest-gone" })])
    ),
  });
  const roadRun = calls
    .filter((call) => call.sql.includes("INSERT INTO data_source_runs"))
    .find((call) => call.params?.[0] === "usfs_roads");
  assert.match(String(roadRun?.params?.[8]), /vanished=1/);
  assert.match(String(roadRun?.params?.[8]), /skipped_no_snap=1/);
});

test("a missing road-access file stops the import rather than importing three quarters", async () => {
  const files = defaultFiles();
  delete files[path.join(DATA_DIR, "trailhead-road-access.jsonl")];
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  await assert.rejects(
    () => importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) }),
    /trailhead-road-access\.jsonl/
  );
});

// --- National Park Service facts --------------------------------------------

function npsReport(io: ReturnType<typeof createIo>, file: string): Array<Record<string, unknown>> {
  return io.written[path.join(DATA_DIR, file)]
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("an NPS row lands on its own destination id, with no name gate at all", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(npsOnlyFiles([npsRow({ bathrooms: npsBathroomBlock() })]));
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });

  assert.equal(summary.counts.nps_pois.matched, 1);
  assert.equal(summary.counts.nps_pois.matchedByRule.exact_id, 1);
  assert.equal(summary.counts.nps_parking.matched, 1);
  assert.equal(summary.counts.nps_parking.matchedByRule.exact_id, 1);
  assert.equal(summary.destinationsChanged, 1);
  // The name gate is not consulted: the normalizer started from this row.
  assert.equal(calls.some((call) => call.sql.includes("JOIN LATERAL")), false);

  const update = calls.find((call) => call.sql.includes("UPDATE destinations"));
  assert.equal(update?.params?.[0], "dest-snow");
  const merged = JSON.parse(update?.params?.[1] as string);
  assert.equal(merged.bathrooms.status.value, "present");
  assert.equal(merged.bathrooms.type.value, "unspecified");
  assert.equal(merged.parking.type.value, "lot");
  assert.equal(merged.parking.location_note.value, "SNOW LAKE PARKING (UPPER LOT)");
  assert.equal(merged.parking.type.source.kind, "nps_parking");
  assert.equal(merged.parking.type.source.name, "National Park Service");
  assert.equal(merged.parking.type.source.license, "public domain (US federal government)");
  assert.equal(merged.parking.type.retrieved_at, "2026-08-19");
});

test("the join evidence stays in the file — no diagnostics reach amenities", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(npsOnlyFiles([npsRow({ bathrooms: npsBathroomBlock() })])),
  });
  const written = calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string;
  const merged = JSON.parse(written);
  assert.equal("diagnostics" in merged, false);
  // The distance a match rested on is evidence for a person, not a fact about
  // a trailhead — and neither is the lot id or the POI type.
  assert.equal(/distance_m|inside_lot|candidates_within_gate|lot_name_field/.test(written), false);
});

test("a bathroom status other than present is refused, block and all", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const io = createIo(
    npsOnlyFiles([
      npsRow({
        parking: undefined,
        bathrooms: npsBathroomBlock({ status: npsLeaf("absent", NPS_POIS_SOURCE) }),
      }),
    ])
  );
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });
  assert.equal(summary.counts.nps_pois.refusals.bathroom_status_not_present, 1);
  assert.equal(summary.counts.nps_pois.matched, 0);
  assert.equal(summary.counts.nps_pois.noFacts, 1);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(npsReport(io, "import-rejected-nps-pois.jsonl")[0].reason, "bathroom_status_not_present");
});

test("a bathroom type with no status is refused — a type alone claims presence", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs(), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([
        npsRow({ parking: undefined, bathrooms: { type: npsLeaf("flush", NPS_POIS_SOURCE) } }),
      ])
    ),
  });
  assert.equal(summary.counts.nps_pois.refusals.bathroom_status_missing, 1);
  assert.equal(summary.counts.nps_pois.matched, 0);
});

test("a parking capacity on an NPS leaf is refused by name", async () => {
  // NPS publishes no capacity field. A number here could only come from the
  // uncalibrated 30 m²-a-space area proxy, and it would read like a count.
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([
        npsRow({
          parking: {
            type: npsLeaf("lot", NPS_PARKING_SOURCE),
            capacity_vehicles: npsLeaf(29, NPS_PARKING_SOURCE),
          },
        }),
      ])
    ),
  });
  assert.equal(summary.counts.nps_parking.refusals.unexpected_parking_leaf_capacity_vehicles, 1);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  // The refusal drops one leaf, not the row: the lot still publishes.
  assert.equal(merged.parking.type.value, "lot");
  assert.equal("capacity_vehicles" in merged.parking, false);
});

test("a parking type outside the vocabulary is refused", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs(), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([npsRow({ parking: { type: npsLeaf("carpark", NPS_PARKING_SOURCE) } })])
    ),
  });
  assert.equal(summary.counts.nps_parking.refusals.parking_type_unusable, 1);
  assert.equal(summary.counts.nps_parking.matched, 0);
});

test("a leaf carrying the other service's source kind is refused", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs(), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([
        npsRow({
          parking: undefined,
          bathrooms: npsBathroomBlock({ status: npsLeaf("present", NPS_PARKING_SOURCE) }),
        }),
      ])
    ),
  });
  assert.equal(summary.counts.nps_pois.refusals.bathroom_status_source_unusable, 1);
});

test("an NPS leaf never overwrites an explicit Forest Service claim on the row", async () => {
  const before = {
    bathrooms: {
      type: {
        value: "vault_pit",
        source: { kind: "usfs_edw", name: "US Forest Service" },
        retrieved_at: "2026-08-19",
      },
    },
  };
  const { db, calls } = createFakeDb({
    destinations: [{ ...SNOW_DEST, amenities: before }],
  });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(npsOnlyFiles([npsRow({ bathrooms: npsBathroomBlock() })])),
  });
  assert.equal(summary.deferredToExplicitLeaves, 1);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  // The agency named the site; the spatial join only stood near it.
  assert.equal(merged.bathrooms.type.value, "vault_pit");
  assert.equal(merged.bathrooms.type.source.kind, "usfs_edw");
  // The leaf the Forest Service never wrote is still the NPS one's to fill.
  assert.equal(merged.bathrooms.status.source.kind, "nps_pois");
});

test("in one run the Forest Service row beats the NPS join on the same leaf", async () => {
  // Both sources land on dest-snow: the EDW bathroom row says vault_pit, the
  // NPS join says unspecified. The agency's own claim wins.
  const files = defaultFiles({
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: jsonl([
      npsRow({ bathrooms: npsBathroomBlock() }),
    ]),
  });
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(files),
  });
  assert.equal(summary.leafConflicts > 0, true);
  const merged = JSON.parse(
    calls.find((call) => call.sql.includes("UPDATE destinations"))?.params?.[1] as string
  );
  assert.equal(merged.bathrooms.type.value, "vault_pit");
  assert.equal(merged.bathrooms.type.source.kind, "usfs_edw");
});

test("an NPS row for a destination that is no longer a trailhead is reported, not written", async () => {
  const { db, calls } = createFakeDb({
    destinations: [{ ...SNOW_DEST, isTrailhead: false }],
  });
  const io = createIo(npsOnlyFiles([npsRow({ bathrooms: npsBathroomBlock() })]));
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...io,
  });
  assert.equal(summary.counts.nps_pois.destinationVanished, 1);
  assert.equal(summary.counts.nps_parking.destinationVanished, 1);
  assert.equal(summary.counts.nps_pois.matched, 0);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(
    npsReport(io, "import-rejected-nps-parking.jsonl")[0].reason,
    "destination_not_trailhead"
  );
});

test("a row carrying only one block is counted under only that source", async () => {
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs(), {
    db,
    console: silent,
    ...createIo(npsOnlyFiles([npsRow()])),
  });
  assert.equal(summary.counts.nps_parking.rowsIn, 1);
  assert.equal(summary.counts.nps_parking.matched, 1);
  assert.equal(summary.counts.nps_pois.rowsIn, 0);
  assert.equal(summary.counts.nps_pois.matched, 0);
});

test("the NPS run rows record what they refused, one per service", async () => {
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([
        npsRow({
          bathrooms: npsBathroomBlock({ status: npsLeaf("absent", NPS_POIS_SOURCE) }),
          parking: { type: npsLeaf("lot", NPS_PARKING_SOURCE) },
        }),
      ])
    ),
  });
  const runs = calls.filter((call) => call.sql.includes("INSERT INTO data_source_runs"));
  const pois = runs.find((call) => call.params?.[0] === "nps_pois");
  const parking = runs.find((call) => call.params?.[0] === "nps_parking");
  assert.match(String(pois?.params?.[8]), /bathroom_status_not_present=1/);
  assert.equal(parking?.params?.[7], 1);
});

test("a missing NPS facts file stops the import rather than importing most of itself", async () => {
  const files = defaultFiles();
  delete files[path.join(DATA_DIR, "nps-trailhead-facts.jsonl")];
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  await assert.rejects(
    () => importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) }),
    /nps-trailhead-facts\.jsonl/
  );
});

test("--nps-facts points the import at another file", async () => {
  const files = defaultFiles({
    "/tmp/elsewhere/nps.jsonl": jsonl([npsRow({ destination_id: "dest-snow" })]),
    [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: "",
  });
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(
    testArgs({ npsFactsPath: "/tmp/elsewhere/nps.jsonl" }),
    { db, console: silent, ...createIo(files) }
  );
  assert.equal(summary.counts.nps_parking.matched, 1);
});

test("a bathroom status whose envelope fails takes the whole block with it", async () => {
  // The orphan this guards against: a type surviving on its own tells a reader
  // a restroom is there without the leaf that says so.
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  const summary = await importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
    db,
    console: silent,
    ...createIo(
      npsOnlyFiles([
        npsRow({
          parking: undefined,
          bathrooms: {
            status: { value: "present", source: NPS_POIS_SOURCE, retrieved_at: "August 2026" },
            type: npsLeaf("vault_pit", NPS_POIS_SOURCE),
            season_note: npsLeaf("Seasonal", NPS_POIS_SOURCE),
          },
        }),
      ])
    ),
  });
  assert.equal(summary.counts.nps_pois.refusals.bathroom_status_source_unusable, 1);
  assert.equal(summary.counts.nps_pois.matched, 0);
  assert.equal(summary.counts.nps_pois.noFacts, 1);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
});

test("a present but empty NPS file fails loudly rather than importing as silence", async () => {
  // Zero rows means the normalizer did not run, or ran against nothing, or was
  // truncated. Every one of those is a refresh that did not happen.
  const files = defaultFiles({ [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: "" });
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  await assert.rejects(
    () => importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) }),
    /nps-trailhead-facts\.jsonl yielded no usable rows/
  );
});

test("a present but empty road-access file fails loudly too", async () => {
  const files = defaultFiles({ [path.join(DATA_DIR, "trailhead-road-access.jsonl")]: "\n  \n" });
  const { db } = createFakeDb({ destinations: [SNOW_DEST] });
  await assert.rejects(
    () => importTrailheadFacts(testArgs(), { db, console: silent, ...createIo(files) }),
    /trailhead-road-access\.jsonl yielded no usable rows/
  );
});

test("an empty derived file stops the run before the database is touched", async () => {
  const files = defaultFiles({ [path.join(DATA_DIR, "nps-trailhead-facts.jsonl")]: "" });
  const { db, calls } = createFakeDb({ destinations: [SNOW_DEST] });
  await assert.rejects(() =>
    importTrailheadFacts(testArgs({ apply: true, dryRun: false }), {
      db,
      console: silent,
      ...createIo(files),
    })
  );
  assert.equal(calls.some((call) => call.sql.includes("UPDATE destinations")), false);
  assert.equal(calls.some((call) => call.sql === "BEGIN"), false);
});
