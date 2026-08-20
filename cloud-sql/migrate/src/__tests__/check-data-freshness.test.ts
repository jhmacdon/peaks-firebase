import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  checkDataFreshness,
  evaluateFreshness,
  formatReport,
  parseArgs,
  REQUIRED_SOURCES,
  STALE_AFTER_DAYS,
  usage,
  type FreshnessRow,
  type QueryExecutor,
} from "../check-data-freshness";

function fresh(source: string, daysStale: number): FreshnessRow {
  return {
    source,
    last_successful_at: new Date(Date.now() - daysStale * 86400000).toISOString(),
    days_stale: daysStale,
    is_stale: daysStale > STALE_AFTER_DAYS,
  };
}

function createDb(options: { viewReady?: boolean; rows?: FreshnessRow[] }): {
  db: QueryExecutor;
  seen: string[];
} {
  const seen: string[] = [];
  const db: QueryExecutor = {
    query: (async (sql: string) => {
      seen.push(sql);
      if (sql.includes("to_regclass")) {
        return { rows: [{ view_ready: options.viewReady !== false }], rowCount: 1 };
      }
      const rows = options.rows ?? [];
      return { rows, rowCount: rows.length };
    }) as never,
  };
  return { db, seen };
}

test("every trailhead source that carries real coverage is required", () => {
  // usfs_pages spent one release outside this list, when a page could only be
  // located by borrowing a same-named EDW point and the whole source
  // contributed a single leaf. Pages now carry their own coordinates and
  // publish the two parking facts no agency dataset holds, so the source is
  // required again — and it goes stale the way a web page does, silently.
  assert.deepEqual(
    [...REQUIRED_SOURCES],
    ["usfs_fees", "usfs_bathrooms", "usfs_pages", "usfs_roads", "nps_pois", "nps_parking"]
  );
  assert.equal(STALE_AFTER_DAYS, 90);
});

test("a stale usfs_pages now fails the check", () => {
  const report = evaluateFreshness([
    ...REQUIRED_SOURCES.filter((source) => source !== "usfs_pages").map((source) => fresh(source, 1)),
    fresh("usfs_pages", 400),
  ]);
  assert.equal(report.ok, false);
  const pages = report.assessments.find((a) => a.source === "usfs_pages");
  assert.equal(pages?.required, true);
  assert.equal(pages?.state, "stale");
  assert.deepEqual(report.failures.map((failure) => failure.source), ["usfs_pages"]);
});

test("every required source current means ok", () => {
  const report = evaluateFreshness(REQUIRED_SOURCES.map((source) => fresh(source, 3)));
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(
    report.assessments.map((a) => a.state),
    REQUIRED_SOURCES.map(() => "ok")
  );
});

test("a source past the window is stale", () => {
  const report = evaluateFreshness([
    fresh("usfs_fees", 91),
    fresh("usfs_bathrooms", 90),
    fresh("usfs_pages", 1),
    fresh("usfs_roads", 1),
    fresh("nps_pois", 1),
    fresh("nps_parking", 1),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => f.source),
    ["usfs_fees"]
  );
  assert.equal(report.assessments[1].state, "ok", "exactly 90 days is still inside the window");
});

test("a source with no run at all fails", () => {
  const report = evaluateFreshness([fresh("usfs_fees", 1)]);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => [f.source, f.state]),
    [
      ["usfs_bathrooms", "never_run"],
      ["usfs_pages", "never_run"],
      ["usfs_roads", "never_run"],
      ["nps_pois", "never_run"],
      ["nps_parking", "never_run"],
    ]
  );
});

test("a roads import that has never run fails the check", () => {
  // The one that would otherwise pass unnoticed: the fee and bathroom files
  // refresh on their own cadence, and a data directory with no rebuilt road
  // store still imports three quarters of itself.
  const report = evaluateFreshness([
    fresh("usfs_fees", 1),
    fresh("usfs_bathrooms", 1),
    fresh("usfs_pages", 1),
    fresh("nps_pois", 1),
    fresh("nps_parking", 1),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => [f.source, f.state]),
    [["usfs_roads", "never_run"]]
  );
});

