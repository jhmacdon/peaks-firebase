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
import type { CatalogPlace, PilotCandidateInput, TrailKind } from "../trail-catalog/types";

const sql = readFileSync(join(__dirname, "../../../migrations/20261014_trail_catalog_review_activation.sql"), "utf8");
test("catalog activation keeps canonical rights, integrity, covers and rematch triggers", () => {
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION (?:is_valid_route_provenance|peaks_route_passes_publish_integrity|enforce_peaks_route_cover_activation|queue_rematch_on_route_change)/);
  assert.doesNotMatch(sql, /GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*trail_catalog_review_jobs[^;]*TO "peaks-route-(?:factory|reviewer)"/);
  assert.match(sql, /current_user='peaks-trail-publisher'/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /ST_NPoints\(r.path::geometry\)>=5/);
  assert.match(sql, /route_record.distance IS NOT DISTINCT FROM ST_Length/);
  assert.match(sql, /r.gain<=2000/);
});

const operatorUrl = process.env.ROUTE_JOB_TEST_DATABASE_URL;
const factoryUrl = process.env.ROUTE_JOB_FACTORY_TEST_DATABASE_URL;
const reviewerUrl = process.env.ROUTE_JOB_REVIEWER_TEST_DATABASE_URL;
const apiUrl = process.env.ROUTE_JOB_API_TEST_DATABASE_URL;
const adminUrl = process.env.ROUTE_JOB_ADMIN_TEST_DATABASE_URL;
const available = operatorUrl && factoryUrl && reviewerUrl && apiUrl && adminUrl;

test("a non-superuser operator can transfer function ownership and revoke its temporary membership", {
  skip: adminUrl ? false : "disposable admin database URL required",
}, async () => {
  assert.match(new URL(adminUrl!).pathname, /_test$/);
  const pool = new Pool({ connectionString: adminUrl, max: 1 }), client = await pool.connect();
  const suffix = `${process.pid}_${Date.now()}`, schema = `catalog_owner_${suffix}`, operator = `catalog_operator_${suffix}`, owner = `catalog_owner_${suffix}`;
  try {
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_database WHERE datname='peaks'")).rows[0].n,0);
    await client.query(`CREATE ROLE "${operator}" NOLOGIN NOSUPERUSER CREATEROLE NOCREATEDB INHERIT`);
    await client.query(`CREATE SCHEMA "${schema}" AUTHORIZATION "${operator}"`);
    await client.query(`SET SESSION AUTHORIZATION "${operator}"`);
    assert.equal((await client.query("SELECT rolsuper FROM pg_roles WHERE rolname=session_user")).rows[0].rolsuper,false);
    await client.query(`CREATE ROLE "${owner}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await client.query(`CREATE FUNCTION "${schema}".activate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN RETURN; END;'`);
    await client.query(`GRANT CREATE ON SCHEMA "${schema}" TO "${owner}"`);
    await client.query(`GRANT "${owner}" TO "${operator}"`);
    await client.query(`ALTER FUNCTION "${schema}".activate() OWNER TO "${owner}"`);
    await client.query(`REVOKE CREATE ON SCHEMA "${schema}" FROM "${owner}"`);
    await client.query(`REVOKE "${owner}" FROM "${operator}"`);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole OR member=$1::regrole",[owner])).rows[0].n,0);
    await assert.rejects(client.query(`SET ROLE "${owner}"`),/permission denied|not permitted/);
  } finally {
    await client.query("RESET SESSION AUTHORIZATION");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const role of [owner,operator]) await client.query(`DROP ROLE IF EXISTS "${role}"`);
    client.release(); await pool.end();
  }
});

