import { normalizeOfficialFeatureIds, parseOfficialArcgisPaths, parseOfficialFeatureIdsFromSourceUrl, type OfficialNetworkPath } from "../official-route-geometry";
import { getPublishableArcgisTrailSource } from "../official-trail-sources";
import { osmRouteHaversineMeters } from "../osm-route-geometry";
import { CandidateRejection, buildOsmCandidate, hasIdentity, normalizeRouteName, stableJson, validateCandidateContact, validateCandidatePlaces, type CandidatePlaces } from "./graph";
import { loadSourceSnapshots } from "./sources";
import { readHashedJson } from "./source-files";
import { buildUsfsSourceGraphPath, proveUsfsSourceSpan } from "./usfs-source-graph";
import type { BuiltCandidate, PilotCandidateInput } from "./types";

export function loadCandidateSnapshots(input: PilotCandidateInput, baseDir: string): { value: unknown; body: string }[] {
  if (input.source.type === "osm") return loadSourceSnapshots(input.source.snapshots,baseDir);
  if (input.source.type !== "usfs-nfs-trails") throw new CandidateRejection("unsupported_geometry_source");
  if (!Array.isArray(input.source.snapshots) || !input.source.snapshots.length || input.source.snapshots.length > 20) throw new CandidateRejection("invalid_snapshot_count");
  const snapshots = input.source.snapshots.map(snapshot => {
    const time = Date.parse(snapshot.retrievedAt);
    if (!Number.isFinite(time) || time > Date.now() + 300_000) throw new CandidateRejection("invalid_source_retrieval_time");
    return readHashedJson(snapshot.path,snapshot.sha256,baseDir);
  });
  parseUsfsCandidatePaths(input,snapshots.map(snapshot => snapshot.value));
  return snapshots;
}

export function parseUsfsCandidatePaths(input: PilotCandidateInput, snapshots: unknown[]): OfficialNetworkPath[] {
  if (input.source.type !== "usfs-nfs-trails" || input.source.relationId || input.source.wayIds?.length || input.startNodeId || input.endNodeId) throw new CandidateRejection("mixed_source_claims_not_supported");
  const source = getPublishableArcgisTrailSource("usfs-nfs-trails"), expected = normalizeOfficialFeatureIds(input.source.featureIds ?? []);
  if (snapshots.length !== input.source.snapshots.length) throw new CandidateRejection("source_snapshot_count_mismatch");
  const claimed: string[] = [], paths: OfficialNetworkPath[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const ids = parseOfficialFeatureIdsFromSourceUrl(source.service,input.source.snapshots[i].url);
    if (ids.some(id => claimed.includes(id))) throw new CandidateRejection("repeated_usfs_feature_snapshot");
    claimed.push(...ids); paths.push(...parseOfficialArcgisPaths(snapshots[i],source.service,ids));
  }
  if (stableJson([...claimed].sort()) !== stableJson(expected)) throw new CandidateRejection("usfs_snapshot_feature_ids_mismatch");
  return paths;
}

export function buildCandidate(input: PilotCandidateInput, snapshots: unknown[], places: CandidatePlaces): BuiltCandidate {
  if (input.source.type === "osm") {
    if (input.source.featureIds?.length || input.startSourceVertex || input.endSourceVertex) throw new CandidateRejection("mixed_source_claims_not_supported");
    return buildOsmCandidate(input,snapshots,places);
  }
  if (input.source.type !== "usfs-nfs-trails") throw new CandidateRejection("unsupported_geometry_source");
  const {objective,endTrailhead} = validateCandidatePlaces(input,places);
  if (!input.startSourceVertex || (input.kind !== "loop" && !input.endSourceVertex)) throw new CandidateRejection("usfs_source_endpoint_missing");
  const paths = parseUsfsCandidatePaths(input,snapshots);
  const graph = buildUsfsSourceGraphPath(paths,{start:input.startSourceVertex,end:input.endSourceVertex,loop:input.kind === "loop",maxDistanceM:20_000});
  if (graph.distanceM > 20_000) throw new CandidateRejection("objective_beyond_20km");
  const intended = [input.name,...(input.aliases ?? [])].map(normalizeRouteName);
  const nameDistance = graph.edges.reduce((sum,edge,i) => sum + (edge.names.some(name => intended.includes(normalizeRouteName(name))) ? osmRouteHaversineMeters(graph.points[i],graph.points[i + 1]) : 0),0);
  if (nameDistance / graph.distanceM < 0.9 && !hasIdentity(input)) throw new CandidateRejection("route_name_attestation_missing");
  validateCandidateContact(input,places,graph.points);
  // Independent exact feature proof runs before elevation and again on durable replay.
  const proof = proveUsfsSourceSpan(graph.points,paths,graph.usedFeatureIds);
  if (!proof.passed) throw new CandidateRejection("usfs_source_geometry_failed",proof.errors.join("; "));
  return { input,trailhead:places.trailhead,objective,endTrailhead,points:graph.points,nodeIds:[],edges:graph.edges,requiredCutIndices:graph.requiredCutIndices,usedWayIds:[],usedFeatureIds:graph.usedFeatureIds,distanceM:graph.distanceM,mappedFraction:graph.mappedFraction,sourceHashes:input.source.snapshots.map(snapshot => snapshot.sha256),geometryHash:graph.geometryHash,attestation:`usfs-feature-query:${graph.sourceUrl}`,attestedRouteNames:[...new Set([...(nameDistance / graph.distanceM >= 0.9 ? graph.attestation.names : []),...(hasIdentity(input) ? [input.identity!.name] : [])])],shape:input.kind === "loop" ? "loop" : input.kind === "traverse" ? "point_to_point" : "out_and_back" };
}
