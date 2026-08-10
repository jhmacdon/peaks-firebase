import assert from "node:assert/strict";
import test from "node:test";
import {
  STALE_ELEVATION_REASON,
  candidateSql,
  staleElevationCandidateSql,
  staleElevationJobScopeSql,
  staleElevationSeedSql,
  validateCatalogAuditArgs,
} from "../route-catalog-audit-jobs";

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
