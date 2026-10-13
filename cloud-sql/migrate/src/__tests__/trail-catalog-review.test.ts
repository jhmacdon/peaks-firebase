import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { applyActivation, parseReviewArgs } from "../trail-catalog-review";
import { assembleSourceCheck, buildFilteredPacket, checkAttestedStats, digest, HUMAN_GATES, MACHINE_GATES, validateHumanResult, validateSnapshot, type CandidateSnapshot, type Json } from "../trail-catalog/review";
import { bindPacket, checkerEnvironment, mutate, packetPlanHash, planReview, proofIdentity, reviewEvidenceUrls, validatePacketEvidence, verifyPublishedCandidate } from "../trail-catalog/review-operations";
import { sha256 } from "../trail-catalog/graph";
const hash = "a".repeat(64), now = new Date();
function fixture(): CandidateSnapshot {
  const body = JSON.stringify({ elements: [] }), sourceHash = sha256(body);
  const points = Array.from({ length: 5 }, (_, i) => ({ lat: 47 + i * 0.001, lng: -121, ele: 1_000 + i * 25, dist: i * 125 }));
  const trailhead = { id: "head", name: "Trailhead", features: ["trailhead"], lat: 47, lng: -121, stateCode: "WA", countryCode: "US" }, objective = { ...trailhead, id: "lake", name: "Lake", features: ["lake"], lat: 47.004 };
  const candidate: any = { input: { sourceKey: "source", name: "Lake Trail", kind: "destination", trailheadId: "head", objectiveId: "lake", source: { type: "osm", snapshots: [{ path: "private.json", sha256: sourceHash, url: "https://api.openstreetmap.org/api/0.6/way/1/full.json", retrievedAt: now.toISOString() }] }, access: { status: "open", sourceUrl: "https://www.fs.usda.gov/visit/lake", checkedAt: now.toISOString(), note: "Open" }, attestedStats: [{ sourceUrl: "https://www.fs.usda.gov/visit/lake", distanceM: 1_000, distanceBasis: "round_trip", gainM: 100, gainBasis: "outbound" }] }, trailhead, objective, endTrailhead: null, elevatedPoints: points, points, shape: "out_and_back", usedWayIds: [1], geometryHash: hash, provenance: { source_kind: "openstreetmap", source_url: "https://www.openstreetmap.org/way/1", license_name: "ODbL", license_url: "https://www.openstreetmap.org/copyright", attribution: "OpenStreetMap contributors", retrieved_at: now.toISOString() } };
  const artifact = { candidate, snapshots: [{ sha256: sourceHash, body }] };
  return { sourceKey: "source", inputHash: digest(artifact), routeId: "route", artifact, pendingResult: { verdict: "FACTORY_PASS_SECRET" }, reviewReceipt: null, route: { geometry: { type: "LineString", coordinates: points.map(p => [p.lng, p.lat, p.ele]) } }, places: [trailhead, objective], segments: [] };
}
const machine = () => ({ gates: Object.fromEntries(MACHINE_GATES.filter(g => !["source_geometry", "stats"].includes(g)).map(g => [g, true])), measurements: { distance_m: 500, gain_m: 100, loss_m: 20, reused_length_m: 200, reuse_fraction: 0.4, summit_count: 0, summit_max_gap_m: null }, errors: [] });
const checker = async () => ({ verdict: "PASS", checked_at: new Date().toISOString(), results: [{ route_id: "route", passed: true, errors: [], metrics: { cited_way_count: 1, used_way_count: 1 } }] });
const evidence = (snapshot: CandidateSnapshot) => reviewEvidenceUrls(snapshot).map(url => ({ url, checkedAt: now.toISOString(), ok: true, untrustedContent: true, textExcerpt: "Review text" }));
const preview = async (snapshot: CandidateSnapshot) => ({ status: "rendered", checkedAt: now.toISOString(), imageHash: sha256("preview"), imageDataUrl: `data:image/png;base64,${Buffer.from("preview").toString("base64")}`, geometryHash: digest(snapshot.route.geometry), rendererHash: hash });
function clientFor(snapshot: CandidateSnapshot, calls: string[] = []) {
  return { async query(sql: string, values?: any[]) {
    calls.push(sql);
    if (sql.includes("snapshot_trail_catalog_candidate")) return { rows: [{ snapshot }] };
    if (sql.includes("machine_checks")) return { rows: [{ checks: machine() }] };
    if (sql.includes("claim_trail_catalog_review")) return { rows: [{ lease: { leaseToken: "token" } }] };
    if (sql.includes("bind_trail_catalog_review_packet")) { const packet = JSON.parse(values![2]), attestation = { sourceKey: "source", routeId: "route", inputHash: snapshot.inputHash, leaseToken: "token", reviewer: "reviewer", reviewPacketHash: hash, sourceCheckHash: hash }; return { rows: [{ packet: { ...packet, attestation, reviewResultTemplate: { ...packet.reviewResultTemplate, attestation } } }] }; }
    if (sql.includes("claim_trail_catalog_publish") || sql.includes("claim_trail_catalog_verification")) return { rows: [{ lease: { leaseToken: "token" } }] };
    if (sql.includes("activate_trail_catalog_candidate") || sql.includes("finish_trail_catalog_verification")) return { rows: [{ receipt: { state: "published" } }] };
    throw new Error(`unexpected query: ${sql}`);
  } };
}
test("arguments default to dry, reject empty/duplicate/unbounded input and public override", () => {
  const args = parseReviewArgs(["packet", "--source-key", "source", "--report", "report.jsonl", "--output", "packet.json"]);
  assert.equal(args.apply, false); assert.equal(args.batchSize, 1);
  assert.throws(() => parseReviewArgs(["packet", "--report", "r", "--output", "p"]), /nonempty/);
  assert.throws(() => parseReviewArgs(["activate", "--source-key", "a", "--source-key", "a", "--report", "r"]), /unique/);
  assert.throws(() => parseReviewArgs(["activate", "--source-key", "a", "--report", "r", "--batch-size", "501"]), /1..500/);
  assert.throws(() => parseReviewArgs(["verify", "--source-key", "a", "--report", "r", "--receipt-hash", hash, "--public-base-url", "https://staging.example"]), /unknown/);
  assert.throws(() => parseReviewArgs(["packet", "--source-key", "a", "--report", "r", "--output", "p", "--apply"]), /SHA/);
});
test("artifact and each raw snapshot bind by hash before review", () => {
  const snapshot = fixture(); assert.equal(validateSnapshot(snapshot, "source"), snapshot);
  assert.throws(() => validateSnapshot({ ...snapshot, inputHash: hash }, "source"), /artifact hash/);
  snapshot.artifact.snapshots[0].body = "{}"; snapshot.inputHash = digest(snapshot.artifact);
  assert.throws(() => validateSnapshot(snapshot, "source"), /source hash/);
});
test("packet contains reviewable exact XYZ, kind contacts and credit; never factory verdict or raw sources", async () => {
  const snapshot = fixture(), source = assembleSourceCheck(snapshot, await checker(), machine()), packet = buildFilteredPacket(snapshot, source);
  assert.equal(source.passed, true); assert.deepEqual(packet.routeGeometry, snapshot.route.geometry);
  assert.equal(packet.sourceCheck.machineChecks.measurements.summit_max_gap_m, null);
  const text = JSON.stringify(packet); assert.ok(!text.includes("FACTORY_PASS_SECRET")); assert.ok(!text.includes("private.json")); assert.ok(!text.includes("elements"));
  assert.equal(packet.candidate.geometry.licenseName, "ODbL"); assert.equal(packet.objectiveId, "lake");
  snapshot.route.geometry.coordinates[2][2] += 1;
  assert.throws(() => buildFilteredPacket(snapshot, source), /live XYZ/);
});
test("statistics use live distances and explicit gain bases with inclusive 15% bound", () => {
  const snapshot = fixture(), input = snapshot.artifact.candidate.input, points = snapshot.artifact.candidate.elevatedPoints;
  assert.equal(checkAttestedStats(input, { distance_m: 575, gain_m: 115, loss_m: 20 }, points, "out_and_back").passed, true);
  assert.equal(checkAttestedStats(input, { distance_m: 576, gain_m: 115, loss_m: 20 }, points, "out_and_back").passed, false);
  input.attestedStats![0].gainBasis = "full_trip"; input.attestedStats![0].gainM = 120;
  assert.equal(checkAttestedStats(input, { distance_m: 500, gain_m: 100, loss_m: 20 }, points, "out_and_back").passed, true);
  input.attestedStats![0].gainBasis = "unspecified";
  assert.match(checkAttestedStats(input, { distance_m: 500, gain_m: 100, loss_m: 20 }, points, "out_and_back").errors.join(), /basis missing/);
  assert.equal(checkAttestedStats(input, { distance_m: 500, gain_m: 2001, loss_m: 20 }, points, "out_and_back").passed, false);
});
test("missing machine gates, failed source proof and exact short geometry block preactivation", async () => {
  for (const gate of MACHINE_GATES.filter(g => !["source_geometry", "stats"].includes(g))) {
    const checks = machine(); delete checks.gates[gate]; assert.equal(assembleSourceCheck(fixture(), await checker(), checks).passed, false, gate);
  }
  assert.equal(assembleSourceCheck(fixture(), { ...await checker(), verdict: "FAIL" }, machine()).passed, false);
  const short = fixture(); short.artifact.candidate.elevatedPoints = short.artifact.candidate.elevatedPoints.slice(0, 2);
  assert.equal(assembleSourceCheck(short, await checker(), machine()).machineChecks.gates.xyz_assembly, false);
});
test("bind requires exact dry packet hash and current independent proof; no hand-edited verdict", async () => {
  const snapshot = fixture(), calls: string[] = [], client = clientFor(snapshot, calls), packet = buildFilteredPacket(snapshot, assembleSourceCheck(snapshot, await checker(), machine()), evidence(snapshot), await preview(snapshot));
  await assert.rejects(bindPacket(client, "source", packet, hash, checker, preview), /reviewed dry plan/);
  const malicious = { ...packet, factoryVerdict: "PASS" };
  await assert.rejects(bindPacket(client, "source", malicious, digest(malicious), checker, preview), /unsupported/);
  const bound = await bindPacket(client, "source", packet, packetPlanHash(packet), checker, preview);
  assert.equal(bound.attestation.leaseToken, "token"); assert.deepEqual(bound.reviewResultTemplate.attestation, bound.attestation);
  assert.ok(calls.some(sql => sql.includes("claim_trail_catalog_review"))); assert.ok(!calls.some(sql => /UPDATE|INSERT/.test(sql)));
  const failed = async () => ({ ...await checker(), verdict: "FAIL" });
  await assert.rejects(bindPacket(client, "source", packet, digest(packet), failed, preview), /evidence changed/);
});
test("human PASS copies exact attestation and fills every named boolean gate; stale/extra gates reject", async () => {
  const snapshot = fixture(), packet = buildFilteredPacket(snapshot, assembleSourceCheck(snapshot, await checker(), machine()), evidence(snapshot), await preview(snapshot)); packet.attestation = { routeId: "route", leaseToken: "token" };
  const result = { verdict: "PASS", reviewed_at: now.toISOString(), attestation: packet.attestation, gates: Object.fromEntries(HUMAN_GATES.map(g => [g, true])), errors: [] };
  assert.equal(validateHumanResult(packet, result), result);
  assert.throws(() => validateHumanResult(packet, { ...result, attestation: { ...packet.attestation, routeId: "other" } }), /exact packet/);
  assert.throws(() => validateHumanResult(packet, { ...result, gates: { ...result.gates, unrequested: true } }), /extra keys/);
  assert.throws(() => validateHumanResult(packet, { ...result, reviewed_at: "2020-01-01" }), /stale/);
  assert.throws(() => validateHumanResult(packet, { ...result, gates: { ...result.gates, access: null } }), /boolean/);
});
test("review dry rejects a changed stored packet or expired lease before finish", async () => {
  const snapshot = fixture(), client = clientFor(snapshot), draft = buildFilteredPacket(snapshot, assembleSourceCheck(snapshot, await checker(), machine()), evidence(snapshot), await preview(snapshot));
  const packet = await bindPacket(client, "source", draft, digest(draft), checker, preview), result = { verdict: "PASS", reviewed_at: now.toISOString(), attestation: packet.attestation, gates: Object.fromEntries(HUMAN_GATES.map(g => [g, true])), errors: [] };
  snapshot.reviewReceipt = { state: "reviewing", lease_token: "token", lease_expires_at: new Date(Date.now() + 900_000).toISOString(), packet, source_check: packet.sourceCheck };
  const plan = await planReview(client, "source", packet, result, checker); assert.match(plan.reviewHash, /^[a-f0-9]{64}$/);
  snapshot.reviewReceipt.lease_expires_at = "2020-01-01";
  await assert.rejects(planReview(client, "source", packet, result, checker), /fresh lease/);
});
test("timestamp churn does not mask source proof changes", () => {
  assert.deepEqual(proofIdentity({ checkedAt: "a", results: [{ checked_at: "b", passed: true }] }), proofIdentity({ checkedAt: "c", results: [{ checked_at: "d", passed: true }] }));
  assert.notEqual(digest(proofIdentity({ passed: true })), digest(proofIdentity({ passed: false })));
});
test("first incomplete verification stops later activation and reports unattempted jobs", async () => {
  const calls: string[] = [], snapshot = fixture(), client = clientFor(snapshot, calls);
  const records = [{ sourceKey: "source", receiptHash: hash, passed: true }, { sourceKey: "second", receiptHash: hash, passed: true }], plan = { reviewHash: hash, records, rematch: { drained: true } };
  const seen: Json[] = [];
  const verify = async () => ({ routeId: "route", passed: false, gates: { public_http: true, search: true, rematch_drained: false } });
  await assert.rejects(applyActivation(client, plan, hash, undefined, row => seen.push(row), verify), /no next route/);
  assert.equal(calls.filter(sql => sql.includes("activate_trail_catalog_candidate")).length, 1);
  assert.equal(seen[1].action, "not_attempted");
  await assert.rejects(applyActivation(client, { ...plan, rematch: { drained: false } }, hash), /blockers/);
  await assert.rejects(applyActivation(client, { ...plan, records: [] }, hash), /blockers/);
});
test("production verification rejects alternate public origins before any fetch", async () => {
  const prior = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { await assert.rejects(verifyPublishedCandidate(clientFor(fixture()), fixture(), "https://staging.example"), /canonical/); } finally { process.env.NODE_ENV = prior; }
});
test("checker child environment removes endpoint overrides, hooks, proxies and other lane credentials", () => {
  const selected = checkerEnvironment({ DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_NAME: "peaks", DB_USER: "actual-reviewer", DB_PASS: "test-only", NODE_OPTIONS: "--require malicious", PEAKS_OSM_API_URL: "https://fake", HTTPS_PROXY: "https://fake", PEAKS_ROUTE_FACTORY_DB_PASS: "other-lane" });
  assert.equal(selected.DB_USER, "actual-reviewer"); assert.equal(selected.NODE_OPTIONS, undefined); assert.equal(selected.PEAKS_OSM_API_URL, undefined); assert.equal(selected.HTTPS_PROXY, undefined); assert.equal(selected.PEAKS_ROUTE_FACTORY_DB_PASS, undefined);
  assert.throws(() => checkerEnvironment({ DB_USER: "actual-reviewer" }), /no credential or target fallback/);
});
test("old, missing and changed web/map evidence cannot bind a dry packet", async () => {
  const snapshot = fixture(), packet = buildFilteredPacket(snapshot, assembleSourceCheck(snapshot, await checker(), machine()), evidence(snapshot), await preview(snapshot));
  validatePacketEvidence(snapshot, packet);
  packet.webEvidence[0].checkedAt = "2020-01-01"; assert.throws(() => validatePacketEvidence(snapshot, packet), /stale/);
  packet.webEvidence = evidence(snapshot); packet.mapEvidence.imageHash = hash; assert.throws(() => validatePacketEvidence(snapshot, packet), /visual map hash/);
});
test("missing rendered map cannot become a human PASS", async () => {
  const snapshot = fixture(), packet = buildFilteredPacket(snapshot, assembleSourceCheck(snapshot, await checker(), machine())); packet.attestation = { sourceKey: "source" };
  assert.throws(() => validateHumanResult(packet, { verdict: "PASS", reviewed_at: now.toISOString(), attestation: packet.attestation, gates: Object.fromEntries(HUMAN_GATES.map(g => [g, true])), errors: [] }), /actual visual map/);
});
test("lost mutation replies are unknown; definite SQL rejections are known aborts", async () => {
  const lost = { async query() { throw new Error("socket closed"); } };
  await assert.rejects(mutate(lost, "SELECT activate()", [], "activate"), (error: any) => error.outcomeUnconfirmed === true);
  const rejected = { async query() { throw Object.assign(new Error("gate false"), { code: "P0001" }); } };
  await assert.rejects(mutate(rejected, "SELECT activate()", [], "activate"), (error: any) => error.outcomeUnconfirmed === false);
});
test("confirmed activation remains counted when verification acknowledgement is lost", async () => {
  const calls: string[] = [], base = clientFor(fixture(), calls), client = { async query(sql: string, values?: any[]) { if (sql.includes("claim_trail_catalog_verification")) throw new Error("socket closed"); return base.query(sql, values); } };
  const plan = { reviewHash: hash, records: [{ sourceKey: "source", routeId: "route", receiptHash: hash, passed: true }], rematch: { drained: true } }, seen: Json[] = [];
  await assert.rejects(applyActivation(client, plan, hash, undefined, row => seen.push(row)), (error: any) => error.outcomeUnconfirmed === true);
  assert.equal(seen[0].action, "activated"); assert.equal(seen[0].routeId, "route"); assert.equal(seen[0].outcomeUnconfirmed, true);
});
test("supervised wrapper blocks target/lane overrides and missing credentials before any connection", () => {
  const script = resolve(__dirname, "../../../..", ".agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh");
  const base = { PATH: "/usr/bin:/bin", DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_NAME: "peaks", DB_USER: "peaks-route-reviewer-worker", DB_PASS: "test-only-never-connect" };
  for (const changed of [{ DB_HOST: "untrusted.example" }, { DB_USER: "peaks-route-factory-worker" }, { DB_NAME: "other" }, { DB_PASS: "" }]) {
    const result = spawnSync("/bin/bash", ["-p", script, "packet"], { env: { ...base, ...changed }, encoding: "utf8", timeout: 5_000 });
    assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /override|no credential fallback/); assert.ok(!result.stderr.includes("test-only-never-connect"));
  }
  const syntax = spawnSync("/bin/bash", ["-n", script], { encoding: "utf8" }); assert.equal(syntax.status, 0, syntax.stderr);
});
