import assert from "node:assert/strict";
import test from "node:test";
import {
  STALE_ELEVATION_REASON,
  auditLeaseLossSql,
  candidateSql,
  classifyAuditLeaseLoss,
  redactAuditJob,
  staleElevationCandidateSql,
  staleElevationJobScopeSql,
  staleElevationSeedSql,
  validateCatalogAuditArgs,
} from "../route-catalog-audit-jobs";

test("public audit job output never exposes a lease token", () => {
  const job = {
    destination_id: "peak-1",
    destination_name: "Peak One",
    state: "auditing" as const,
    priority: 1,
    route_count: 1,
    audit_rule_version: 3,
    catalog_fingerprint: "fingerprint",
    attempt_count: 1,
    lease_owner: "worker-1",
    lease_token: "secret-token",
    lease_expires_at: "2026-08-11T12:00:00Z",
    last_error: null,
    final_result: null,
    audited_at: null,
    updated_at: "2026-08-11T11:30:00Z",
  };

  const output = redactAuditJob(job);
  assert.equal(
    Object.prototype.hasOwnProperty.call(output, "lease_token"),
    false
  );
  assert.equal(output.destination_id, job.destination_id);
  assert.equal(output.lease_owner, job.lease_owner);
});

test("lease-loss diagnosis distinguishes a deleted destination from an unsafe lost lease", () => {
  assert.equal(classifyAuditLeaseLoss({
    destination_exists: false,
    job_exists: false,
    live_worker_lease: false,
  }), "destination_deleted");
  assert.equal(classifyAuditLeaseLoss({
    destination_exists: true,
    job_exists: false,
    live_worker_lease: false,
  }), "job_missing");
  assert.equal(classifyAuditLeaseLoss({
    destination_exists: true,
    job_exists: true,
    live_worker_lease: false,
  }), "lease_missing");
  assert.equal(classifyAuditLeaseLoss({
    destination_exists: true,
    job_exists: true,
    live_worker_lease: true,
  }), "lease_live");
  assert.match(auditLeaseLossSql, /FROM destinations WHERE id = \$1/);
  assert.match(auditLeaseLossSql, /FROM route_catalog_audit_jobs/);
  assert.match(auditLeaseLossSql, /lease_owner = \$2/);
  assert.doesNotMatch(auditLeaseLossSql, /lease_token/);
});

test("lease-loss diagnosis accepts only one destination and worker ID", () => {
  assert.doesNotThrow(() => validateCatalogAuditArgs(
    "diagnose-loss",
    ["--destination-id", "peak-1", "--worker-id", "worker-1"]
  ));
  for (const args of [
    ["--destination-id", "peak-1"],
    ["--worker-id", "worker-1"],
    ["--destination-id", "peak-1", "--destination-id", "peak-2", "--worker-id", "worker-1"],
    ["--destination-id", "peak-1", "--worker-id", "worker-1", "--worker-id", "worker-2"],
    ["--destination-id", "peak-1", "--worker-id", "worker-1", "--lease-token", "secret"],
    ["--destination-id", "peak-1", "--worker-id", "worker-1", "--apply"],
    ["--destination-id", "peak-1", "--worker-id", "worker-1", "--unknown"],
  ]) {
    assert.throws(
      () => validateCatalogAuditArgs("diagnose-loss", args),
      /diagnose-loss requires exactly one --destination-id and --worker-id/
    );
  }
});

test("stale elevation seed flag requires seed apply", () => {
  assert.doesNotThrow(() => validateCatalogAuditArgs("seed", ["--apply"]));
  assert.doesNotThrow(() =>
    validateCatalogAuditArgs("seed", ["--apply", "--stale-elevation-only"])
  );
  assert.throws(
    () => validateCatalogAuditArgs("seed", ["--stale-elevation-only"]),
    /requires seed --apply/
  );
  assert.throws(
    () => validateCatalogAuditArgs("claim", ["--stale-elevation-only", "--apply"]),
    /valid only with seed --apply/
  );
  assert.throws(
    () => validateCatalogAuditArgs("seed", ["--apply", "--all"]),
    /Unknown seed argument/
  );
});

test("targeted candidates keep catalog semantics inside the stale job scope", () => {
  assert.match(
    staleElevationJobScopeSql,
    new RegExp(`final_result->>'stale_reason' = '${STALE_ELEVATION_REASON}'`)
  );
  assert.match(staleElevationCandidateSql, /JOIN stale_elevation_jobs stale_job/);
  assert.match(
    staleElevationCandidateSql,
    /stale_route_destination\.route_id = r\.id/
  );
  for (const semantic of [
    "audit_rule_version",
    "catalog_fingerprint",
    "encode_route_elevation_profile(r.path)",
    "route_elevation_profile_has_real_range(r.path)",
    "route_elevation_stats(r.path)",
    "ST_AsEWKB(segment.path::geometry)",
  ]) {
    assert.equal(candidateSql.includes(semantic), true);
    assert.equal(staleElevationCandidateSql.includes(semantic), true);
  }
});

test("targeted seed updates only stale jobs and handles vanished candidates explicitly", () => {
  assert.match(staleElevationSeedSql, /FROM stale_elevation_jobs stale_job/);
  assert.match(
    staleElevationSeedSql,
    /WHERE job\.destination_id = stale_job\.destination_id/
  );
  assert.match(staleElevationSeedSql, /job\.state <> 'auditing'/);
  assert.match(
    staleElevationSeedSql,
    /WHEN candidate\.destination_id IS NULL THEN 'out_of_scope'/
  );
  assert.match(staleElevationSeedSql, /'reconciled_stale_reason'/);
  assert.match(staleElevationSeedSql, /ELSE 'queued'/);
  assert.match(staleElevationSeedSql, /final_result = CASE/);
  assert.equal(staleElevationSeedSql.match(/WITH catalog_routes AS/g)?.length, 1);
  assert.doesNotMatch(staleElevationSeedSql, /INSERT INTO/);
  assert.doesNotMatch(staleElevationSeedSql, /NOT EXISTS \(\s*SELECT 1\s*FROM candidates/);
});
