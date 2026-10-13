import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  buildAuditReport,
  CATALOG_SQL,
  type CatalogRouteRow,
  GOLDEN_QUERIES,
  loadCatalog,
  parseArgs,
  rejectionReasons,
  routeRegion,
  writeReports,
} from "../audit-trail-catalog";

function route(overrides: Partial<CatalogRouteRow> = {}): CatalogRouteRow {
  return {
    id: "mount-si-route",
    name: "Mount Si Trail",
    status: "active",
    shape: "out_and_back",
    distance: 6400,
    gain: 970,
    gain_loss: 15,
    source_kind: "openstreetmap",
    destination_count: 2,
    destination_ordinals_valid: true,
    missing_destination_ids: [],
    trailhead_id: "mount-si-trailhead",
    trailhead_name: "Mount Si Trailhead",
    trailhead_country_code: "US",
    trailhead_state_code: "WA",
    objective_id: "mount-si",
    objective_name: "Mount Si",
    objective_country_code: "US",
    objective_state_code: "WA",
    segment_count: 2,
    segment_ordinals_valid: true,
    missing_segment_ids: [],
    ...overrides,
  };
}

test("valid metadata passes without claiming path or publication checks passed", () => {
  const report = buildAuditReport([route()], "2026-10-13T01:00:00Z");
  assert.equal(report.summary.catalog_routes, 1);
  assert.equal(report.summary.metadata_ready_routes, 1);
  assert.equal(report.summary.rejected_routes, 0);
  assert.equal(report.summary.deep_integrity_checked, false);
  assert.equal(report.summary.metrics_backfill_verified, false);
  assert.deepEqual(report.rejections, []);
});

test("every route with bad metadata keeps every rejection reason", () => {
  const broken = route({
    id: "broken-route", name: "  ", trailhead_id: null, objective_id: null,
    destination_count: 0, destination_ordinals_valid: false,
    missing_destination_ids: ["deleted-destination"],
    segment_count: 0, segment_ordinals_valid: false,
    missing_segment_ids: ["deleted-segment"],
    distance: 0, gain: -1, gain_loss: Number.NaN,
    objective_country_code: null, objective_state_code: null,
    trailhead_country_code: null, trailhead_state_code: null,
  });
  assert.deepEqual(rejectionReasons(broken), [
    "missing_route_name", "missing_first_trailhead", "missing_summit_objective",
    "invalid_destination_ordinals", "missing_destination_references",
    "invalid_distance", "invalid_gain", "invalid_gain_loss", "missing_country_code",
    "missing_state_code", "missing_segments", "invalid_segment_ordinals", "missing_segment_references",
  ]);
  const report = buildAuditReport([route(), broken]);
  assert.equal(report.summary.catalog_routes, 2);
  assert.equal(report.summary.rejected_routes, 1);
  assert.equal(report.rejections[0].stored_gain_loss_m, "NaN");
  assert.deepEqual(report.rejections[0].missing_segment_ids, ["deleted-segment"]);
});

test("NaN, infinity, missing values and negative stats cannot pass", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, -1]) {
    assert.ok(rejectionReasons(route({ distance: value })).includes("invalid_distance"));
    assert.ok(rejectionReasons(route({ gain: value })).includes("invalid_gain"));
    assert.ok(rejectionReasons(route({ gain_loss: value })).includes("invalid_gain_loss"));
  }
  assert.deepEqual(rejectionReasons(route({ gain: 0, gain_loss: 0 })), []);
  assert.deepEqual(rejectionReasons(route({ shape: null })), ["missing_route_shape"]);
});

test("region fallback fills only absent values and never hides an invalid objective region", () => {
  assert.deepEqual(routeRegion(route({ objective_state_code: "  ", objective_country_code: null })), {
    country_code: "US", state_code: "WA",
  });
  assert.deepEqual(routeRegion(route({ objective_country_code: "CA", objective_state_code: "BC" })), {
    country_code: "CA", state_code: "BC",
  });
  assert.deepEqual(rejectionReasons(route({ objective_country_code: "USA", objective_state_code: "Washington" })), [
    "invalid_country_code", "invalid_state_code",
  ]);
  assert.deepEqual(rejectionReasons(route({ objective_state_code: null, trailhead_state_code: null })), [
    "missing_state_code",
  ]);
});

test("summary reconciles every catalog route, including pending and superseded rows", () => {
  const rows = [
    route(),
    route({ id: "pending", status: "pending", source_kind: "usfs-nfs-trails", gain: null }),
    route({ id: "retired", status: "superseded", source_kind: null, gain: null }),
  ];
  const { summary } = buildAuditReport(rows);
  assert.equal(summary.metadata_ready_routes + summary.rejected_routes, summary.catalog_routes);
  assert.deepEqual(summary.by_status, { active: 1, pending: 1, superseded: 1 });
  assert.deepEqual(summary.by_source_kind, { openstreetmap: 1, "usfs-nfs-trails": 1, missing: 1 });
  assert.equal(summary.rejected_by_reason.invalid_gain, 2);
  assert.deepEqual(summary.rejected_by_status, { pending: 1, superseded: 1 });
});

