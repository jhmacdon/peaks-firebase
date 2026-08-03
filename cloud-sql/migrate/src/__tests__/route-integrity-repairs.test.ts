import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  parseRepairArgs,
  selectQueuedRepair,
  validRepairState,
} from "../route-integrity-repairs";

test("route integrity repair CLI accepts only its documented commands and flags", () => {
  assert.deepEqual(parseRepairArgs(["seed"]), { command: "seed", apply: false });
  assert.deepEqual(parseRepairArgs(["seed", "--apply"]), { command: "seed", apply: true });
  assert.deepEqual(parseRepairArgs(["retire-covered", "--route-id", "route-1"]), {
    command: "retire-covered", routeId: "route-1", apply: false,
  });
  assert.deepEqual(parseRepairArgs(["retire-covered", "--route-id", "route-1", "--apply"]), {
    command: "retire-covered", routeId: "route-1", apply: true,
  });
  assert.deepEqual(parseRepairArgs(["show", "--route-id", "route-1", "--state", "queued", "--limit", "4"]), {
    command: "show", routeId: "route-1", destinationId: null, state: "queued", limit: 4,
  });
  assert.deepEqual(parseRepairArgs(["stats"]), { command: "stats" });
  assert.throws(() => parseRepairArgs(["seed", "--limit", "4"]), /Unknown flag/);
  assert.throws(() => parseRepairArgs(["show", "--state", "bad"]), /state/);
  assert.throws(() => parseRepairArgs(["stats", "--apply"]), /Unknown flag/);
  assert.throws(() => parseRepairArgs(["retire-covered", "--apply"]), /route-id/);
  assert.equal(validRepairState("covered"), true);
  assert.equal(validRepairState("published"), false);
});

test("queued repair selection is deterministic and only selects queued rows", () => {
  assert.deepEqual(selectQueuedRepair([
    { route_id: "z", destination_id: "summit", state: "queued", created_at: "2026-08-03T00:00:02Z" },
    { route_id: "a", destination_id: "summit", state: "queued", created_at: "2026-08-03T00:00:02Z" },
    { route_id: "old", destination_id: "summit", state: "covered", created_at: "2026-08-03T00:00:00Z" },
    { route_id: "first", destination_id: "summit", state: "queued", created_at: "2026-08-03T00:00:01Z" },
  ]), "first");
  assert.equal(selectQueuedRepair([{ route_id: "old", destination_id: "summit", state: "covered", created_at: "2026-08-03T00:00:00Z" }]), null);
});

