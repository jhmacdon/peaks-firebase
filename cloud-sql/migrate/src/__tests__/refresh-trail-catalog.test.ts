import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANDIDATE_SQL, NAMES_CANDIDATE_SQL, parseRefreshOptions, readReviewedReport, rejectionLines,
  runRefresh, saveRefreshEvidence, sha256, type Queryable, type RefreshOptions } from "../refresh-trail-catalog";

const { routeDoneCoverageSql } = require("../../../api/src/route-coverage") as {
  routeDoneCoverageSql(alias: string): string;
};
const options = (more: Partial<RefreshOptions> = {}): RefreshOptions => ({ mode: "metadata", apply: false,
  report: "/tmp/trail-refresh-report.json", rejections: "/tmp/trail-refresh-rejected.jsonl",
  batchSize: 50, routeIds: [], ...more });
const candidate = (id: string) => ({ route_id: id, kind: "summit", objective_destination_id: "peak",
  trailhead_destination_id: "start", state_code: "WA", country_code: "US", difficulty: "moderate",
  est_moving_seconds: 7200, errors: [], name: "Example Peak", status: "pending",
  source_fingerprint: `source-${id}`, popularity: 17 });

class FakeDb implements Queryable {
  calls: Array<{ text: string; values: unknown[] }> = [];
  candidates: Record<string, ReturnType<typeof candidate>> = {};
  jobs: Record<string, Record<string, unknown>> = {};
  updates = 0;
  leaseBusy = false;
  driftOnLockedRead = false;
  inTransaction = false;
  failRunFinish = false;
  failClaimFor?: string;
  naming = false;
  constructor(ids = ["a"]) { for (const id of ids) this.candidates[id] = candidate(id); }
  async query(text: string, values: unknown[] = []): Promise<{ rows: any[] }> {
    this.calls.push({ text, values });
    const id = String(values[0]);
    if (text.includes("refresh:run-start")) return { rows: [{ id: "1" }] };
    if (text.includes("refresh:target")) return { rows: [{ database: "trail_test", server_address: "127.0.0.1", server_port: 5432 }] };
    if (text.includes("refresh:list")) return { rows: Object.keys(this.candidates).sort().filter(key => key > String(values[0]))
      .slice(0, Number(values[1])).map(key => ({ id: key })) };
    if (text.includes("refresh:candidate")) {
      const candidateRow = this.candidates[id];
      const row = candidateRow && text.includes("refresh:candidate-names")
        ? { route_id: id, search_name: "example peak", slug: `example-peak-${id}`, errors: [],
            name: candidateRow.name, status: candidateRow.status, source_fingerprint: candidateRow.source_fingerprint }
        : candidateRow;
      return { rows: row ? [{ ...row, ...(this.inTransaction && this.driftOnLockedRead ? { source_fingerprint: "changed" } : {}) }] : [] };
    }
    if (text.includes("refresh:receipt")) return { rows: this.jobs[id] ? [this.jobs[id]] : [] };
    if (text.includes("refresh:claim")) {
      if (id === this.failClaimFor) throw new Error("Claim database unavailable");
      if (this.leaseBusy) return { rows: [] };
      this.jobs[id] = { state: "working", review_sha256: values[1], review_fingerprint: values[2], token: values[4] };
      return { rows: [{ route_id: id }] };
    }
    if (text.includes("refresh:lease")) return { rows: [{ route_id: id }] };
    if (text.startsWith("SELECT refresh_peaks_route_catalog_metadata") || text.startsWith("SELECT refresh_route_catalog_names")) {
      this.updates++;
      this.naming = text.startsWith("SELECT refresh_route_catalog_names");
      this.candidates[id].source_fingerprint += "-updated";
      return { rows: [] };
    }
    if (text.includes("refresh:verify")) return { rows: [this.naming
      ? { search_name: "example peak", slug: `example-peak-${id}` } : this.candidates[id]] };
    if (text.includes("refresh:complete")) {
      this.jobs[id] = { ...this.jobs[id], state: "complete", applied_fingerprint: values[2] };
      return { rows: [{ route_id: id }] };
    }
    if (text.includes("refresh:blocked")) {
      this.jobs[id] = { ...this.jobs[id], state: "blocked", last_error: values[2] };
      return { rows: [] };
    }
    if (text.startsWith("BEGIN")) { this.inTransaction = true; return { rows: [] }; }
    if (text === "COMMIT" || text === "ROLLBACK") { this.inTransaction = false; return { rows: [] }; }
    if (text.includes("refresh:run-finish") && this.failRunFinish) throw new Error("receipt connection lost");
    if (text.includes("refresh:run-finish") || text.startsWith("SET ") || /FOR (UPDATE|SHARE)/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

test("refresh CLI defaults to dry run and enforces bounded reviewed apply", () => {
  assert.equal(parseRefreshOptions(["--report=/tmp/test.json"]).apply, false);
  assert.equal(parseRefreshOptions(["--report=/tmp/test.json"]).mode, "metadata");
  assert.equal(parseRefreshOptions(["--report=x", "--mode=names"]).mode, "names");
  assert.throws(() => parseRefreshOptions(["--report=x", "--mode=all"]), /metadata or names/);
  assert.equal(parseRefreshOptions(["--report=/tmp/test.json"]).batchSize, 50);
  assert.throws(() => parseRefreshOptions(["--report=x", "--batch-size=501"]), /1–500/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--batch-size=1.5"]), /integer/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--apply"]), /Apply requires/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--apply=false"]), /takes no value/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--route-id=a", "--route-id=a"]), /Duplicate/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--no-log"]), /Unknown option/);
  assert.throws(() => parseRefreshOptions(["--report=x", "--apply", "--review-report=x", "--expected-report-sha256=" + "a".repeat(64)]), /unchanged/);
});

