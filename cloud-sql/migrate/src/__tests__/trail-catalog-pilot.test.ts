import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildOsmCandidate, sha256, stableJson } from "../trail-catalog/graph";
import { prepareElevation, segmentProvenance, loadSourceSnapshots } from "../trail-catalog/sources";
import { applyPilot, markIncompleteApplyReports, parsePilotArgs } from "../trail-catalog-pilot";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../lib/terrarium-attribution";
import { claimCandidate, finishCandidate, existingCatalogRoute, type CandidateArtifact } from "../trail-catalog/jobs";
import type { CandidateReport, CatalogPlace, PilotCandidateInput } from "../trail-catalog/types";
import type { PoolClient } from "pg";

const head: CatalogPlace = { id: "head", name: "Example Trailhead", lat: 47, lng: -121, features: ["trailhead"], stateCode: "WA", countryCode: "US" };
const objective: CatalogPlace = { ...head, id: "peak", name: "Example Peak", lng: -120.98, features: ["summit"] };
const input: PilotCandidateInput = { sourceKey: "osm:example", name: "Example Trail", kind: "summit", trailheadId: head.id, objectiveId: objective.id, startNodeId: 1, endNodeId: 3, source: { type: "osm", relationId: 99, snapshots: [{ path: "source.json", sha256: "a".repeat(64), url: "https://api.openstreetmap.org/api/0.6/relation/99/full.json", retrievedAt: "2026-10-01T00:00:00Z" }] } };
function snapshot() {
  return { elements: [
    { type: "node", id: 1, lat: 47, lon: -121 }, { type: "node", id: 2, lat: 47, lon: -120.99 }, { type: "node", id: 3, lat: 47, lon: -120.98 },
    { type: "way", id: 10, nodes: [1, 2], tags: { highway: "path", name: "Lower Trail", ref: "100" } },
    { type: "way", id: 11, nodes: [2, 3], tags: { highway: "path", name: "Upper Trail" } },
    { type: "relation", id: 99, members: [{ type: "way", ref: 10 }, { type: "way", ref: 11 }], tags: { type: "route", route: "hiking", name: "Example Trail" } },
  ] };
}
function build(candidate = input, source: unknown = snapshot(), places = { trailhead: head, objective }) { return buildOsmCandidate(candidate, [source], places); }

