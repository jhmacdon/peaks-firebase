import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { buildOsmCandidate, sha256, stableJson } from "../trail-catalog/graph";
import { prepareElevation } from "../trail-catalog/sources";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../lib/terrarium-attribution";
import { claimCandidate, enqueueCandidate, type CandidateArtifact } from "../trail-catalog/jobs";
import { writePendingCandidate } from "../trail-catalog/pending";
import type { CatalogPlace, PilotCandidateInput } from "../trail-catalog/types";

const migration = readFileSync(join(__dirname, "../../../migrations/20261013_trail_catalog_worker_bindings.sql"), "utf8");
test("candidate worker extension leaves activation and review functions intact", () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION (?:activate_standard_route_factory|is_valid_route_provenance|enforce_peaks_route_cover_activation)/);
  assert.match(migration, /current_user <> activation_owner/);
  assert.match(migration, /trail_catalog_span_matches\(NEW.path,NEW.provenance/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.doesNotMatch(migration, /GRANT .*ON data_source_runs/);
});
const operatorUrl = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const factoryUrl = process.env.ROUTE_JOB_FACTORY_TEST_DATABASE_URL;
const reviewerUrl = process.env.ROUTE_JOB_REVIEWER_TEST_DATABASE_URL;
test("factory queue writes exact pending candidates, reuses spans, and cannot bypass review", {
  skip: operatorUrl && factoryUrl && reviewerUrl ? false : "disposable operator/factory/reviewer database URLs required",
}, async () => {
  const target = new URL(operatorUrl!);
  for (const value of [operatorUrl!, factoryUrl!, reviewerUrl!]) {
    const url = new URL(value); assert.match(url.pathname, /_test$/);
    assert.equal(url.pathname, target.pathname); assert.equal(url.host, target.host);
  }
  const operator = new Pool({ connectionString: operatorUrl, max: 1 });
  const factory = new Pool({ connectionString: factoryUrl, max: 1 });
  const reviewer = new Pool({ connectionString: reviewerUrl, max: 1 });
  const worker = await factory.connect();
  const prefix = `trail-worker-${process.pid}-${Date.now()}`;
  const dir = mkdtempSync(join(tmpdir(), "peaks-trail-worker-"));
  const routeIds: string[] = [], segmentIds: string[] = [], sourceKeys: string[] = [], runIds: string[] = [];
  const head: CatalogPlace = { id: `${prefix}-head`, name: "Worker Trailhead", features: ["trailhead"], stateCode: "WA", countryCode: "US", lat: 0.3, lng: 0.3, boundary: null };
  const lake = (n: number): CatalogPlace => ({ ...head, id: `${prefix}-lake-${n}`, name: `Worker Lake ${n}`, features: ["lake"], lng: 0.304 });
  const places = [head, lake(1), lake(2), lake(3)];
  const artifact = (n: number): CandidateArtifact => {
    const name = `Worker Trail ${n}`;
    const source = { elements: [
      ...Array.from({ length: 5 }, (_, i) => ({ type: "node", id: 101 + i, lat: head.lat, lon: 0.3 + i * 0.001 })),
      { type: "way", id: 10001, nodes: [101, 102, 103, 104, 105], tags: { highway: "path", name: "Shared Trail" } },
      { type: "relation", id: 20000 + n, members: [{ type: "way", ref: 10001 }], tags: { type: "route", route: "hiking", name } },
    ] };
    const body = JSON.stringify(source), sourceKey = `${prefix}:${n}`; sourceKeys.push(sourceKey);
    const input: PilotCandidateInput = { sourceKey, name, kind: "destination", trailheadId: head.id, objectiveId: lake(n).id, startNodeId: 101, endNodeId: 105,
      source: { type: "osm", relationId: 20000 + n, snapshots: [{ path: "source.json", sha256: sha256(body), url: `https://api.openstreetmap.org/api/0.6/relation/${20000 + n}/full.json`, retrievedAt: `2026-10-0${n}T00:00:00Z` }] } };
    const built = buildOsmCandidate(input, [source], { trailhead: head, objective: lake(n) });
    const elevation = JSON.stringify({ points: built.points.map((point, i) => ({ ...point, ele: 100 + i * 20 })), lineage: {
      source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)", sourceUrl: "https://registry.opendata.aws/terrain-tiles/",
      licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", attribution: TERRARIUM_REQUIRED_ATTRIBUTION,
      retrievedAt: "2026-10-01T00:00:00Z", profile: "terrain",
    } });
    writeFileSync(join(dir, "elevation.json"), elevation);
    built.input.elevation = { path: "elevation.json", sha256: sha256(elevation) };
    return { candidate: prepareElevation(built, dir), snapshots: [{ body, sha256: sha256(body) }] };
  };
  try {
    await worker.query("SET statement_timeout='30s'"); await worker.query("SET lock_timeout='5s'");
    for (const p of places) await operator.query(`INSERT INTO destinations(id,name,search_name,features,state_code,country_code,location)
      VALUES($1,$2,lower($2),$3::destination_feature[],$4,$5,ST_SetSRID(ST_MakePoint($6,$7,100),4326)::geography)`,
    [p.id, p.name, p.features, p.stateCode, p.countryCode, p.lng, p.lat]);
    const rejectedKey = `${prefix}:research-rejected`; sourceKeys.push(rejectedKey);
    await worker.query(`INSERT INTO trail_catalog_candidate_jobs(source_key,batch_key,input_hash,review_hash,artifact,state,rejection_reason,result,proposed_route_id)
      VALUES($1,$2,$3,$3,$4::jsonb,'rejected','source_gap',$5::jsonb,$6)`,
    [rejectedKey,prefix,"d".repeat(64),JSON.stringify({ input: { sourceKey: rejectedKey }, report: { reason: "source_gap" } }),
      JSON.stringify({ sourceKey: rejectedKey, reason: "source_gap" }),`${prefix}-rejected`]);
    assert.equal((await worker.query("SELECT state FROM trail_catalog_candidate_jobs WHERE source_key=$1",[rejectedKey])).rows[0].state,"rejected");
    const first = artifact(1);
    await enqueueCandidate(worker, prefix, "a".repeat(64), first);
    assert.deepEqual(await enqueueCandidate(worker, prefix, "a".repeat(64), first), { state: "queued", routeId: null });
    const lease = await claimCandidate(worker, first.candidate.input.sourceKey, sha256(stableJson(first)), "factory-test");
    assert.ok(lease); routeIds.push(lease.proposedRouteId);
    assert.equal(await claimCandidate(worker, lease.sourceKey, lease.inputHash, "other-worker"), null);
    const report = await writePendingCandidate(worker, lease);
    assert.equal(report.routeId, lease.proposedRouteId); assert.equal(report.segmentIds?.length, 1);
    segmentIds.push(...report.segmentIds!);
    assert.equal((await worker.query("SELECT trail_catalog_pending_binding_valid($1) AS valid", [report.routeId])).rows[0].valid, true);
    assert.equal((await worker.query("SELECT status FROM routes WHERE id=$1", [report.routeId])).rows[0].status, "pending");
    assert.deepEqual(await enqueueCandidate(worker, prefix, "a".repeat(64), first), { state: "pending", routeId: report.routeId });
    // The disposable operator mirrors API table privileges and is not a worker.
    // A caller with route UPDATE rights still cannot skip independent review.
    assert.equal((await operator.query("SELECT pg_has_role(session_user,'peaks-route-factory','member') AS factory")).rows[0].factory,false);
    await assert.rejects(operator.query("UPDATE routes SET status='active' WHERE id=$1",[report.routeId]), /requires independent review; direct activation is disabled/);
    assert.equal((await operator.query("SELECT status FROM routes WHERE id=$1",[report.routeId])).rows[0].status,"pending");
    await assert.rejects(worker.query("UPDATE routes SET status='active' WHERE id=$1", [report.routeId]), /bound activation function/);
    await assert.rejects(worker.query("SELECT activate_standard_route_factory($1,$2,$3)", [report.routeId, lake(1).id, "unreviewed"]));
    await assert.rejects(worker.query("UPDATE trail_catalog_candidate_jobs SET artifact=jsonb_set(artifact,'{candidate,input,name}','\"Forged\"') WHERE source_key=$1", [lease.sourceKey]), /immutable/);
    await assert.rejects(worker.query("UPDATE trail_catalog_candidate_jobs SET result='{}' WHERE source_key=$1", [lease.sourceKey]), /immutable/);
    await assert.rejects(reviewer.query("INSERT INTO trail_catalog_candidate_jobs SELECT * FROM trail_catalog_candidate_jobs WHERE source_key=$1", [lease.sourceKey]), /permission denied/);
    const second = artifact(2); await enqueueCandidate(worker, prefix, "b".repeat(64), second);
    const sharedLease = await claimCandidate(worker, second.candidate.input.sourceKey, sha256(stableJson(second)), "factory-test");
    assert.ok(sharedLease); routeIds.push(sharedLease.proposedRouteId);
    const shared = await writePendingCandidate(worker, sharedLease);
    assert.deepEqual(shared.segmentIds, report.segmentIds, "exact source span reuses across distinct route URLs and retrieval times");
    assert.ok((shared.reusedLengthM ?? 0) > 400);
    assert.equal((await worker.query("SELECT trail_catalog_pending_binding_valid($1) AS valid", [shared.routeId])).rows[0].valid, true);
    const third = artifact(3); await enqueueCandidate(worker, prefix, "c".repeat(64), third);
    const incomplete = await claimCandidate(worker, third.candidate.input.sourceKey, sha256(stableJson(third)), "factory-test");
    assert.ok(incomplete); routeIds.push(incomplete.proposedRouteId);
    const setContext = () => worker.query("SELECT set_config('peaks.trail_candidate_source_key',$1,true),set_config('peaks.trail_candidate_lease_token',$2,true),set_config('peaks.trail_candidate_span_start','0',true),set_config('peaks.trail_candidate_span_end','4',true)", [incomplete.sourceKey, incomplete.token]);
    await worker.query("BEGIN"); await setContext();
    await assert.rejects(worker.query(`INSERT INTO segments(id,path,provenance)
      SELECT $1,ST_Translate(path::geometry,0.01,0)::geography,provenance FROM segments WHERE id=$2`, [`${prefix}-forged`, segmentIds[0]]), /reviewed source span/);
    await worker.query("ROLLBACK");
    await worker.query("BEGIN"); await setContext();
    await worker.query(`INSERT INTO segments(id,path,provenance,distance,gain,gain_loss)
      SELECT $1,path,provenance,distance,gain,gain_loss FROM segments WHERE id=$2`, [`${prefix}-orphan`, segmentIds[0]]);
    await assert.rejects(worker.query("COMMIT"), /escaped its route-job binding/); await worker.query("ROLLBACK");
    assert.equal((await operator.query("SELECT count(*)::int AS n FROM segments WHERE id=$1", [`${prefix}-orphan`])).rows[0].n, 0);
    await operator.query("UPDATE trail_catalog_candidate_jobs SET lease_expires_at=now()-interval '1 second' WHERE source_key=$1",[incomplete.sourceKey]);
    await worker.query("BEGIN"); await setContext();
    await assert.rejects(worker.query(`INSERT INTO segments(id,path,provenance)
      SELECT $1,path,provenance FROM segments WHERE id=$2`,[`${prefix}-expired`,segmentIds[0]]),/reviewed source span/);
    await worker.query("ROLLBACK");
    const run = await worker.query("SELECT begin_trail_catalog_source_run($1) AS id", [prefix]); runIds.push(String(run.rows[0].id));
    await assert.rejects(worker.query("UPDATE data_source_runs SET status='success' WHERE id=$1", [run.rows[0].id]), /permission denied/);
    await assert.rejects(reviewer.query("SELECT finish_trail_catalog_source_run($1,'success',2,2,2,$2)", [run.rows[0].id, prefix]), /permission denied/);
    await worker.query("SELECT finish_trail_catalog_source_run($1,'success',2,2,2,$2)", [run.rows[0].id, prefix]);
    await assert.rejects(worker.query("SELECT finish_trail_catalog_source_run($1,'success',2,2,2,$2)", [run.rows[0].id, prefix]), /unfinished attempt/);
    assert.equal((await operator.query("SELECT rows_written FROM data_source_runs WHERE id=$1", [run.rows[0].id])).rows[0].rows_written, 2);
  } finally {
    await worker.query("ROLLBACK");
    await operator.query("DELETE FROM trail_catalog_candidate_jobs WHERE source_key=ANY($1::text[])", [sourceKeys]);
    await operator.query("DELETE FROM routes WHERE id=ANY($1::text[])", [routeIds]);
    await operator.query("DELETE FROM segments WHERE id=ANY($1::text[])", [[...segmentIds, `${prefix}-orphan`, `${prefix}-forged`]]);
    await operator.query("DELETE FROM destinations WHERE id=ANY($1::text[])", [places.map(p => p.id)]);
    await operator.query("DELETE FROM data_source_runs WHERE id=ANY($1::bigint[])", [runIds]);
    worker.release(); await Promise.all([factory.end(), operator.end(), reviewer.end()]);
    rmSync(dir, { recursive: true, force: true });
  }
});