test("popularity uses the canonical completion predicate, objective offsets, and published reports", () => {
  assert.ok(CANDIDATE_SQL.includes(routeDoneCoverageSql("sr")));
  assert.match(CANDIDATE_SQL, /session_count_offset/);
  assert.match(CANDIDATE_SQL, /moderation_state='published'/);
});

test("dry run logs every attempt, reports all rejections, and never seeds leases or writes routes", async () => {
  const db = new FakeDb(["a", "b"]);
  db.candidates.b.errors = ["segments_missing_or_invalid"] as never[];
  const report = await runRefresh(db, options({ batchSize: 1 }));
  assert.deepEqual(report.counts, { candidates: 2, ready: 1, rejected: 1, applied: 0, already_applied: 0 });
  assert.equal(db.updates, 0);
  assert.equal(Object.keys(db.jobs).length, 0);
  assert.equal(JSON.parse(rejectionLines(report)).route_id, "b");
  assert.equal(db.calls.filter(call => call.text.includes("refresh:run-start")).length, 1);
  const finish = db.calls.find(call => call.text.includes("refresh:run-finish"))!;
  assert.equal(finish.values[1], "partial");
});

test("empty input and missing explicit ids fail visibly and still finish the run receipt", async () => {
  const db = new FakeDb([]);
  const empty = await runRefresh(db, options());
  assert.match(empty.error!, /Empty/);
  assert.match(rejectionLines(empty), /Empty/);
  assert.equal(db.calls.find(call => call.text.includes("refresh:run-finish"))!.values[1], "failed");
  const absent = await runRefresh(db, options({ routeIds: ["absent"] }));
  assert.deepEqual(absent.rows[0].reasons, ["route_missing"]);
});