test("disposable catalog lanes bind independent review, exact source/XYZ/place proofs and atomic verified activation", {
  skip: available ? false : "disposable operator/factory/reviewer/API/admin database URLs required",
}, async () => {
  const target = new URL(operatorUrl!);
  for (const value of [operatorUrl!, factoryUrl!, reviewerUrl!, apiUrl!, adminUrl!]) {
    const url = new URL(value); assert.match(url.pathname, /_test$/); assert.equal(url.host, target.host); assert.equal(url.pathname, target.pathname);
  }
  // Pending imports hold one factory connection; lane checks need another.
  const operator = new Pool({ connectionString: operatorUrl, max: 1 }), factory = new Pool({ connectionString: factoryUrl, max: 2, connectionTimeoutMillis: 10_000 });
  const reviewer = new Pool({ connectionString: reviewerUrl, max: 1 }), api = new Pool({ connectionString: apiUrl, max: 1 });
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const worker = await factory.connect();
  const prefix = `catalog-review-${process.pid}-${Date.now()}`, dir = mkdtempSync(join(tmpdir(), "catalog-review-test-"));
  const routeIds: string[] = [], segmentIds: string[] = [], sourceKeys: string[] = [], placeIds: string[] = [], runIds: string[] = [];
  let fixtureIndex = 0;
  async function candidate(kind: TrailKind, creditedCover = true, pointsCount = 5) {
    const index = ++fixtureIndex, lat = 40 + index * 0.1;
    const head: CatalogPlace = { id: `${prefix}-head-${index}`, name: `Catalog head ${index}`, features: ["trailhead"], lat, lng: -120, stateCode: "WA", countryCode: "US", boundary: null };
    const points = kind === "loop" ? [{ lat, lng: -120 }, { lat, lng: -119.98 }, { lat: lat + 0.02, lng: -119.98 }, { lat: lat + 0.02, lng: -120 }, { lat, lng: -120 }]
      : Array.from({ length: pointsCount }, (_, i) => ({ lat, lng: -120 + i * 0.004 }));
    const objective: CatalogPlace | null = kind === "loop" ? null : { ...head, ...points[kind === "traverse" ? 2 : points.length - 1], id: `${prefix}-objective-${index}`, name: `Catalog objective ${index}`, features: kind === "summit" ? ["summit"] : ["lake"] };
    const endHead: CatalogPlace | null = kind === "traverse" ? { ...head, ...points.at(-1)!, id: `${prefix}-end-${index}`, name: `Catalog end ${index}` } : null;
    const places = [head, objective, endHead].filter((p): p is CatalogPlace => Boolean(p));
    for (const p of places) {
      placeIds.push(p.id);
      // For a traverse, only its separate last trailhead supplies the cover.
      const cover = creditedCover && p.id === (endHead?.id ?? head.id);
      await operator.query(`INSERT INTO destinations(id,name,search_name,features,state_code,country_code,location,hero_image,hero_image_attribution,hero_image_attribution_url)
        VALUES($1,$2,lower($2),$3::destination_feature[],$4,$5,ST_SetSRID(ST_MakePoint($6,$7,100),4326)::geography,$8,$9,$10)`,
      [p.id,p.name,p.features,p.stateCode,p.countryCode,p.lng,p.lat,cover ? "https://example.org/credited.jpg" : null,cover ? "Fixture photographer; CC BY" : null,cover ? "https://example.org/license" : null]);
    }
    const wayId = 50000 + index, relationId = 60000 + index, name = `Catalog reviewed ${kind} ${index}`;
    const nodeIds = points.map((_, i) => 1000 + index * 10 + i);
    if (kind === "loop") nodeIds[nodeIds.length - 1] = nodeIds[0];
    const source = { elements: [
      ...points.slice(0, kind === "loop" ? -1 : undefined).map((point, i) => ({ type: "node", id: nodeIds[i], lat: point.lat, lon: point.lng })),
      { type: "way", id: wayId, nodes: nodeIds, tags: { highway: "path", name } },
      { type: "relation", id: relationId, members: [{ type: "way", ref: wayId }], tags: { type: "route", route: "hiking", name } },
    ] };
    const body = JSON.stringify(source), sourceKey = `${prefix}:${index}`; sourceKeys.push(sourceKey);
    const input: PilotCandidateInput = { sourceKey, name, kind, trailheadId: head.id, objectiveId: objective?.id ?? null, ...(endHead ? { endTrailheadId: endHead.id } : {}), startNodeId: nodeIds[0], ...(kind !== "loop" ? { endNodeId: nodeIds.at(-1) } : {}),
      source: { type: "osm", relationId, snapshots: [{ path: "source.json", sha256: sha256(body), url: `https://api.openstreetmap.org/api/0.6/relation/${relationId}/full.json`, retrievedAt: new Date().toISOString() }] } };
    const built = buildOsmCandidate(input, [source], { trailhead: head, objective, endTrailhead: endHead });
    const elevation = JSON.stringify({ points: built.points.map((point, i) => ({ ...point, ele: kind === "loop" ? [100,140,180,140,100][i] : 100 + i * 20 })), lineage: {
      source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)", sourceUrl: "https://registry.opendata.aws/terrain-tiles/", attribution: TERRARIUM_REQUIRED_ATTRIBUTION,
      licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", retrievedAt: new Date().toISOString(), profile: "terrain",
    } });
    const elevationPath = join(dir, `elevation-${index}.json`); writeFileSync(elevationPath, elevation); built.input.elevation = { path: elevationPath, sha256: sha256(elevation) };
    const artifact: CandidateArtifact = { candidate: prepareElevation(built, dir), snapshots: [{ body, sha256: sha256(body) }] };
    await enqueueCandidate(worker, prefix, "a".repeat(64), artifact);
    const lease = await claimCandidate(worker, sourceKey, sha256(stableJson(artifact)), "catalog-test"); assert.ok(lease); routeIds.push(lease.proposedRouteId);
    const report = await writePendingCandidate(worker, lease); segmentIds.push(...report.segmentIds!);
    return { sourceKey, routeId: lease.proposedRouteId, inputHash: sha256(stableJson(artifact)), artifact, report, head, objective, endHead };
  }
  type Fixture = Awaited<ReturnType<typeof candidate>>;
  async function claimAndBind(fixture: Fixture) {
    const claim = (await reviewer.query("SELECT claim_trail_catalog_review($1,$2) lease", [fixture.sourceKey,fixture.inputHash])).rows[0].lease; assert.ok(claim);
    const checks = (await reviewer.query("SELECT trail_catalog_review_machine_checks($1) checks", [fixture.sourceKey])).rows[0].checks;
    const sourceCheck = { routeId: fixture.routeId, checkedAt: new Date().toISOString(), passed: true, errors: [], results: { verdict: "PASS", results: [{ route_id: fixture.routeId, passed: true, errors: [] }] }, machineChecks: { ...checks, gates: { ...checks.gates, source_geometry: true, stats: true }, errors: [] } };
    const draft = { schemaVersion: 1, sourceKey: fixture.sourceKey, routeId: fixture.routeId, inputHash: fixture.inputHash, kind: fixture.artifact.candidate.input.kind,
      trailheadId: fixture.head.id, objectiveId: fixture.objective?.id ?? null, endTrailheadId: fixture.endHead?.id ?? null, sourceCheck,
      reviewResultTemplate: { verdict: null, reviewed_at: new Date().toISOString(), gates: null, errors: [] } };
    const packet = (await reviewer.query("SELECT bind_trail_catalog_review_packet($1,$2,$3::jsonb,$4::jsonb) packet", [fixture.sourceKey,claim.leaseToken,JSON.stringify(draft),JSON.stringify(sourceCheck)])).rows[0].packet;
    assert.deepEqual(packet.reviewResultTemplate.attestation, packet.attestation);
    const result = { verdict: "PASS", reviewed_at: new Date().toISOString(), attestation: packet.attestation, gates: Object.fromEntries(["route_identity","geometry_rights","access","map_review","source_geometry","endpoints","statistics","self_intersection"].map(key => [key,true])), errors: [] };
    return { claim, checks, sourceCheck, draft, packet, result };
  }
  async function finish(fixture: Fixture, review: Awaited<ReturnType<typeof claimAndBind>>, result = review.result) {
    return (await reviewer.query("SELECT finish_trail_catalog_review($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) receipt", [fixture.sourceKey,review.claim.leaseToken,JSON.stringify(review.packet),JSON.stringify(result),JSON.stringify(review.sourceCheck)])).rows[0].receipt;
  }
  async function verify(fixture: Fixture, receiptHash: string) {
    const lease = (await factory.query("SELECT claim_trail_catalog_verification($1,$2) lease", [fixture.sourceKey,receiptHash])).rows[0].lease; assert.ok(lease);
    const row = (await factory.query(`SELECT trail_catalog_verification_snapshot_hash($1) snapshot_hash,
      md5(concat_ws('|',COALESCE(elevation_string,''),COALESCE(gain::text,''),COALESCE(gain_loss::text,''),status,updated_at::text)) fingerprint FROM routes WHERE id=$2`, [fixture.sourceKey,fixture.routeId])).rows[0];
    const base = "https://peaks-firebase--donner-a8608.us-central1.hosted.app";
    const result = { routeId: fixture.routeId, receiptHash, snapshotHash: row.snapshot_hash, checkedAt: new Date().toISOString(), passed: true,
      gates: { public_http: true, search: true, rematch_drained: true }, routeVerification: { route_id: fixture.routeId, verdict: "PASS", public_status: 200, public_url: `${base}/api/public/routes/${fixture.routeId}?elevation_fingerprint=${row.fingerprint}`,
        gates: Object.fromEntries(["owner","active","destination_order","segments","provenance","summit_contact","objective_contact","elevation_profile","public_http"].map(key => [key,true])) },
      search: { url: `${base}/api/search/all?q=Catalog&limit=50`, status: 200, rank: 1, routeId: fixture.routeId } };
    const submit = (proof: typeof result) => factory.query("SELECT finish_trail_catalog_verification($1,$2,$3,$4::jsonb) receipt", [fixture.sourceKey,lease.leaseToken,receiptHash,JSON.stringify(proof)]);
    await assert.rejects(submit({ ...result, routeVerification: { ...result.routeVerification, route_id: "another-route" } }), /verification fails/);
    await assert.rejects(submit({ ...result, checkedAt: "2020-01-01T00:00:00Z" }), /verification fails/);
    await assert.rejects(submit({ ...result, routeVerification: { ...result.routeVerification, public_url: "https://example.org/fake" } }), /verification fails/);
    await assert.rejects(submit({ ...result, snapshotHash: "d".repeat(64) }), /verification fails/);
    await assert.rejects(submit({ ...result, search: { ...result.search, routeId: "other" } }), /verification fails/);
    const saved = (await submit(result)).rows[0].receipt; assert.equal(saved.state,"verified");
  }
  try {
    assert.equal((await admin.query("SELECT count(*)::int n FROM pg_auth_members WHERE roleid='peaks-trail-publisher'::regrole OR member='peaks-trail-publisher'::regrole")).rows[0].n,0);
    const run = (await reviewer.query("SELECT begin_trail_catalog_source_run($1) id",[JSON.stringify({ phase: "independent-review" })])).rows[0].id; runIds.push(run);
    await assert.rejects(factory.query("SELECT finish_trail_catalog_review_run($1,'failed',1,0,NULL,$2)",[run,JSON.stringify({outcomeUnconfirmed:true})]),/does not belong/);
    await assert.rejects(reviewer.query("SELECT finish_trail_catalog_review_run($1,'failed',1,0,NULL,'{}')",[run]),/invalid/);
    await reviewer.query("SELECT finish_trail_catalog_review_run($1,'failed',1,0,NULL,$2)",[run,JSON.stringify({outcomeUnconfirmed:true,knownWrites:0})]);
    assert.equal((await operator.query("SELECT source,rows_written FROM data_source_runs WHERE id=$1",[run])).rows[0].source,"trail-catalog-review");
    assert.equal((await operator.query("SELECT rows_written FROM data_source_runs WHERE id=$1",[run])).rows[0].rows_written,null);
    const destination = await candidate("destination"), review = await claimAndBind(destination);
    const distance = (await operator.query(`SELECT distance,ST_Length(path) xyz_distance,
      ST_Length(ST_Force2D(path::geometry)::geography) horizontal_distance FROM routes WHERE id=$1`,[destination.routeId])).rows[0];
    assert.equal(distance.distance,distance.xyz_distance,"the importer stores PostGIS geography XYZ length");
    assert.ok(distance.xyz_distance>distance.horizontal_distance,"non-flat geography includes each edge's height change");
    assert.equal(review.checks.measurements.distance_m,distance.distance,"review statistics use the stored distance basis");
    assert.equal(review.checks.gates.stats,true);
    assert.equal(review.checks.measurements.summit_count,0); assert.equal(review.checks.measurements.summit_max_gap_m,null);
    assert.deepEqual(review.checks.errors,[]);
    for (const pool of [factory, api]) {
      await assert.rejects(pool.query("UPDATE trail_catalog_review_jobs SET state='approved' WHERE source_key=$1",[destination.sourceKey]),/permission denied|owned lane/);
      await assert.rejects(pool.query("SELECT finish_trail_catalog_review($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)",[destination.sourceKey,review.claim.leaseToken,JSON.stringify(review.packet),JSON.stringify(review.result),JSON.stringify(review.sourceCheck)]),/permission denied|reviewer/);
    }
    await assert.rejects(reviewer.query("UPDATE routes SET status='active' WHERE id=$1",[destination.routeId]),/permission denied|cannot write/);
    await assert.rejects(reviewer.query("SELECT bind_trail_catalog_review_packet($1,'stolen',$2::jsonb,$3::jsonb)",[destination.sourceKey,JSON.stringify(review.draft),JSON.stringify(review.sourceCheck)]),/lease lost/);
    await assert.rejects(finish(destination,review,{...review.result,attestation:{...review.result.attestation,kind:"summit"}}),/binding differs/);
    await assert.rejects(finish(destination,review,{...review.result,gates:{...review.result.gates,access:false}}),/approval fails/);
    await admin.query("UPDATE trail_catalog_review_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE source_key=$1",[destination.sourceKey]);
    await assert.rejects(finish(destination,review),/lease lost/);
    const fresh = await claimAndBind(destination); assert.notEqual(fresh.claim.leaseToken,review.claim.leaseToken);
    await assert.rejects(finish(destination,{...fresh,packet:review.packet,result:review.result}),/binding differs/);
    const completing = await reviewer.connect(), competing = new Pool({ connectionString: reviewerUrl, max: 1, statement_timeout: 5000 });
    let receipt: any;
    try {
      await completing.query("BEGIN");
      receipt = (await completing.query("SELECT finish_trail_catalog_review($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) receipt",[destination.sourceKey,fresh.claim.leaseToken,JSON.stringify(fresh.packet),JSON.stringify(fresh.result),JSON.stringify(fresh.sourceCheck)])).rows[0].receipt;
      const reclaim = competing.query("SELECT claim_trail_catalog_review($1,$2) lease",[destination.sourceKey,destination.inputHash]);
      await completing.query("COMMIT");
      assert.equal((await reclaim).rows[0].lease,null,"a claim racing a completed review has no second lease and no lock inversion");
    } finally { await completing.query("ROLLBACK"); completing.release(); await competing.end(); }
    assert.equal(receipt.state,"approved"); assert.match(receipt.receiptHash,/^[a-f0-9]{64}$/);
    for (const pool of [api, factory]) {
      await assert.rejects(pool.query("UPDATE routes SET status='active' WHERE id=$1",[destination.routeId]),/owned|bound activation|direct activation/);
      await assert.rejects(pool.query("UPDATE routes SET id=$2 WHERE id=$1",[destination.routeId,`${prefix}-rekey`]),/immutable|only route status/);
    }
    await assert.rejects(api.query("UPDATE routes SET distance=distance+1 WHERE id=$1",[destination.routeId]),/immutable/);
    await assert.rejects(api.query("UPDATE segments SET gain=gain+1 WHERE id=$1",[destination.report.segmentIds![0]]),/immutable/);
    await assert.rejects(api.query("DELETE FROM route_destinations WHERE route_id=$1",[destination.routeId]),/immutable/);
    const publish = (await factory.query("SELECT claim_trail_catalog_publish($1,$2) lease",[destination.sourceKey,receipt.receiptHash])).rows[0].lease; assert.ok(publish);
    await factory.query("SELECT set_config('peaks.trail_candidate_source_key',$1,false),set_config('peaks.trail_candidate_lease_token',$2,false)",[destination.sourceKey,publish.leaseToken]);
    await assert.rejects(factory.query("UPDATE routes SET status='active' WHERE id=$1",[destination.routeId]),/owned|bound activation|direct activation/);
    await assert.rejects(factory.query("SELECT activate_trail_catalog_candidate($1,'stolen',$2)",[destination.sourceKey,receipt.receiptHash]),/lease\/receipt lost/);
    await operator.query("UPDATE destinations SET hero_image_attribution=NULL WHERE id=$1",[destination.head.id]);
    await assert.rejects(factory.query("SELECT activate_trail_catalog_candidate($1,$2,$3)",[destination.sourceKey,publish.leaseToken,receipt.receiptHash]),/cover drift/);
    assert.equal((await operator.query("SELECT status FROM routes WHERE id=$1",[destination.routeId])).rows[0].status,"pending");
    await operator.query("UPDATE destinations SET hero_image_attribution='Fixture photographer; CC BY' WHERE id=$1",[destination.head.id]);
    await operator.query("UPDATE destinations SET name='Changed catalog place' WHERE id=$1",[destination.head.id]);
    await assert.rejects(factory.query("SELECT activate_trail_catalog_candidate($1,$2,$3)",[destination.sourceKey,publish.leaseToken,receipt.receiptHash]),/snapshot/);
    await operator.query("UPDATE destinations SET name=$2 WHERE id=$1",[destination.head.id,destination.head.name]);
    const activated = (await factory.query("SELECT activate_trail_catalog_candidate($1,$2,$3) receipt",[destination.sourceKey,publish.leaseToken,receipt.receiptHash])).rows[0].receipt; assert.equal(activated.state,"published");
    await assert.rejects(factory.query("SELECT activate_trail_catalog_candidate($1,$2,$3)",[destination.sourceKey,publish.leaseToken,receipt.receiptHash]),/lease\/receipt lost/);
    const summit = await candidate("summit"), summitReview = await claimAndBind(summit), summitReceipt = await finish(summit,summitReview);
    assert.equal(summitReview.checks.measurements.summit_count,1); assert.ok(summitReview.checks.measurements.summit_max_gap_m<=5);
    await assert.rejects(factory.query("SELECT claim_trail_catalog_publish($1,$2)",[summit.sourceKey,summitReceipt.receiptHash]),/previous publication/);
    await verify(destination,receipt.receiptHash);
    const summitLease = (await factory.query("SELECT claim_trail_catalog_publish($1,$2) lease",[summit.sourceKey,summitReceipt.receiptHash])).rows[0].lease;
    await factory.query("SELECT release_trail_catalog_publish($1,$2)",[summit.sourceKey,summitLease.leaseToken]);
    for (const kind of ["loop","traverse"] as const) {
      const fixture = await candidate(kind), proof = await claimAndBind(fixture); assert.deepEqual(proof.checks.errors,[]);
      if (kind==="traverse") assert.equal(proof.checks.gates.credited_cover,true,"a separate end trailhead's credited cover remains valid");
      const saved = await finish(fixture,proof), lease = (await factory.query("SELECT claim_trail_catalog_publish($1,$2) lease",[fixture.sourceKey,saved.receiptHash])).rows[0].lease;
      await factory.query("SELECT activate_trail_catalog_candidate($1,$2,$3)",[fixture.sourceKey,lease.leaseToken,saved.receiptHash]);
      await verify(fixture,saved.receiptHash);
    }
    const missingCover = await candidate("destination",false), noCoverReview = await claimAndBind(missingCover);
    assert.equal(noCoverReview.checks.gates.credited_cover,false);
    await assert.rejects(finish(missingCover,noCoverReview),/approval fails/);
    const rejected = await finish(missingCover,noCoverReview,{...noCoverReview.result,verdict:"FAIL",errors:["No credited cover"]} as never);
    assert.equal(rejected.state,"rejected"); assert.match(rejected.receiptHash,/^[a-f0-9]{64}$/);
    const tooShort = await candidate("destination",true,4), shortReview = await claimAndBind(tooShort);
    assert.equal(shortReview.checks.gates.xyz_assembly,false); await assert.rejects(finish(tooShort,shortReview),/approval fails/);
    const forgedSummit = await candidate("destination");
    await operator.query("UPDATE destinations SET features=ARRAY['lake','summit']::destination_feature[],location=ST_Translate(location::geometry,0.02,0)::geography WHERE id=$1",[forgedSummit.objective!.id]);
    const checks = (await reviewer.query("SELECT trail_catalog_review_machine_checks($1) checks",[forgedSummit.sourceKey])).rows[0].checks;
    assert.equal(checks.gates.linked_summits,false,"a non-summit kind still fails an off-line linked summit");
    await assert.rejects(reviewer.query("SELECT claim_trail_catalog_review($1,$2)",[forgedSummit.sourceKey,forgedSummit.inputHash]),/snapshot drift/);
  } finally {
    await worker.query("ROLLBACK");
    await admin.query("DELETE FROM trail_catalog_review_jobs WHERE source_key=ANY($1::text[])",[sourceKeys]);
    await admin.query("DELETE FROM trail_catalog_candidate_jobs WHERE source_key=ANY($1::text[])",[sourceKeys]);
    await operator.query("DELETE FROM routes WHERE id=ANY($1::text[])",[routeIds]);
    await operator.query("DELETE FROM segments WHERE id=ANY($1::text[])",[segmentIds]);
    await operator.query("DELETE FROM destinations WHERE id=ANY($1::text[])",[placeIds]);
    await operator.query("DELETE FROM data_source_runs WHERE id=ANY($1::bigint[])",[runIds]);
    worker.release(); await Promise.all([operator.end(),factory.end(),reviewer.end(),api.end(),admin.end()]); rmSync(dir,{recursive:true,force:true});
  }
});