test("golden report lists only observed WA candidates and leaves search rank unknown", () => {
  const report = buildAuditReport([
    route(),
    route({ id: "not-si", name: "Mount Silver", objective_name: "Mount Silver", trailhead_name: "Silver trailhead" }),
    route({ id: "other-state", objective_state_code: "OR", trailhead_state_code: "OR" }),
    route({ id: "old-mailbox", name: "Mailbox Peak Old Trail", objective_name: "Mailbox Peak", trailhead_name: "Mailbox" }),
    route({ id: "new-mailbox", name: "Mailbox Peak New Trail", objective_name: "Mailbox Peak", trailhead_name: "Mailbox" }),
  ]);
  assert.equal(report.golden_discovery.length, GOLDEN_QUERIES.length);
  const si = report.golden_discovery.find((item) => item.query === "Mount Si Trail")!;
  assert.deepEqual(si.matches.map((item) => item.route_id), ["mount-si-route"]);
  assert.equal(si.matches[0].stored_distance_m, 6400);
  assert.equal(si.search_rank, null);
  assert.equal(si.result, "observed_candidates");
  const mailbox = report.golden_discovery.find((item) => item.query.startsWith("Mailbox"))!;
  assert.deepEqual(mailbox.matches.map((item) => item.route_id), ["old-mailbox", "new-mailbox"]);
  const ingalls = report.golden_discovery.find((item) => item.query === "Ingalls Peak")!;
  assert.equal(ingalls.result, "no_catalog_name_match");
  assert.deepEqual(ingalls.matches, []);
});

test("empty catalog fails loudly rather than returning a complete report", () => {
  assert.throws(() => buildAuditReport([]), /Empty Peaks catalog/);
});

test("CLI rejects apply, unbounded timeouts and conflicting output files", () => {
  assert.throws(() => parseArgs(["--apply"]), /no --apply mode/);
  for (const value of ["0", "-1", "300001", "1.5", "Infinity", "60000;SELECT 1"]) {
    assert.throws(() => parseArgs([`--timeout-ms=${value}`]), /timeout-ms/);
  }
  assert.throws(() => parseArgs(["--report"]), /requires a value/);
  assert.throws(() => parseArgs(["--report=/tmp/a", "--rejections=/tmp/a"]), /must differ/);
  assert.deepEqual(parseArgs(["--report", "/tmp/catalog.json", "--timeout-ms=30000"]), {
    reportPath: "/tmp/catalog.json", rejectionsPath: "/tmp/catalog.rejected.jsonl", timeoutMs: 30_000,
  });
});

test("database audit is bounded and reads in one repeatable read-only transaction", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: sql === CATALOG_SQL ? [route()] : [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  const rows = await loadCatalog(client, 45_000);
  assert.equal(rows.length, 1);
  assert.deepEqual(queries, [
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SET LOCAL statement_timeout = '45000ms'",
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    CATALOG_SQL,
    "COMMIT",
  ]);
  assert.doesNotMatch(queries.join("\n"), /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});

test("failed reads roll back and preserve the error", async () => {
  const queries: string[] = [];
  const failure = new Error("statement timeout");
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql === CATALOG_SQL) throw failure;
      return { rows: [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  await assert.rejects(loadCatalog(client, 1000), failure);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.includes("COMMIT"));
});

test("preflight query reads baseline scalar columns and preserves broken joins", () => {
  assert.doesNotMatch(CATALOG_SQL, /\b(path|polyline6|elevation_string|kind|slug|aliases|trail_names)\b/i);
  assert.doesNotMatch(CATALOG_SQL, /\bST_\w+|peaks_route_passes_publish_integrity/);
  assert.match(CATALOG_SQL, /LEFT JOIN segments s/);
  assert.match(CATALOG_SQL, /LEFT JOIN destinations d/);
  assert.match(CATALOG_SQL, /rd\.ordinal = 0/);
  assert.match(CATALOG_SQL, /'summit'::destination_feature = ANY\(rd\.features\)/);
  assert.match(CATALOG_SQL, /ORDER BY rd\.route_id, rd\.ordinal DESC/);
  assert.match(CATALOG_SQL, /destination_rows AS MATERIALIZED/);
  assert.match(CATALOG_SQL, /SELECT DISTINCT ON \(rd\.route_id\)/);
  assert.doesNotMatch(CATALOG_SQL, /LATERAL/);
});

test("JSONL contains each rejected route once and compact report keeps all golden queries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "peaks-trail-audit-test-"));
  try {
    const args = parseArgs([`--report=${path.join(directory, "report.json")}`]);
    const report = buildAuditReport([
      route(), route({ id: "missing-name", name: null }), route({ id: "missing-segment", missing_segment_ids: ["absent"] }),
    ]);
    const summary = await writeReports(args, report);
    const rejections = (await readFile(args.rejectionsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rejections.map((item) => item.route_id), ["missing-name", "missing-segment"]);
    const saved = JSON.parse(await readFile(args.reportPath, "utf8"));
    assert.deepEqual(saved.summary, summary);
    assert.equal(saved.summary.rejected_routes, rejections.length);
    assert.equal(saved.golden_discovery.length, GOLDEN_QUERIES.length);
    assert.equal(saved.rejections, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