test("review hash, target, and explicit subset checks prevent unreviewed or rejected writes", async () => {
  const db = new FakeDb(["a", "b"]);
  db.candidates.b.errors = ["state_missing"] as never[];
  const dryRun = await runRefresh(db, options());
  const contents = JSON.stringify(dryRun);
  assert.throws(() => readReviewedReport(contents, "0".repeat(64), []), /SHA-256/);
  assert.throws(() => readReviewedReport(contents, sha256(contents), []), /rejected routes/);
  assert.throws(() => readReviewedReport(contents, sha256(contents), ["c"]), /absent/);
  assert.deepEqual(readReviewedReport(contents, sha256(contents), ["a"]).rows.map(row => row.route_id), ["a"]);
  const subset = await runRefresh(db, options({ apply: true, expectedSha256: sha256(contents), routeIds: ["a"] }), contents);
  assert.equal(subset.counts.applied, 1);
  assert.deepEqual(subset.review_scope!.unselected, [{ route_id: "b", decision: "rejected", reasons: ["state_missing"] }]);
  db.updates = 0;
  dryRun.target.database = "another_test";
  const wrongTarget = JSON.stringify(dryRun);
  const applied = await runRefresh(db, options({ apply: true, expectedSha256: sha256(wrongTarget), routeIds: ["a"] }), wrongTarget);
  assert.match(applied.error!, /target differs/);
  assert.equal(db.updates, 0);
});

test("apply checks every reviewed row before changing any catalog row", async () => {
  const db = new FakeDb(["a", "b"]);
  const contents = JSON.stringify(await runRefresh(db, options()));
  db.candidates.b.source_fingerprint = "changed after review";
  const report = await runRefresh(db, options({ apply: true, expectedSha256: sha256(contents) }), contents);
  assert.equal(report.counts.rejected, 2);
  assert.deepEqual(report.rows[0].reasons, ["apply_not_attempted_due_to_selected_rejections"]);
  assert.deepEqual(report.rows[1].reasons, ["reviewed_route_changed"]);
  assert.equal(db.updates, 0);
  assert.equal(Object.keys(db.jobs).length, 0);
});

test("apply leases, rechecks under locks, and commits its metadata and completion receipt together", async () => {
  const db = new FakeDb();
  const contents = JSON.stringify(await runRefresh(db, options()));
  const args = options({ apply: true, expectedSha256: sha256(contents) });
  const report = await runRefresh(db, args, contents);
  assert.equal(report.error, undefined);
  assert.equal(report.counts.applied, 1);
  assert.equal(db.updates, 1);
  assert.equal(db.jobs.a.state, "complete");
  const begin = db.calls.findIndex(call => call.text.startsWith("BEGIN"));
  const update = db.calls.findIndex(call => call.text.startsWith("SELECT refresh_peaks_route_catalog_metadata"));
  const complete = db.calls.findIndex(call => call.text.includes("refresh:complete"));
  const commit = db.calls.findIndex(call => call.text === "COMMIT");
  assert.ok(begin < update && update < complete && complete < commit);
  assert.ok(db.calls.find(call => call.text.includes("refresh:claim"))!.text.includes("ON CONFLICT(refresh_kind,route_id)"));
  const again = await runRefresh(db, args, contents);
  assert.equal(again.counts.already_applied, 1);
  assert.equal(db.updates, 1, "replaying a completed report never rewrites unchanged metadata");
});

test("leased routes and changes after preflight cannot slip through the apply path", async () => {
  const db = new FakeDb();
  const contents = JSON.stringify(await runRefresh(db, options()));
  const args = options({ apply: true, expectedSha256: sha256(contents) });
  db.leaseBusy = true;
  assert.deepEqual((await runRefresh(db, args, contents)).rows[0].reasons, ["lease_busy"]);
  assert.equal(db.updates, 0);
  db.leaseBusy = false;
  db.driftOnLockedRead = true;
  assert.deepEqual((await runRefresh(db, args, contents)).rows[0].reasons, ["reviewed_route_changed"]);
  assert.equal(db.updates, 0);
  assert.equal(db.jobs.a.state, "blocked");
  assert.ok(db.calls.some(call => call.text === "ROLLBACK"));
});

test("mandatory logging and unreadable review evidence stop catalog writes", async () => {
  const failure: Queryable = { query: async () => { throw new Error("data_source_runs unavailable"); } };
  await assert.rejects(runRefresh(failure, options()), /data_source_runs unavailable/);
  const db = new FakeDb();
  const report = await runRefresh(db, options({ apply: true, expectedSha256: "0".repeat(64) }), new Error("Review file missing"));
  assert.equal(report.error, "Review file missing");
  assert.equal(db.updates, 0);
  assert.equal(db.calls.find(call => call.text.includes("refresh:run-finish"))!.values[1], "failed");
});