test("repair migration and standard jobs contract use strict repair gates without coordinates", () => {
  const root = path.resolve(__dirname, "../..");
  const migration = fs.readFileSync(path.join(root, "../migrations/20260803_route_integrity_repairs.sql"), "utf8");
  const schema = fs.readFileSync(path.join(root, "../schema.sql"), "utf8");
  const repairs = fs.readFileSync(path.join(root, "src/route-integrity-repairs.ts"), "utf8");
  const jobs = fs.readFileSync(path.join(root, "src/standard-route-jobs.ts"), "utf8");
  const actions = fs.readFileSync(path.join(root, "../../web/src/lib/actions/routes.ts"), "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS route_integrity_repairs/);
  for (const source of [migration, schema]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? route_integrity_repairs/);
    assert.match(source, /PRIMARY KEY \(route_id, destination_id\)/);
    assert.match(source, /state IN \('queued', 'covered', 'retired', 'needs_human'\)/);
    assert.match(source, /replacement_route_id\s+TEXT REFERENCES routes\(id\) ON DELETE SET NULL/);
    assert.match(source, /CREATE TRIGGER trg_route_integrity_repairs_updated/);
    assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON route_integrity_repairs TO "peaks-api"/);
    assert.match(source, /CREATE OR REPLACE FUNCTION peaks_route_passes_publish_integrity/);
    assert.match(source, /CREATE OR REPLACE FUNCTION settle_route_integrity_replacement/);
    assert.match(
      source,
      /IF repair_count = 0 AND peaks_route_passes_publish_integrity\(\s*old_route_id, NULL, 'active'\s*\)/
    );
    assert.match(
      source,
      /INSERT INTO route_integrity_repairs[\s\S]+?FROM routes old_route[\s\S]+?JOIN route_destinations old_rd/
    );
    assert.match(
      source,
      /IF NOT peaks_route_passes_publish_integrity\(\s*old_route_id, NULL, 'active'\s*\) THEN[\s\S]+?ON CONFLICT \(route_id, destination_id\) DO NOTHING/
    );
    assert.match(source, /Bad replacement route has no linked summit repair rows/);
    assert.match(source, /WHERE rd\.route_id IN \(old_route_id, new_route_id\)[\s\S]+?FOR UPDATE OF rd, d/);
    assert.match(source, /WHERE rs\.route_id IN \(old_route_id, new_route_id\)[\s\S]+?FOR UPDATE OF rs, s/);
    assert.match(
      source,
      /pg_advisory_xact_lock\(hashtextextended\(\s*'peaks-route-replacement:' \|\| old_route_id,\s*0\s*\)\)/
    );
    assert.match(source, /GRANT EXECUTE ON FUNCTION settle_route_integrity_replacement\(TEXT, TEXT, TEXT\)/);
  }
  assert.ok(
    schema.indexOf("CREATE OR REPLACE FUNCTION encode_route_elevation_profile") <
      schema.indexOf("CREATE OR REPLACE FUNCTION peaks_route_passes_publish_integrity"),
    "fresh schema must define the elevation encoder before the publish predicate"
  );
  assert.match(repairs, /ST_DWithin\(r\.path, summit\.location, 5\)/);
  assert.match(repairs, /r2\.elevation_string = encode_route_elevation_profile\(r2\.path\)/);
  assert.match(repairs, /is_valid_route_provenance\(r2\.provenance\)/);
  assert.match(repairs, /s\.provenance IS DISTINCT FROM r2\.provenance/);
  assert.match(repairs, /FROM route_segments ordered_segment/);
  assert.match(repairs, /s\.path IS NULL/);
  assert.match(repairs, /CASE rs\.direction WHEN 'reverse' THEN ST_Reverse\(s\.path::geometry\)/);
  assert.match(repairs, /ST_MakeLine\(\(dumped\)\.geom ORDER BY ordered_segment\.ordinal, \(dumped\)\.path\)/);
  assert.match(repairs, /ST_CoveredBy\(r2\.path::geometry, ST_Buffer\(assembled\.path::geography, 5\)::geometry\)/);
  assert.match(repairs, /ST_DWithin\(ST_EndPoint\(r2\.path::geometry\)::geography, final_destination\.location, 5\)/);
  assert.match(repairs, /'summit'::destination_feature = ANY\(final_destination\.features\)/);
  assert.doesNotMatch(repairs, /final_rd\.destination_id = bl\.destination_id/);
  assert.match(repairs, /NOT ST_DWithin\(r2\.path, all_summit\.location, 5\)/);
  assert.match(repairs, /r2\.owner = 'peaks'/);
  assert.match(repairs, /peaks_route_passes_publish_integrity/);
  assert.match(repairs, /retire-covered/);
  assert.match(repairs, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(repairs, /status = 'superseded'/);
  assert.match(repairs, /requeued_invalid_coverage/);
  assert.doesNotMatch(repairs, /ST_AsText|ST_X\(|ST_Y\(|latitude|longitude/i);
  assert.match(jobs, /route_integrity_repairs/);
  assert.match(
    jobs,
    /peaks_route_passes_publish_integrity\(\s*r\.id,\s*rd\.destination_id,\s*'active'\s*\) AS ready_to_verify/
  );
  assert.match(
    jobs,
    /peaks_route_passes_publish_integrity\(\s*r\.id,\s*\$2,\s*\$4\s*\) AS publish_integrity_valid/
  );
  assert.match(jobs, /approved route failed machine summit, elevation, provenance, or segment assembly gates/);
  assert.match(jobs, /100000/);
  assert.match(jobs, /'integrity_repair', t\.repair_route_id IS NOT NULL/);
  assert.match(jobs, /lease_token IS NOT NULL\s+AND standard_route_backfill_jobs\.lease_expires_at >= now\(\)/);
  assert.match(actions, /async function lockRouteReplacementSettlement/);
  const lockBeforeDestinations = actions.match(
    /lockRouteReplacementSettlement\([\s\S]{0,240}?lockRouteActivationDestinations\(/g
  ) ?? [];
  assert.equal(lockBeforeDestinations.length, 2);
  assert.match(actions, /'peaks-route-replacement:' \|\| \$1/);
});