test("builds exact source vertices and puts cuts and names at source seams", () => {
  const result = build();
  assert.deepEqual(result.nodeIds, [1, 2, 3]);
  assert.deepEqual(result.usedWayIds, [10, 11]);
  assert.deepEqual(result.requiredCutIndices, [0, 1, 2]);
  assert.deepEqual(result.edges[0].names, ["Lower Trail", "100"]);
  assert.equal(result.mappedFraction, 1);
  assert.equal(result.geometryHash, build().geometryHash);
});
test("rejects invented summit connector, even when the route earlier passes the summit", () => {
  assert.throws(() => build({ ...input, endNodeId: 2 }), /objective_source_gap/);
  assert.throws(() => build(input, snapshot(), { trailhead: head, objective: { ...objective, lng: -120.99 } }), /objective_source_gap/);
});
test("does not connect disconnected OSM node IDs at equal coordinates", () => {
  const source = snapshot();
  source.elements.push({ type: "node", id: 4, lat: 47, lon: -120.99 });
  source.elements.find(e => e.id === 11)!.nodes = [4, 3];
  assert.throws(() => build(input, source), /disconnected_source_graph/);
});
test("respects access and hiking terrain requirements", () => {
  const source = snapshot();
  source.elements.find(e => e.id === 11)!.tags = { highway: "path", access: "no" } as never;
  assert.throws(() => build(input, source), /source_endpoint_missing/);
  source.elements.find(e => e.id === 11)!.tags = { highway: "path", sac_scale: "alpine_hiking" } as never;
  assert.throws(() => build(input, source), /terrain_review_required/);
  assert.equal(build({ ...input, terrainReviews: [{ wayId: 11, sourceUrl: "https://www.openstreetmap.org/way/11", checkedAt: "2026-10-01", note: "Mapped scramble reviewed" }] }, source).usedWayIds.length, 2);
});
test("requires meaningful route attestation and rejects spoofed identity publishers", () => {
  const source = snapshot(); source.elements.find(e => e.type === "relation")!.members = [{ type: "way", ref: 10 }];
  const candidate = { ...input, source: { ...input.source, wayIds: [10, 11] } };
  assert.throws(() => build(candidate, source), /insufficient_relation_attestation/);
  assert.throws(() => build({ ...candidate, identity: { publisher: "wta", name: input.name, sourceUrl: "https://example.org/fake" } }, source), /insufficient_relation_attestation/);
  assert.equal(build({ ...candidate, identity: { publisher: "wta", name: input.name, sourceUrl: "https://www.wta.org/go-hiking/hikes/example" } }, source).mappedFraction, 1);
});
test("lakes use actual boundary while source endpoints remain unchanged", () => {
  const lake = { ...objective, id: "lake", name: "Lake Example", lng: -120.95, features: ["lake"], boundary: { type: "Polygon" as const, coordinates: [[[-120.981, 46.999], [-120.97, 46.999], [-120.97, 47.001], [-120.981, 47.001], [-120.981, 46.999]]] } };
  const result = build({ ...input, kind: "destination", objectiveId: "lake" }, snapshot(), { trailhead: head, objective: lake });
  assert.equal(result.points[2].lng, -120.98);
});
test("rejects duplicate source edges and official feature claims without proof", () => {
  const source = snapshot(); source.elements.push({ type: "way", id: 12, nodes: [1, 2], tags: { highway: "path", name: "Duplicate" } });
  assert.throws(() => build({ ...input, source: { ...input.source, wayIds: [10, 11, 12] } }, source), /ambiguous_source_edge/);
  assert.throws(() => build({ ...input, source: { ...input.source, type: "usfs-nfs-trails" } }), /osm_source_required/);
});
test("a hiking relation cannot attest an unrelated display name", () => {
  assert.throws(() => build({ ...input, name: "Unrelated Hike" }), /route_name_attestation_missing/);
  assert.equal(build({ ...input, name: "Example Route", aliases: ["Example Trail"] }).attestation, "osm-relation:99");
});
test("loops require a mapped closed chain of at least three kilometres", () => {
  const loop = { ...input, kind: "loop" as const, objectiveId: null, source: { ...input.source, wayIds: [10] } };
  const source = snapshot();
  source.elements.find(e => e.id === 10)!.nodes = [1, 2, 3, 1];
  const built = buildOsmCandidate(loop, [source], { trailhead: head });
  assert.equal(built.shape, "loop");
  assert.equal(built.nodeIds[0], built.nodeIds[built.nodeIds.length - 1]);
  source.elements.find(e => e.id === 2)!.lon = -120.999;
  source.elements.find(e => e.id === 3)!.lon = -120.998;
  assert.throws(() => buildOsmCandidate(loop, [source], { trailhead: head }), /loop_shorter_than_3km/);
  source.elements.find(e => e.id === 10)!.nodes = [1, 2, 3];
  assert.throws(() => buildOsmCandidate(loop, [source], { trailhead: head }), /loop_not_simple_closed_source_chain/);
});
test("hash-bound sources and terrain samples reject stale bytes or fabricated vertices", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaks-pilot-test-"));
  try {
    const body = JSON.stringify(snapshot()); writeFileSync(join(dir, "source.json"), body);
    const spec = { ...input.source.snapshots[0], sha256: sha256(body) };
    assert.equal(loadSourceSnapshots([spec], dir).length, 1);
    assert.throws(() => loadSourceSnapshots([{ ...spec, sha256: "b".repeat(64) }], dir), /snapshot_hash_mismatch/);
    const candidate = build();
    const elevation = { points: candidate.points.map((p, i) => ({ ...p, ele: 100 + i * 100 })), lineage: { source: "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)", sourceUrl: "https://registry.opendata.aws/terrain-tiles/", licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", attribution: TERRARIUM_REQUIRED_ATTRIBUTION, retrievedAt: "2026-10-01", profile: "terrain" } };
    const save = () => { const bytes = JSON.stringify(elevation); writeFileSync(join(dir, "elevation.json"), bytes); candidate.input = { ...candidate.input, elevation: { path: "elevation.json", sha256: sha256(bytes) } }; };
    save(); const ready = prepareElevation(candidate, dir);
    assert.equal(ready.gainM, 200);
    assert.deepEqual(segmentProvenance(ready, 0, 1).osm_way_ids, [10]);
    assert.deepEqual(segmentProvenance(ready, 1, 2).osm_way_ids, [11]);
    elevation.lineage.attribution = "ArcticDEM; United States 3DEP"; save();
    assert.throws(() => prepareElevation(candidate, dir), /invalid_elevation_lineage/);
    elevation.lineage.attribution = TERRARIUM_REQUIRED_ATTRIBUTION;
    elevation.points[2].ele = 150; save();
    candidate.input.attestedStats = [{ sourceUrl: "https://www.fs.usda.gov/example", distanceBasis: "round_trip", gainM: 100 }];
    assert.throws(() => prepareElevation(candidate, dir), /attested_gain_basis_unspecified/);
    candidate.input.attestedStats[0].gainBasis = "outbound";
    assert.equal(prepareElevation(candidate, dir).gainM, 100);
    candidate.input.attestedStats[0].gainBasis = "full_trip";
    candidate.input.attestedStats[0].gainM = 150;
    assert.equal(prepareElevation(candidate, dir).lossM, 50);
    candidate.input.attestedStats[0].sourceUrl = "https://www.wta.org/go-hiking/hikes/example";
    assert.throws(() => prepareElevation(candidate, dir), /attested_stats_source_not_allowed/);
    candidate.input.attestedStats = [];
    elevation.points[1].lng += 0.001; save();
    assert.throws(() => prepareElevation(candidate, dir), /elevation_source_vertex_mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("dry run is default; apply requires an explicit review hash", () => {
  assert.equal(parsePilotArgs(["--manifest", "input.json", "--report", "report.jsonl"]).apply, false);
  assert.throws(() => parsePilotArgs(["--manifest", "input.json", "--report", "report.jsonl", "--apply"]), /Usage/);
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});
test("lease claim uses skip-locked and expired lease recovery; stale completion fails", async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } } as unknown as PoolClient;
  assert.equal(await claimCandidate(client, "source", "a".repeat(64), "worker"), null);
  assert.match(queries[0], /FOR UPDATE SKIP LOCKED/);
  assert.match(queries[0], /lease_expires_at<now\(\)/);
  await assert.rejects(() => finishCandidate(client, { sourceKey: "source", token: "old", inputHash: "a".repeat(64), proposedRouteId: "new", artifact: {} as never }, null, {}, "failed"), /candidate_lease_lost/);
});
test("legacy duplicate guard works before candidate job migration", async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => { queries.push(sql); return { rows: sql.includes("to_regclass") ? [{ exists: false }] : [{ id: "legacy-route" }] }; } } as unknown as PoolClient;
  assert.equal(await existingCatalogRoute(client, { input }), "legacy-route");
  assert.equal(queries.length, 2);
  assert.match(queries[1], /rd.ordinal=0/);
});
test("an apply receipt failure preserves committed outcomes and labels every incomplete row", async () => {
  const artifact={candidate:{input:{sourceKey:"first"}}} as CandidateArtifact;
  const reports:CandidateReport[]=[{sourceKey:"first",name:"First",outcome:"admitted",reason:null,pendingReady:true},
    {sourceKey:"second",name:"Second",outcome:"rejected",reason:"research_source_gap"},
    {sourceKey:"third",name:"Third",outcome:"admitted",reason:null,pendingReady:true}];
  const client={query:async (sql:string) => {
    if (sql.includes("session_user")) return {rows:[{database_user:"factory",is_factory:true,is_reviewer:false}]};
    if (sql.includes("RETURNING state,route_id,input_hash")) return {rows:[{state:"pending",route_id:"committed-route",input_hash:sha256(stableJson(artifact))}]};
    if (sql.includes("trail_catalog_pending_binding_valid")) return {rows:[{valid:true}]};
    throw new Error("rejected receipt connection lost");
  }} as unknown as PoolClient;
  let progress:CandidateReport[]=[];
  const plan={reports,artifacts:new Map([["first",artifact]]),reviewHash:"a".repeat(64)};
  await assert.rejects(()=>applyPilot(client,{version:1,batchKey:"test",candidates:[]},plan,plan.reviewHash,completed=>{progress=[...completed,...reports.slice(completed.length)];}),/receipt connection lost/);
  const final=markIncompleteApplyReports(progress,new Error("rejected receipt connection lost"));
  assert.equal(final[0].writeAction,"existing"); assert.equal(final[0].routeId,"committed-route");
  assert.deepEqual(final.slice(1).map(report=>report.reason),["apply_not_completed_check_receipt","apply_not_completed_check_receipt"]);
  assert.ok(final.slice(1).every(report=>report.outcome==="rejected" && !report.pendingReady));
  const created={...reports[0],routeId:"newly-committed",writeAction:"created" as const};
  assert.deepEqual(markIncompleteApplyReports([created],new Error("later COMMIT response lost")),[created]);
});