test("an NPS normalize that has never been imported fails the check", () => {
  // The same trap one source along: the Forest Service half of a refresh can
  // succeed while the NPS join is never re-run, and the catalog would go on
  // showing a restroom nobody re-checked.
  const report = evaluateFreshness([
    fresh("usfs_fees", 1),
    fresh("usfs_bathrooms", 1),
    fresh("usfs_pages", 1),
    fresh("usfs_roads", 1),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => [f.source, f.state]),
    [["nps_pois", "never_run"], ["nps_parking", "never_run"]]
  );
});

test("a source that has run but never succeeded fails", () => {
  const rows: FreshnessRow[] = [
    fresh("usfs_fees", 1),
    fresh("usfs_pages", 1),
    fresh("usfs_roads", 1),
    fresh("nps_pois", 1),
    fresh("nps_parking", 1),
    { source: "usfs_bathrooms", last_successful_at: null, days_stale: null, is_stale: true },
  ];
  const report = evaluateFreshness(rows);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => [f.source, f.state]),
    [["usfs_bathrooms", "never_succeeded"]]
  );
});

test("other sources in the view are shown but never fail the check", () => {
  const rows = [...REQUIRED_SOURCES.map((source) => fresh(source, 1)), fresh("padus", 400)];
  const report = evaluateFreshness(rows);
  assert.equal(report.ok, true);
  const padus = report.assessments.find((a) => a.source === "padus");
  assert.equal(padus?.required, false);
  assert.equal(padus?.state, "stale");
});

test("a custom window changes the verdict", () => {
  const rows = REQUIRED_SOURCES.map((source) => fresh(source, 40));
  assert.equal(evaluateFreshness(rows, REQUIRED_SOURCES, 90).ok, true);
  assert.equal(evaluateFreshness(rows, REQUIRED_SOURCES, 30).ok, false);
});

test("the printed report names each state plainly", () => {
  const report = evaluateFreshness([
    fresh("usfs_fees", 200),
    fresh("usfs_roads", 1),
    fresh("usfs_pages", 1),
    fresh("padus", 1),
  ]);
  const lines = formatReport(report, STALE_AFTER_DAYS).join("\n");
  assert.match(lines, /usfs_fees \[required\]: last success .* \(200 days ago\) — STALE/);
  assert.match(lines, /usfs_bathrooms \[required\]: no run recorded — NEVER RUN/);
  assert.match(lines, /usfs_roads \[required\]: last success .* — ok/);
  assert.match(lines, /usfs_pages \[required\]: last success .* — ok/);
  assert.match(lines, /padus \[other\]: last success .* — ok/);
  assert.match(lines, /Stale or missing required sources: usfs_fees, usfs_bathrooms/);
});

test("the check reads the view and returns a failing report", async () => {
  const { db, seen } = createDb({ rows: [fresh("usfs_fees", 200)] });
  const report = await checkDataFreshness({ staleDays: 90, json: false, help: false }, {
    db,
    console: { log: () => undefined, warn: () => undefined },
  });
  assert.equal(report.ok, false);
  assert.ok(seen.some((sql) => sql.includes("FROM data_source_freshness")));
});

test("a missing view is a clear error, not a silent pass", async () => {
  const { db } = createDb({ viewReady: false });
  await assert.rejects(
    () =>
      checkDataFreshness({ staleDays: 90, json: false, help: false }, {
        db,
        console: { log: () => undefined, warn: () => undefined },
      }),
    /20260819_data_source_runs\.sql/
  );
});

test("arguments parse and validate", () => {
  assert.equal(parseArgs([]).staleDays, STALE_AFTER_DAYS);
  assert.equal(parseArgs(["--stale-days=30"]).staleDays, 30);
  assert.equal(parseArgs(["--json"]).json, true);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--stale-days=0"]), /--stale-days/);
  assert.match(
    usage(),
    /Required sources: usfs_fees, usfs_bathrooms, usfs_pages, usfs_roads, nps_pois, nps_parking/
  );
});
