/** Offline replay: no database connection, writes, or route activation. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOsmCandidate, CandidateRejection, sha256 } from "../../../src/trail-catalog/graph";
import { loadManifest, loadSourceSnapshots, prepareElevation } from "../../../src/trail-catalog/sources";
import { computeRouteElevationStats } from "../../../src/route-elevation-profile";
import { osmRouteHaversineMeters } from "../../../src/osm-route-geometry";
import { pointToSegmentMeters } from "../../../src/route-world-geometry";
import type { CatalogPlace, Point } from "../../../src/trail-catalog/types";

const baseDir = __dirname;
const { manifest } = loadManifest(resolve(baseDir, "manifest.json"));
const evidence = JSON.parse(readFileSync(resolve(baseDir, "source-evidence.json"), "utf8"));
const catalogBytes = readFileSync(resolve(baseDir, "catalog-places.json"));
if (sha256(catalogBytes) !== evidence.catalogSnapshot.sha256) throw new Error("catalog_snapshot_hash_mismatch");
const places = new Map<string, CatalogPlace & { credited_cover?: boolean }>(JSON.parse(catalogBytes.toString()).map((p: CatalogPlace) => [p.id, p]));
const reportPath = resolve(baseDir, "../../../../../docs/data-audits/trail-catalog-wa-2026-10-13/graph-dry-run.jsonl");
const features: unknown[] = [];
function contactDistance(place: CatalogPlace | undefined, point: Point): number | null {
  if (!place) return null;
  if (place.boundary?.type === "Polygon") return Math.min(...place.boundary.coordinates.flatMap(ring => ring.slice(1).map((c, i) => pointToSegmentMeters(point, {lng:ring[i][0],lat:ring[i][1]}, {lng:c[0],lat:c[1]}))));
  return osmRouteHaversineMeters(place, point);
}
const reports = manifest.candidates.map(input => {
  const row: Record<string, unknown> = { sourceKey: input.sourceKey, name: input.name, kind: input.kind, graphOutcome: "rejected", reason: null, databaseChecksRun: false, pendingReady: false, access: input.access?.status ?? "unknown", routeId: null, sharedSegmentIds: null, searchRank: null, difficulty: null, liveCatalogFieldsReason: "No route insertion, database segment match, search query, or difficulty computation ran in this offline replay." };
  const trailhead = places.get(input.trailheadId ?? ""), objective = places.get(input.objectiveId ?? ""), endTrailhead = places.get(input.endTrailheadId ?? "");
  row.trailheadId = input.trailheadId; row.objectiveId = input.objectiveId; row.endTrailheadId = input.endTrailheadId ?? null;
  row.coverBlockers = input.kind === "loop" ? (!trailhead?.credited_cover ? ["trailhead_credited_cover_missing"] : []) : (!objective?.credited_cover ? ["objective_credited_cover_missing"] : []);
  try {
    const sources = loadSourceSnapshots(input.source.snapshots, baseDir);
    const sourceNodes = new Map<number, Point>();
    for (const snapshot of sources) for (const element of (snapshot.value as {elements: {type:string;id:number;lat:number;lon:number}[]}).elements) if (element.type === "node") sourceNodes.set(element.id,{lat:element.lat,lng:element.lon});
    const start = sourceNodes.get(input.startNodeId ?? 0), end = sourceNodes.get(input.endNodeId ?? 0);
    if (start) row.trailheadSourceGapM = contactDistance(trailhead,start);
    if (end) row.objectiveContactGapM = contactDistance(objective,end);
    const built = buildOsmCandidate(input, sources.map(s => s.value), { trailhead: trailhead!, objective, endTrailhead });
    Object.assign(row, { graphOutcome: "admitted", geometryHash: built.geometryHash, distanceM: built.distanceM, distanceBasis: "stored_path", shape: built.shape, pointCount: built.points.length, mappedFraction: built.mappedFraction, usedWayIds: built.usedWayIds, requiredCutIndices: built.requiredCutIndices, sourceHashes: built.sourceHashes, elevationOutcome: "missing" });
    features.push({ type:"Feature", properties: { sourceKey: input.sourceKey,name:input.name,geometryHash:built.geometryHash }, geometry:{type:"LineString",coordinates:built.points.map(p => [p.lng,p.lat])} });
    if (input.elevation) {
      const raw = JSON.parse(readFileSync(resolve(baseDir,input.elevation.path),"utf8"));
      const stats = computeRouteElevationStats(raw.points.map((p: {ele:number}) => p.ele));
      Object.assign(row,{gainM:stats.gain,lossM:stats.loss,roundTripGainM:built.shape === "out_and_back" ? stats.gain+stats.loss : stats.gain});
      row.attestedStats = input.attestedStats?.map(s => {
        const gain = s.gainBasis === "outbound" ? stats.gain : s.gainBasis === "full_trip" ? (built.shape === "out_and_back" ? stats.gain+stats.loss : stats.gain) : s.gainBasis === "net_change" ? stats.gain-stats.loss : null;
        return {...s,distanceDifferenceFraction:s.distanceM ? Math.abs((s.distanceBasis === "round_trip" && built.shape === "out_and_back" ? built.distanceM*2 : built.distanceM)-s.distanceM)/s.distanceM : null,gainDifferenceFraction:s.gainM && gain !== null ? Math.abs(gain-s.gainM)/s.gainM : null};
      });
      row.statBlockers = (row.attestedStats as {sourceUrl:string;distanceDifferenceFraction:number|null;gainM?:number;gainBasis?:string;gainDifferenceFraction:number|null}[] | undefined)?.flatMap(s => [
        ...(s.distanceDifferenceFraction !== null && s.distanceDifferenceFraction > 0.15 ? [{reason:"attested_distance_mismatch",sourceUrl:s.sourceUrl,differenceFraction:s.distanceDifferenceFraction}] : []),
        ...(s.gainM !== undefined && (!s.gainBasis || s.gainBasis === "unspecified") ? [{reason:"attested_gain_basis_unspecified",sourceUrl:s.sourceUrl}] : []),
        ...(s.gainDifferenceFraction !== null && s.gainDifferenceFraction > 0.15 ? [{reason:"attested_gain_mismatch",sourceUrl:s.sourceUrl,differenceFraction:s.gainDifferenceFraction}] : []),
      ]) ?? [];
    }
    try { prepareElevation(built,baseDir); row.elevationOutcome = "passed"; }
    catch(error) { row.elevationOutcome = "rejected"; row.elevationReason = error instanceof CandidateRejection ? error.reason : "elevation_failed"; row.elevationDetail = error instanceof Error ? error.message : String(error); }
  } catch(error) { row.reason = error instanceof CandidateRejection ? error.reason : "candidate_validation_failed"; row.detail = error instanceof Error ? error.message : String(error); }
  return row;
});
const summary = {type:"summary",scope:"offline_source_graph_and_saved_catalog_snapshot",candidates:reports.length,graphAdmitted:reports.filter(r => r.graphOutcome === "admitted").length,graphRejected:reports.filter(r => r.graphOutcome === "rejected").length,elevationPassed:reports.filter(r => r.elevationOutcome === "passed").length,pendingReady:0,databaseChecksRun:false,manifestSha256:sha256(readFileSync(resolve(baseDir,"manifest.json")))};
if (reports.length !== 21) throw new Error("golden_pilot_requires_all_21_rows");
writeFileSync(reportPath,[...reports,summary].map(r => JSON.stringify(r)).join("\n")+"\n");
writeFileSync(reportPath.replace("graph-dry-run.jsonl","graph-candidates.geojson"),JSON.stringify({type:"FeatureCollection",features})+"\n");
console.log(JSON.stringify(summary));
for (const r of reports) console.log(JSON.stringify({name:r.name,graph:r.graphOutcome,reason:r.reason,distanceM:r.distanceM,elevation:r.elevationOutcome,elevationReason:r.elevationReason}));