test("names mode has a separate reviewed source, includes active personal routes, and never reads path or links", async () => {
  const db = new FakeDb();
  const args = options({ mode: "names" });
  const dry = await runRefresh(db, args);
  assert.equal(dry.source, "trail_catalog_names");
  assert.deepEqual(dry.rows[0].plan, { route_id: "a", search_name: "example peak", slug: "example-peak-a" });
  assert.equal(dry.rows[0].popularity, undefined);
  assert.doesNotMatch(NAMES_CANDIDATE_SQL, /r\.path|destinations|segments|session_routes/);
  assert.match(db.calls.find(call => call.text.includes("refresh:list"))!.text,
    /status='active' OR \(owner='peaks' AND status='pending'\)/);
  const contents = JSON.stringify(dry);
  assert.throws(() => readReviewedReport(contents, sha256(contents), [], "metadata"), /complete dry-run/);
  const report = await runRefresh(db, { ...args, apply: true, expectedSha256: sha256(contents) }, contents);
  assert.equal(report.counts.applied, 1, JSON.stringify(report));
  assert.equal(db.calls.find(call => call.text.includes("refresh:claim"))!.values[5], "names");
  assert.ok(db.calls.some(call => call.text.startsWith("SELECT refresh_route_catalog_names")));
  assert.ok(!db.calls.some(call => /FROM (route_destinations|route_segments|destinations|segments)/.test(call.text)));
  assert.equal((await runRefresh(db, { ...args, apply: true, expectedSha256: sha256(contents) }, contents)).counts.already_applied, 1);
});

test("timeouts cover the first receipt and a final audit failure preserves committed route results", async () => {
  const db = new FakeDb();
  const contents = JSON.stringify(await runRefresh(db, options()));
  assert.match(db.calls[0].text, /SET statement_timeout/);
  assert.match(db.calls[1].text, /SET lock_timeout/);
  assert.match(db.calls[2].text, /refresh:run-start/);
  db.failRunFinish = true;
  const report = await runRefresh(db, options({ apply: true, expectedSha256: sha256(contents) }), contents);
  assert.equal(report.counts.applied, 1);
  assert.equal(db.jobs.a.state, "complete");
  assert.equal(db.updates, 1);
  assert.match(report.error!, /data_source_runs finalization failed: receipt connection lost/);
  assert.match(rejectionLines(report), /receipt connection lost/);
});


test("mid-apply failures retain earlier writes and mark every later row unattempted", async () => {
  const db = new FakeDb(["a", "b", "c"]);
  const contents = JSON.stringify(await runRefresh(db, options()));
  db.failClaimFor = "b";
  const report = await runRefresh(db, options({ apply: true, expectedSha256: sha256(contents) }), contents);
  assert.match(report.error!, /Claim database unavailable/);
  assert.equal(report.rows[0].decision, "applied");
  assert.deepEqual(report.rows[1].reasons, ["apply_outcome_unconfirmed"]);
  assert.deepEqual(report.rows[2].reasons, ["apply_not_attempted_due_to_run_error"]);
  assert.equal(report.counts.applied, 1);
  assert.equal(report.counts.rejected, 2);
  assert.equal(report.counts.ready, 0);
});

test("connect and mandatory receipt failures persist nonempty evidence before returning", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "trail-refresh-test-"));
  try {
    for (const message of ["Connection refused", "Mandatory receipt unavailable"]) {
      const args = options({ report: path.join(directory, message + ".json"),
        rejections: path.join(directory, message + ".jsonl") });
      const report = await saveRefreshEvidence(args, async () => { throw new Error(message); });
      assert.equal(report.error, message);
      assert.equal(JSON.parse(await readFile(args.report, "utf8")).error, message);
      assert.deepEqual(JSON.parse(await readFile(args.rejections, "utf8")).reasons, [message]);
      assert.equal(report.counts.applied, 0);
      await assert.rejects(saveRefreshEvidence(args, async () => report), /EEXIST/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
